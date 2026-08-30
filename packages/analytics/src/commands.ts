/**
 * The bodies behind the three actions `plugin.ts` declares, and **the
 * plugin's composition root**. The command TABLE is written once, in
 * `plugin.ts`, and no later task edits it; each action's behaviour lands here
 * instead - `dashboard` below, `status` at task 55, `backfill` at task 61
 * (whose body lives in `backfill.ts` and is called from the stub here). Until
 * then each raises naming the task that fills it in, so an operator who
 * reaches one gets a sentence rather than a silent no-op, and so
 * `plugin.commands` is complete and dispatchable from the moment the manifest
 * field makes this package discoverable.
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
 * no vendor at all.
 *
 * `bootstrap` and `destroy` are deliberately absent from this module as well
 * as from the table: they are always the CLI's generic lifecycle verbs, run
 * by an engine a plugin may not import - see `plugin.ts`'s own comment.
 */

import { fileURLToPath } from 'node:url';

import { createCredentialProvider, type PluginContext } from 'blogwright-core';

import { createDuckDbAnalyticsQuery } from './adapters/duckdb-query.js';
import { type AnalyticsConfig, resolveAnalyticsConfig } from './config.js';
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
 * `analytics status`: the plugin's own nodes read against
 * `state/<env>.analytics.json`, plus the Firehose stream's delivery health
 * and the table's current row count. Declared rather than left to the
 * generic `status` verb because it does strictly more than that verb does
 * (§Analytics plugin → Namespace and commands), which task 16's precedence
 * permits: only `bootstrap` and `destroy` are reserved.
 */
export async function status(): Promise<void> {
  pendingAction('status', 55);
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
