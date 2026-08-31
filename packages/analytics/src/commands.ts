/**
 * The bodies behind the three actions `plugin.ts` declares, and **the
 * plugin's composition root**. The command TABLE is written once, in
 * `plugin.ts`, and no later task edits it; each action's behaviour lands here
 * instead - `status` and `dashboard` below, `backfill` at task 61 (whose body
 * lives in `backfill.ts` and is called from the stub here). Until then it
 * raises naming the task that fills it in, so an operator who reaches it gets
 * a sentence rather than a silent no-op, and so `plugin.commands` is complete
 * and dispatchable from the moment the manifest field makes this package
 * discoverable.
 *
 * A body takes exactly the parameters it needs. `PluginCommand.run(ctx, args)`
 * accepts a narrower function - a zero-argument function is assignable to it,
 * and so is one taking a `Pick` of `PluginContext` - so filling a body in
 * never changes the table in `plugin.ts`.
 *
 * **Composition root** means one thing concretely: this is the only module in
 * the package that constructs the DuckDB adapter and the only one that
 * resolves credentials, exactly as `packages/cli/src/context.ts` is for the
 * CLI's own adapters. Every module below it - the server, the named query
 * set, the data shaping - is handed the `AnalyticsQuery` *port* and can name
 * no vendor at all. Both commands that reach the table construct that adapter
 * on their own line here: `dashboard` hands it to the server it starts, and
 * `status` takes it as a defaulted parameter, which is what lets a test drive
 * the whole command over the fixture-backed fake without patching a module.
 *
 * `bootstrap` and `destroy` are deliberately absent from this module as well
 * as from the table: they are always the CLI's generic lifecycle verbs, run
 * by an engine a plugin may not import - see `plugin.ts`'s own comment.
 */

import { fileURLToPath } from 'node:url';

import { colors, createCredentialProvider, type PluginContext } from 'blogwright-core';

import { createDuckDbAnalyticsQuery } from './adapters/duckdb-query.js';
import type { DeliveryState } from './aws/firehose.js';
import { type AnalyticsConfig, resolveAnalyticsConfig } from './config.js';
import { buildAnalyticsNodes, FIREHOSE_STREAM_NODE } from './nodes.js';
import type { AnalyticsQuery } from './ports.js';
import { ROW_COUNT_COLUMN, ROW_COUNT_QUERY, WHOLE_TABLE_RANGE } from './queries.js';
import { createDashboardServer } from './server.js';

/**
 * The signals that stop a foreground command. `SIGTERM` joins `SIGINT`
 * because a dashboard is as likely to be stopped by a supervisor or a
 * container runtime as by an operator's Ctrl+C, and both must release the
 * listener rather than leave the port held by a half-dead process.
 */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** One of {@link STOP_SIGNALS}. */
type StopSignal = (typeof STOP_SIGNALS)[number];

/**
 * Raise for an action whose body has not landed yet, naming the plan task
 * that lands it. One helper rather than two literals, so the sentence
 * shape is identical for both.
 */
function pendingAction(action: string, task: number): never {
  throw new Error(
    `blogwright analytics ${action} is not implemented yet - task ${task} lands this command`,
  );
}

/**
 * One node's presence, as {@link readNodeEntries} collected it. The same three
 * states the CLI's own `StatusEntry` (`packages/cli/src/render.ts`) carries,
 * declared here rather than imported because a plugin may not import the CLI -
 * which is the whole reason `analytics status` can be a declared command at
 * all under task 16's precedence.
 *
 * It carries the node's `id` as well as its title, which the CLI's does not:
 * the stream's health line below is keyed on the id, and matching a node by
 * its human title would break the moment a title is reworded.
 */
interface AnalyticsStatusEntry {
  /** The node's id, as `nodes.ts` declares it. */
  readonly id: string;
  /** The node's title, exactly as the bootstrap output prints it. */
  readonly title: string;
  /** What `read()` answered, or `error` when it threw. */
  readonly state: 'present' | 'missing' | 'error';
  /** The message `read()` threw, for an `error` entry. */
  readonly detail?: string | undefined;
}

/** The tree glyphs the pretty form marks each state with - the CLI's own. */
const STATUS_MARKS = {
  present: colors.green('✓'),
  missing: colors.yellow('◌'),
  error: colors.red('✗'),
} as const;

/**
 * The one {@link DeliveryState} that means records are reaching the table.
 * Typed against the client's own union rather than spelled as a bare string,
 * so renaming a state there is a compile error here instead of a status line
 * that silently never reports healthy again.
 */
const HEALTHY_DELIVERY_STATE: DeliveryState = 'active';

/**
 * Read every node the plugin contributes against the live account, in the
 * order {@link buildAnalyticsNodes} returns them (no topological sort - a
 * status is a read, not a reconcile).
 *
 * A `read()` that throws becomes an `error` entry rather than ending the
 * listing: one unreadable item must not take down the whole listing, which is
 * `history`'s manifest loop in `packages/cli/src/commands.ts` and, for exactly
 * this shape, the CLI's own `readNodeStatus`. Nothing is saved - `read()`
 * hydrates `ctx.state` in memory and this command never calls `ctx.save()`, so
 * a status can neither create nor rewrite `state/<env>.analytics.json`.
 */
async function readNodeEntries(
  ctx: PluginContext<AnalyticsConfig>,
): Promise<AnalyticsStatusEntry[]> {
  const entries: AnalyticsStatusEntry[] = [];
  for (const node of buildAnalyticsNodes()) {
    try {
      const exists = await node.read(ctx);
      entries.push({ id: node.id, title: node.title, state: exists ? 'present' : 'missing' });
    } catch (err) {
      entries.push({
        id: node.id,
        title: node.title,
        state: 'error',
        detail: (err as Error).message,
      });
    }
  }
  return entries;
}

/**
 * Report the node listing: the drift tree on an interactive terminal, one
 * stable line per node otherwise. The same split, the same marks and the same
 * `read failed` wording as the site's own `status`
 * (`packages/cli/src/commands.ts`, through `logStatusEntries` in its
 * `render.ts`), restated here because a plugin may not import that module.
 *
 * One deliberate difference in the plain form: the CLI appends
 * `JSON.stringify` of the node's recorded outputs to each line. This command
 * does not. The plain form is the contract CI and agents read, and a line
 * carrying an ARN carries the account id, the environment and a
 * service-generated table id with it - so the "same" line would differ between
 * two environments of the same site and could never be asserted as a contract.
 * What the outputs say is in `state/<env>.analytics.json`, and the two lines
 * this command adds after the listing are what a reader wants them for.
 */
function logNodeEntries(
  entries: readonly AnalyticsStatusEntry[],
  pretty: boolean,
  logger: PluginContext<AnalyticsConfig>['logger'],
): void {
  if (pretty) {
    entries.forEach((entry, index) => {
      const connector = index === entries.length - 1 ? '╰─' : '├─';
      const detail = entry.detail === undefined ? '' : ` ${colors.dim(entry.detail)}`;
      logger.info(`${connector} ${STATUS_MARKS[entry.state]} ${entry.title}${detail}`);
    });
    return;
  }
  // The plain form is the stable contract for CI logs and agents.
  for (const entry of entries) {
    if (entry.state === 'error') {
      logger.warn(`${entry.title}: read failed (${entry.detail})`);
      continue;
    }
    const mark = entry.state === 'present' ? colors.green('present') : colors.yellow('missing');
    logger.info(`  ${mark}  ${entry.title}`);
  }
}

/**
 * Report the delivery stream's health from the state its own `read` hydrated a
 * moment ago (task 51's `recordStream` puts the stream's `state` and, when the
 * service reports one, its `failure` into the plugin's scoped state). No
 * second describe is issued: the node has just made that call, and a status
 * that made it twice would report two different answers on a stream that
 * changed in between.
 *
 * A stream that is absent is reported as a warning rather than as health, and
 * that choice is worth stating because the definition of done does not pin it:
 * "no stream" and "a stream in `create-failed`" are the same operational fact
 * - nothing is being delivered - and the listing above already says which node
 * is missing, so a health line that stayed silent would read as healthy.
 */
function logStreamHealth(
  ctx: PluginContext<AnalyticsConfig>,
  entries: readonly AnalyticsStatusEntry[],
): void {
  const entry = entries.find((candidate) => candidate.id === FIREHOSE_STREAM_NODE);
  if (entry?.state === 'error') {
    ctx.logger.warn(`Firehose delivery: unavailable - reading the stream failed (${entry.detail})`);
    return;
  }
  if (entry?.state !== 'present') {
    ctx.logger.warn(
      `Firehose delivery: no delivery stream - \`blogwright analytics bootstrap ${ctx.env}\` creates it`,
    );
    return;
  }
  const recorded = ctx.state.resources[FIREHOSE_STREAM_NODE];
  const state = typeof recorded?.['state'] === 'string' ? recorded['state'] : 'unrecorded';
  const failure = typeof recorded?.['failure'] === 'string' ? ` - ${recorded['failure']}` : '';
  if (state === HEALTHY_DELIVERY_STATE) {
    ctx.logger.info(`  Firehose delivery: ${state}`);
    return;
  }
  ctx.logger.warn(`Firehose delivery: ${state}${failure}`);
}

/**
 * Report the table's current row count, taken through the `AnalyticsQuery`
 * port by name. The command writes no SQL: `ROW_COUNT_QUERY` names one of the
 * definitions in `queries.ts`, and {@link WHOLE_TABLE_RANGE} is what "current
 * row count" means for a set whose every definition is bounded on the `day`
 * partition. `includeBots` is bound explicitly rather than left to
 * `config.analytics.bots`, because this is the table's row count and not a
 * dashboard figure - a bot row is still a row.
 *
 * A failed read degrades to a warning, which is the whole point of doing it
 * last: the table is the one part of this listing that needs credentials the
 * node reads do not (the vendor library attaches the catalog itself), so an
 * operator with no session still gets all twelve nodes and the stream's health.
 */
async function logRowCount(
  ctx: PluginContext<AnalyticsConfig>,
  query: AnalyticsQuery,
): Promise<void> {
  const config = resolveAnalyticsConfig(ctx);
  const relation = `${config.namespace}.${config.table}`;
  try {
    const rows = await query.run(ROW_COUNT_QUERY, {
      range: WHOLE_TABLE_RANGE,
      includeBots: true,
    });
    const count = rows[0]?.[ROW_COUNT_COLUMN];
    if (typeof count !== 'number') {
      throw new Error(`the ${ROW_COUNT_QUERY} query answered no ${ROW_COUNT_COLUMN}`);
    }
    ctx.logger.info(`  rows in ${relation}: ${count}`);
  } catch (err) {
    ctx.logger.warn(`rows in ${relation}: unavailable - ${(err as Error).message}`);
  }
}

/**
 * `analytics status`: the plugin's own nodes read against
 * `state/<env>.analytics.json`, plus the Firehose stream's delivery health
 * and the table's current row count. Declared rather than left to the
 * generic `status` verb because it does strictly more than that verb does
 * (§Analytics plugin → Namespace and commands), which task 16's precedence
 * permits: only `bootstrap` and `destroy` are reserved.
 *
 * **It takes the whole `PluginContext`, not a `Pick` of it.** Every other
 * consumer in this package narrows (`DashboardCommandContext`,
 * `DuckDbQueryContext`, `AnalyticsConfigContext`), and this one cannot: it
 * hands `ctx` to `read()` on each of the plugin's own nodes, and a node is a
 * `ResourceNode<PluginContext<AnalyticsConfig>>`, so the narrowest type that
 * type-checks is the SPI context entire. A `Pick` listing its fifteen required members
 * would be that type with a second name.
 *
 * `args` is accepted and unused: the host calls `run(ctx, args)` for every
 * declared command, and this one takes no arguments of its own - the
 * environment is a positional the dispatcher has already consumed, and
 * `--plain` reaches this command as `ctx.ports.terminal.isInteractive` rather
 * than as a flag to parse.
 *
 * `query` is a defaulted parameter for the reason the site's own
 * `status(ctx, nodes = buildNodes(ctx))` takes its node set that way: every
 * real call site passes nothing and gets the composition root's adapter, and a
 * test hands it the fixture-backed fake instead of patching a module. The
 * default constructs the adapter but does not connect - the connection and the
 * credentials are resolved inside the first query - so a status that never
 * reaches the table starts nothing.
 */
export async function status(
  ctx: PluginContext<AnalyticsConfig>,
  _args: string[] = [],
  query: AnalyticsQuery = createDuckDbAnalyticsQuery({
    ctx,
    credentials: createCredentialProvider({}),
  }),
): Promise<void> {
  ctx.logger.info(colors.bold(`Analytics status for "${ctx.env}" (bucket ${ctx.names.bucket})`));
  const entries = await readNodeEntries(ctx);
  logNodeEntries(entries, ctx.ports.terminal.isInteractive, ctx.logger);
  logStreamHealth(ctx, entries);
  await logRowCount(ctx, query);
}

/**
 * The slice of a plugin context {@link dashboard} reads, taken as a `Pick` of
 * core's own `PluginContext` rather than a restatement of it, the way
 * `DuckDbQueryContext` and `AnalyticsConfigContext` already are: the members
 * cannot drift from the SPI, any `PluginContext<AnalyticsConfig>` satisfies
 * it, and a test builds the six it needs instead of the SPI's sixteen.
 */
export type DashboardCommandContext = Pick<
  PluginContext<AnalyticsConfig>,
  'env' | 'config' | 'pluginConfig' | 'accountId' | 'ports' | 'logger'
>;

/**
 * The prebuilt dashboard application task 57 emits, beside this module's own
 * compiled output (`dist/commands.js` → `dist/app`). Located from
 * `import.meta.url` for the reason `cliPackageDir` (`packages/cli/src/context.ts`)
 * is: a package's own files are not reachable through its `exports` map, so
 * self-location is a composition-root concern and not something the server -
 * which is handed the resolved directory as data - can derive. Under the test
 * runner it resolves beside the sources instead, where no application is
 * built, and the server answers a 503 naming the directory.
 */
function dashboardAppDir(): string {
  return fileURLToPath(new URL('app', import.meta.url));
}

/**
 * Resolve once a stop signal arrives, un-registering both listeners first so
 * a finished command leaves the process exactly as it found it. Resolves with
 * the signal, so the line the operator sees says which one stopped it.
 */
function untilStopped(): Promise<StopSignal> {
  return new Promise((resolve) => {
    const listeners = new Map<StopSignal, () => void>();
    const stop = (signal: StopSignal): void => {
      for (const [name, listener] of listeners) process.off(name, listener);
      resolve(signal);
    };
    for (const signal of STOP_SIGNALS) {
      const listener = (): void => stop(signal);
      listeners.set(signal, listener);
      process.on(signal, listener);
    }
  });
}

/**
 * `analytics dashboard`: serve the local dashboard over the Iceberg table,
 * bound to `127.0.0.1` on the resolved `dashboard.port`.
 *
 * This is the composition root the module comment describes, and the three
 * lines that make it one are the adapter construction, the credential
 * resolution and the `appDir`. **Credentials are core's own provider chain**
 * (`createCredentialProvider`, `packages/core/src/aws/credentials.ts`),
 * resolved here and handed to the adapter, which is the spec's §Analytics
 * dashboard → Credentials: one credential source serves the whole CLI, so a
 * session that works for `deploy` works for the dashboard. It is built with no
 * `override`, matching `transform/entry.ts`: that flag substitutes an
 * emulator's dummy `test`/`test` pair when a real chain fails, and the
 * dashboard has no emulator to talk to - the adapter attaches a real S3 Tables
 * ARN with no endpoint override at all, so dummy credentials would turn "you
 * are not logged in" into an opaque authorisation failure from AWS.
 *
 * Constructing the adapter touches neither the network nor the native library
 * - it opens its connection lazily on the first query - so the listener is
 * bound and the URL is printed before AWS is ever consulted.
 *
 * The `finally` is the shutdown path, and it covers both ways out: the signal
 * {@link untilStopped} waits for, and a failure raised while waiting. Either
 * way `close()` is awaited, so the port is released before this function
 * returns and the next `analytics dashboard` binds it again.
 */
export async function dashboard(ctx: DashboardCommandContext): Promise<void> {
  const config = resolveAnalyticsConfig(ctx);
  const server = await createDashboardServer({
    query: createDuckDbAnalyticsQuery({ ctx, credentials: createCredentialProvider({}) }),
    config: ctx.pluginConfig,
    port: config.dashboard.port,
    appDir: dashboardAppDir(),
    fs: ctx.ports.fs,
  });
  ctx.logger.info(`analytics dashboard on ${server.url} - press Ctrl+C to stop`);

  try {
    const signal = await untilStopped();
    ctx.logger.info(`${signal} received - stopping the analytics dashboard`);
  } finally {
    await server.close();
    ctx.logger.ok(`analytics dashboard stopped; port ${server.address.port} released`);
  }
}

/**
 * `analytics backfill`: the optional, one-shot, idempotent pull of history
 * that predates the Firehose delivery, from the site's CloudWatch log group
 * into the table. Never part of the steady-state pipeline.
 */
export async function backfill(): Promise<void> {
  pendingAction('backfill', 61);
}
