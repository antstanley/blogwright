/**
 * OWNERSHIP: this module and its test file (`plugin-commands.test.ts`) are
 * created here, by task 10, which is their sole author for the whole plan.
 * Tasks 13 (the generic `blogwright <plugin> init` action), 16 (the generic
 * `bootstrap`/`status`/`destroy` lifecycle verbs) and 17 (`blogwright plugin
 * list`) all extend the SAME dispatch surface and the SAME test file rather
 * than re-creating either - on the plan's dependency graph none of the three
 * later tasks depends on either of the other two, so without one named
 * owner here, three tasks would each try to create these two files from
 * scratch and collide. Extend this module; never recreate it.
 *
 * `runPlugin` is generic dispatch for `blogwright <plugin> <action>`: the
 * fall-through `cli.ts` reaches once the first positional is neither a
 * built-in command nor `plugin` itself (`KNOWN_COMMANDS`,
 * `known-commands.ts`). It:
 *
 *   1. Runs `discover` (over the `fs`/`loader` ports the caller supplies -
 *      see `runPlugin`'s `ports` parameter) to find the installed plugin
 *      claiming `command` as its namespace.
 *   2. Matches the LONGEST declared action against the leading positionals,
 *      so a multi-word action such as `secret status` dispatches by
 *      declaration - never by the hand-rolled positional shifting `runPds`
 *      still does at `cli.ts:196` until task 29 deletes it.
 *   3. Resolves the environment exactly the way every built-in command
 *      already does: the first positional left over once the action is
 *      consumed, overridden by `--env`, defaulting to `production`.
 *   4. Builds the ONE `OpsContext` this dispatch needs, now that the real
 *      environment is confirmed, validates the matched plugin's OWN config
 *      block off that context's raw `configDocument` (`resolvePluginConfig`,
 *      `plugins.ts` - the dispatched plugin's block and no other), adapts
 *      the context into the narrow `PluginContext` the SPI promises
 *      (`toPluginContext`, below) with the validated block on
 *      `pluginConfig`, and runs the matched command, mapping a normal return
 *      to exit code 0.
 *
 * Steps 1-3 run BEFORE any `OpsContext` is built - see `runPlugin`'s own
 * doc comment for why an earlier, provisional-context version of this
 * function was wrong, not merely wasteful.
 *
 * TASK 13 - the generic `init` action, and PRECEDENCE. Step 2 above matches
 * a plugin's own `commands` FIRST; the generic `init` action (`runGenericInit`,
 * below) is only ever reached once that match has already failed AND the
 * leading word is exactly `init`. This is the whole of §CLI → `blogwright
 * <plugin> init`'s precedence rule: a plugin declaring its own `init`
 * command owns whatever `blogwright <plugin> init` does, full stop - pds's
 * `init` creates the standard.site publication record
 * (`packages/pds/src/commands.ts:118`) and writes no config block at all,
 * and it must never be shadowed by a generic config writer. Nothing here
 * requires a declared `init` command to write config; the generic action
 * applies only where NO `init` command is declared. The other half of the
 * rule - a plugin may not declare BOTH an `init` command and an `init?(io)`
 * contributor, because the contributor would then never run - is a
 * discovery-time rejection in `plugins.ts`'s collision pass, not something
 * this dispatcher has to account for: by the time a plugin reaches here it
 * has at most one of the two.
 *
 * The generic action itself needs none of the AWS-reaching machinery
 * `makeContext` builds (accountId, clients, state) - only the two ports a
 * plugin's `init?(io)` contributor is typed against (`fs`, `terminal`) and
 * the resolved environment/repo root `runPlugin` already has before any
 * `OpsContext` exists. Building a real context just to splice a text file
 * would additionally require a runnable AWS session before an operator has
 * even finished being asked their plugin's questions - so it deliberately
 * does not.
 *
 * TASK 16 - the generic `bootstrap`/`status`/`destroy` lifecycle verbs, and
 * PRECEDENCE. Like `init`, these three are only ever reached once step 2's
 * `matchAction` has already failed to match the plugin's own `commands` -
 * but the precedence differs by verb:
 *
 *   - `bootstrap` and `destroy` are ALWAYS the generic verbs. A plugin may
 *     not import the CLI (§CLI → Plugin dispatch), and so cannot run the
 *     engine (`applyGraph`/`destroyGraph`, `graph.ts`) itself - there is no
 *     way for a plugin's own `bootstrap`/`destroy` command to do what these
 *     verbs need to do. A plugin declaring either as one of its own
 *     `commands` is therefore rejected at discovery, naming the plugin and
 *     the colliding action - `plugins.ts`'s `rejectDeclaredLifecycleCollisions`,
 *     beside `rejectDeclaredInitCollisions` in the same collision pass (see
 *     that module's DECISION note) - so `matchAction` never has a real
 *     `bootstrap`/`destroy` command to match against in the first place.
 *   - `status` is the generic verb ONLY UNLESS the plugin declares its own -
 *     `read()` lives on the plugin's own nodes, no engine call is needed,
 *     so there is nothing stopping a plugin from implementing `status`
 *     itself (pds's `secret status` is a precedent for a plugin owning its
 *     own status reporting). A declared `status` command is therefore left
 *     alone: `matchAction` already matches it in step 2, and the generic
 *     verb below is never reached for that plugin.
 *
 * All three are further gated on `plugin.nodes` being declared at all
 * (`genericLifecycleCommand`, below): a plugin with no `nodes` contributor
 * gains none of the three, and asking for one falls through to the same
 * unknown-action refusal every other unmatched action gets - it is not a
 * special case, because `genericLifecycleCommand` returns `undefined` for
 * exactly that plugin, the same way an undeclared `init` contributor leaves
 * `runGenericInit` unreached above.
 *
 * Each of the three runs the CLI's own engine - `applyGraph`, `destroyGraph`
 * (`graph.ts`) and `readNodeStatus` (`commands.ts`) - over `plugin.nodes(ctx)`
 * against a context built by `toPluginContext` (below), which by this task
 * re-points `store`/`state`/`save()` at a `StateStore` scoped to the
 * plugin's own name (`state/<env>.<plugin>.json`) rather than the site's.
 * `destroy` additionally refuses without `--yes`, mirroring the site verb's
 * own contract (`commands.ts`'s `destroy`), and deletes the scoped state
 * object itself once `destroyGraph` has torn down every node - mirroring
 * `commands.ts`'s own `destroy`/`previewTeardown`, both of which call
 * `ctx.store.delete()` right after `destroyGraph`.
 *
 * TASK 17 - the built-in `plugin` namespace (`runPluginNamespace`, at the
 * foot of this module) is a SECOND entry point, not an action of the generic
 * dispatch above: `plugin` is reserved (`known-commands.ts`), so no installed
 * plugin can claim it and `runPlugin` never sees it. It lives here because it
 * is the same surface - the actions an operator types after `blogwright` -
 * and shares this module's discovery call and its unknown-action refusal
 * shape. See its own section comment for why `cli.ts` must dispatch it before
 * `createContext`.
 */

import { join } from 'node:path';

import {
  colors,
  findRepoRoot,
  parseConfig,
  StateStore,
  validatePlugin,
  type ConfigBlockEntry as PluginConfigBlockEntry,
  type FileSystem,
  type Plugin,
  type PluginCommand,
  type PluginContext,
  type PluginInitIo,
  type ResourceNode,
  type Terminal,
} from 'blogwright-core';

import { readNodeStatus } from './commands.js';
import { renderConfigBlock, spliceConfigBlock } from './config-block.js';
import {
  cliPackageDir,
  resolveConfigPath,
  type ContextOptions,
  type OpsContext,
} from './context.js';
import { applyGraph, destroyGraph } from './graph.js';
import { ask } from './init.js';
import { confirm, type Logger } from './logger.js';
import type { PackageManager, Ports } from './ports.js';
import { discover, resolvePluginConfig } from './plugins.js';
import { logStatusEntries, renderPluginList, type PluginListRow } from './render.js';

/** The default environment every built-in command falls back to. */
// Also the default `--env` in `cli.ts`'s option table; kept here because the
// dispatcher is the only place that resolves an environment from positionals.
const DEFAULT_ENV = 'production';

/**
 * The parsed flag values `main`'s single `parseArgs` call produces, as far
 * as generic plugin dispatch reads them. `main` passes its own `values`
 * object here directly - this interface only narrows what `runPlugin` reads
 * off it, the same way the hand-rolled `PdsValues`/`PreviewValues` in
 * `cli.ts` each narrow the same shared object for themselves.
 */
export interface PluginValues {
  env?: string | undefined;
  domain?: string | undefined;
  config?: string | undefined;
  endpoint?: string | undefined;
  hash?: string | undefined;
  id?: string | undefined;
  identifier?: string | undefined;
  plain: boolean;
  refresh: boolean;
  yes: boolean;
  help: boolean;
}

/**
 * Flags forwarded into a plugin action's `args`, in this fixed order so the
 * rendered array is deterministic regardless of property-iteration order.
 * `env` is excluded - it is consumed as the environment override, never
 * forwarded as a data flag; `plain` and `help` are session-level concerns of
 * `main` itself, never a plugin action's business.
 */
const FORWARDED_FLAGS = [
  'domain',
  'config',
  'endpoint',
  'hash',
  'id',
  'identifier',
  'refresh',
  'yes',
] as const;

/**
 * Render the flags a plugin action should see as plain string tokens - the
 * same shape `args` already carries positionals in - so a plugin's own
 * `run(ctx, args)` reads `--identifier alice.example` or `--yes` out of one
 * flat array rather than a second, bespoke channel. A boolean flag renders
 * as its bare `--name` only when true; a string flag renders as `--name
 * value` only when set. Nothing is rendered for a flag left at its default.
 */
function serialiseFlags(values: PluginValues): string[] {
  const out: string[] = [];
  for (const flag of FORWARDED_FLAGS) {
    const value = values[flag];
    if (value === undefined || value === false) continue;
    out.push(`--${flag}`);
    if (typeof value === 'string') out.push(value);
  }
  return out;
}

/** One successful match of the leading positionals against a plugin's declared actions. */
interface ActionMatch {
  readonly command: PluginCommand<unknown>;
  /** How many leading positional words the matched action's name consumed. */
  readonly wordCount: number;
}

/**
 * Match the LONGEST declared action against the leading words of `rest`, so
 * a multi-word action such as `secret status` is matched as one unit rather
 * than by shifting a fixed number of positionals (the approach this
 * function replaces, `cli.ts:196`'s hand-rolled `secret` shift). Two
 * commands sharing a declared action name is a `validatePlugin` violation,
 * so no plugin ever reaches here with a genuine tie; the first
 * strictly-longer match found wins regardless of declaration order, which
 * is what makes `secret status` win over a bare `secret` when a plugin
 * declares both.
 */
function matchAction(
  commands: readonly PluginCommand<unknown>[],
  rest: readonly string[],
): ActionMatch | undefined {
  let best: ActionMatch | undefined;
  for (const command of commands) {
    const words = command.action.split(' ');
    if (best && words.length <= best.wordCount) continue;
    if (words.length > rest.length) continue;
    if (words.every((word, i) => rest[i] === word)) {
      best = { command, wordCount: words.length };
    }
  }
  return best;
}

/**
 * Render a plugin's available actions, one per line, for an unknown-action
 * refusal.
 *
 * Includes the generic `init` when the plugin contributes one, and the
 * generic `bootstrap`/`status`/`destroy` lifecycle verbs when it
 * contributes `nodes` ({@link genericLifecycleActions}), because a plugin
 * can declare NO commands at all and still answer four of them: listing
 * `plugin.commands` alone printed `"demo" actions:` and then nothing
 * whatsoever for a nodes-only plugin, while `blogwright demo bootstrap`
 * worked perfectly well. A refusal that tells an operator the plugin has no
 * actions, when it has some, is worse than no refusal.
 */
function renderActions(plugin: Plugin<unknown>): string {
  const declared = plugin.commands.map((command) => `  ${command.action} - ${command.summary}`);
  const init =
    typeof plugin.init === 'function'
      ? [
          `  ${GENERIC_INIT_ACTION} - write this plugin's config block into the environment's config file`,
        ]
      : [];
  const lifecycle = genericLifecycleActions(plugin).map(
    (command) => `  ${command.action} - ${command.summary}`,
  );
  return [`"${plugin.name}" actions:`, ...declared, ...init, ...lifecycle].join('\n');
}

/**
 * Adapt an `OpsContext` into the narrow `PluginContext` a plugin command
 * runs against. This is an ADAPTATION, not an assignment: an `OpsContext`
 * carries thirteen of `PluginContext`'s sixteen members and none of
 * `pluginConfig`, `siteState` or `record`, so a bare assignment is
 * `TS2739`. This function supplies exactly those three - plus the
 * two-member `ports` `PluginPorts` narrows the CLI's six-member `Ports`
 * to, and the plugin's own scoped `store`/`state`/`save()` (below) - and
 * passes every other member through unchanged. No cast, no `any`, anywhere
 * in it.
 *
 * `pluginConfig` is supplied by the CALLER rather than read here, because
 * this function is handed a plugin's NAME and not the plugin: `runPlugin`
 * calls `resolvePluginConfig(plugin, ctx.configDocument)` (`plugins.ts`)
 * first, so an invalid block fails BEFORE the scoped `store.load()` below
 * makes the dispatch's first AWS call and long before the command does any
 * work. The parameter is required, with no `{}` default: the dispatcher
 * erases `TConfig` (it dispatches `Plugin<unknown>` and returns
 * `PluginContext<unknown>`), so a forgotten argument could not be caught
 * anywhere downstream - `pnpm typecheck` catching it here is the only
 * check there is.
 *
 * `siteState` is `ops.state` passed through as the read-only view the SPI
 * promises - a plugin reads the site's own recorded outputs through it (the
 * analytics log-delivery node reads the site's CloudFront distribution
 * through it), but never writes it. It is deliberately NOT the scoped load
 * below: overwriting it would leave a plugin unable to see the site's own
 * outputs at all.
 *
 * `store`, `state` and `save()` are the ONE thing this function gets that a
 * bare assignment from `OpsContext` would not: a `StateStore` scoped to
 * `pluginName` (`state/<env>.<pluginName>.json`, `StateStore`'s fourth
 * constructor argument - `packages/core/src/state.ts`), its own freshly
 * loaded `OpsState`, and a `save()` that persists THAT state through THAT
 * store - never the site's own `state/<env>.json`. This is why the function
 * is `async` where a straight field-for-field adaptation would not need to
 * be: building the plugin's own `state` requires awaiting the scoped
 * store's `load()`. Before this existed (tasks 10-15), `OpsContext`'s
 * `store`/`state`/`save()` typechecked straight through as `PluginContext`'s
 * of the same names with no error - the TYPES lined up even though the
 * STORAGE did not - which is why nothing before this task may call a
 * plugin's `nodes(ctx)`: doing so would have silently recorded a plugin's
 * resources into the site's own state document instead of its own, and
 * `record`, below, closes exactly that gap by writing into the scoped
 * `state.resources` rather than the site's.
 */
export async function toPluginContext(
  ops: OpsContext,
  pluginName: string,
  pluginConfig: unknown,
): Promise<PluginContext<unknown>> {
  const store = new StateStore(ops.clients.s3, ops.names.bucket, ops.env, pluginName);
  const state = await store.load();
  return {
    env: ops.env,
    domain: ops.domain,
    preview: ops.preview,
    config: ops.config,
    pluginConfig,
    names: ops.names,
    accountId: ops.accountId,
    clients: ops.clients,
    ports: { fs: ops.ports.fs, terminal: ops.ports.terminal },
    tags: ops.tags,
    logger: ops.logger,
    store,
    state,
    siteState: ops.state,
    record: (nodeId, outputs) => {
      state.resources[nodeId] = outputs;
    },
    save: async () => {
      await store.save(state);
    },
  };
}

/**
 * The one action name `matchAction` failing to match against a plugin's own
 * `commands` falls through to the generic writer for - see `runGenericInit`
 * and the PRECEDENCE section of this module's own doc comment. Kept as a
 * named constant, mirrored (not imported - see that module's own DECISION
 * note) by `plugins.ts`'s discovery-time collision check, so both reads of
 * "the generic init action" spell it the same way without a cross-module
 * dependency neither side needs otherwise.
 */
const GENERIC_INIT_ACTION = 'init';

/**
 * Build the `io` an `init?(io)` contributor asks its own questions through,
 * entirely over the `Terminal` port - never `node:readline` directly, which
 * `.oxlintrc.json`'s `no-restricted-imports` enforces for this file (it
 * carries no override, unlike `init.ts`/`bin.ts`/the adapters). Every prompt
 * crosses `init.ts`'s exported `ask`, the SAME prompt/validate/retry loop
 * `blogwright init`'s own four questions use, so a plugin's contributor
 * never has to write its own. `ask` resolves `undefined` for an unanswered
 * optional question; `PluginInitIo.ask` promises a `string` always, per the
 * no-null rule, so the empty string stands in for "declined" here.
 */
function buildInitIo(terminal: Terminal, logger: Logger): PluginInitIo {
  return {
    isInteractive: terminal.isInteractive,
    logger,
    ask: async (question) => (await ask(terminal, logger, question)) ?? '',
  };
}

/**
 * Run the generic `blogwright <plugin> init` action: ask `contributor`'s
 * questions over the `Terminal` port, render what it returns, and splice it
 * into exactly the file `loadConfig` (`context.ts`) would read for `env` -
 * `resolveConfigPath` is the SAME candidate resolution `loadConfig` calls,
 * not a second string built here. Reached only once `matchAction` has
 * already failed to match the plugin's own `commands` and the leading word
 * is `init` - see this module's PRECEDENCE documentation above.
 *
 * The splice's own errors (an existing key, a document that is not a single
 * top-level object) propagate unchanged - this function adds nothing to
 * them - and `fs.writeText` runs only once the splice has already returned,
 * so a refused splice leaves the file byte-for-byte what it was.
 */
async function runGenericInit(
  plugin: Plugin<unknown>,
  contributor: (io: PluginInitIo) => Promise<PluginConfigBlockEntry[]>,
  repoRoot: string,
  afterAction: readonly string[],
  values: PluginValues,
  terminal: Terminal,
  logger: Logger,
  fs: FileSystem,
): Promise<number> {
  const configKey = plugin.configKey;
  if (!configKey) {
    // A plugin authoring bug, not an operator refusal: `init?(io)` exists to
    // fill in a `configKey`'s block, so a contributor with nowhere to file
    // its answers is unsatisfiable in the same way a declared `init` command
    // paired with a contributor is - just not one `plugins.ts`'s discovery
    // pass can catch ahead of time, since `configKey` says nothing about
    // whether `init` is also declared.
    throw new Error(
      `plugin "${plugin.name}" declares an init(io) contributor but no configKey - there is ` +
        'nothing to file its answered block under',
    );
  }

  const env = values.env ?? afterAction[0] ?? DEFAULT_ENV;
  const path = await resolveConfigPath(fs, { env, root: repoRoot, configPath: values.config });

  const entries = await contributor(buildInitIo(terminal, logger));
  if (entries.length === 0) {
    logger.info(`${plugin.name}: no questions answered - nothing written to ${path}`);
    return 0;
  }

  const text = await fs.readText(path);
  const rendered = renderConfigBlock(
    configKey,
    entries.map((entry) => ({ prop: entry.property, comment: entry.comment })),
  );
  const spliced = spliceConfigBlock({ path, text }, { key: configKey, rendered });
  // Re-parsed before it is trusted onto disk: a bug in the splice itself
  // must never reach the operator as an unloadable config file, which is the
  // one thing this whole feature promises never to do.
  parseConfig(spliced);
  await fs.writeText(path, spliced);
  logger.ok(`wrote "${configKey}" into ${path}`);
  return 0;
}

/**
 * The three action names that are always generic UNLESS gated out - see
 * this module's TASK 16 PRECEDENCE section. Kept as a named constant, the
 * same way `GENERIC_INIT_ACTION` is, though nothing outside this module
 * needs to spell any of the three: `plugins.ts`'s `rejectDeclaredLifecycleCollisions`
 * (which cares about two of them, never `status`) keeps its own literal set
 * rather than importing this one, for the same reason `GENERIC_INIT_ACTION`
 * is mirrored rather than shared - see that module's own DECISION note.
 *
 * The map carries each verb's SUMMARY beside its name because two places
 * need it and they must not drift: `genericLifecycleCommand` (below) hands
 * it to the synthetic `PluginCommand` it dispatches, and
 * {@link genericLifecycleActions} hands the same string to both listings
 * that advertise the verb (`renderActions` here, `renderPluginSection` in
 * `cli.ts`). A verb whose listed summary disagreed with the one it
 * dispatches under would be its own small lie.
 */
const GENERIC_LIFECYCLE_ACTIONS: ReadonlyMap<string, string> = new Map([
  ['bootstrap', "reconcile this plugin's resources"],
  ['status', "show this plugin's resource status"],
  ['destroy', "tear down this plugin's resources"],
]);

/** `--yes` rendered by `serialiseFlags`, above - what `genericLifecycleCommand`'s `destroy` reads back out of `args` to decide whether to refuse. */
const YES_FLAG = '--yes';

/**
 * Reconcile `plugin.nodes(ctx)` with the CLI's own engine - `applyGraph`
 * (`graph.ts`) - against the plugin's own scoped state. Mirrors
 * `commands.ts`'s own `bootstrap`, one context type narrower.
 */
async function runGenericBootstrap(
  plugin: Plugin<unknown>,
  nodesOf: (ctx: PluginContext<unknown>) => ResourceNode[],
  ctx: PluginContext<unknown>,
): Promise<void> {
  ctx.logger.info(colors.bold(`Bootstrapping "${plugin.name}" for "${ctx.env}"`));
  await applyGraph<PluginContext<unknown>>(nodesOf(ctx), ctx);
  ctx.logger.ok(`bootstrap complete for "${plugin.name}" in "${ctx.env}"`);
}

/**
 * Read `plugin.nodes(ctx)`'s live status via `commands.ts`'s `readNodeStatus`
 * - the same read loop the CLI's own `status` command runs - and render it
 * through the same interactive/plain branch (`render.ts`'s `logStatusEntries`,
 * shared with `commands.ts`'s `status` so neither carries its own copy of
 * that branch).
 */
async function runGenericStatus(
  plugin: Plugin<unknown>,
  nodesOf: (ctx: PluginContext<unknown>) => ResourceNode[],
  ctx: PluginContext<unknown>,
): Promise<void> {
  ctx.logger.info(colors.bold(`Status for "${plugin.name}" in "${ctx.env}"`));
  const entries = await readNodeStatus<PluginContext<unknown>>(nodesOf(ctx), ctx);
  logStatusEntries(entries, ctx.ports.terminal.isInteractive, ctx.logger);
}

/**
 * Tear down `plugin.nodes(ctx)` via the CLI's own engine - `destroyGraph`
 * (`graph.ts`) - then delete the plugin's own scoped state object, mirroring
 * `commands.ts`'s own `destroy`/`previewTeardown` (both call
 * `ctx.store.delete()` right after `destroyGraph`). Refuses without `--yes`,
 * the same contract `commands.ts`'s own `destroy` raises
 * (`refusing to destroy "<env>" without --yes`), naming the plugin too so
 * the refusal is unambiguous about which teardown was refused.
 */
async function runGenericDestroy(
  plugin: Plugin<unknown>,
  nodesOf: (ctx: PluginContext<unknown>) => ResourceNode[],
  ctx: PluginContext<unknown>,
  yes: boolean,
): Promise<void> {
  if (!yes) {
    throw new Error(`refusing to destroy "${plugin.name}" in "${ctx.env}" without --yes`);
  }
  ctx.logger.info(colors.bold(`Destroying "${plugin.name}" in "${ctx.env}"`));
  await destroyGraph<PluginContext<unknown>>(nodesOf(ctx), ctx);
  await ctx.store.delete();
  ctx.logger.ok(`destroyed "${plugin.name}" in "${ctx.env}"`);
}

/**
 * Build a synthetic `PluginCommand` for one of the three generic lifecycle
 * actions, so `runPlugin` can hand it to the exact same dispatch plumbing
 * (env resolution, context build, `command.run(ctx, args)`) a plugin's own
 * declared commands go through, rather than duplicating that plumbing for a
 * second time here. `undefined` when `action` is not one of the three
 * ({@link GENERIC_LIFECYCLE_ACTIONS}), or when `plugin` declares no `nodes`
 * contributor at all - the single gate all three verbs share, per this
 * module's TASK 16 PRECEDENCE section - so `runPlugin` needs no separate
 * check for either case: both fall straight through to the ordinary
 * unknown-action refusal.
 */
function genericLifecycleCommand(
  plugin: Plugin<unknown>,
  action: string | undefined,
): PluginCommand<unknown> | undefined {
  const nodesOf = plugin.nodes;
  if (!nodesOf || action === undefined) return undefined;
  const summary = GENERIC_LIFECYCLE_ACTIONS.get(action);
  if (summary === undefined) return undefined;
  switch (action) {
    case 'bootstrap':
      return { action, summary, run: async (ctx) => runGenericBootstrap(plugin, nodesOf, ctx) };
    case 'status':
      return { action, summary, run: async (ctx) => runGenericStatus(plugin, nodesOf, ctx) };
    default: // 'destroy' - GENERIC_LIFECYCLE_ACTIONS has exactly these three members.
      return {
        action,
        summary,
        run: async (ctx, args) => runGenericDestroy(plugin, nodesOf, ctx, args.includes(YES_FLAG)),
      };
  }
}

/**
 * The generic lifecycle verbs `plugin` actually answers, as `{ action,
 * summary }` pairs, for the two places that LIST a plugin's actions: the
 * unknown-action refusal ({@link renderActions}, below) and `--help`
 * (`cli.ts`'s `renderPluginSection`). Exported for the second of those;
 * both must list exactly what {@link genericLifecycleCommand} would
 * dispatch, or the listing advertises a verb the dispatcher refuses (or,
 * worse, hides one that works - the state this function was added to fix,
 * where a nodes-only plugin's refusal printed a heading and nothing at
 * all).
 *
 * Gated on `plugin.nodes` exactly as `genericLifecycleCommand` is, so a
 * plugin with no `nodes` contributor advertises none of the three. A verb
 * the plugin declares ITSELF is omitted here rather than listed twice: only
 * `status` can be declared (`bootstrap`/`destroy` are rejected at
 * discovery, `plugins.ts`'s `rejectDeclaredLifecycleCollisions`), and its
 * own command already appears in the caller's declared-command lines -
 * where `matchAction`'s precedence means that is the one that actually
 * runs.
 */
export function genericLifecycleActions(
  plugin: Plugin<unknown>,
): { action: string; summary: string }[] {
  if (!plugin.nodes) return [];
  const declared = new Set(plugin.commands.map((command) => command.action));
  return [...GENERIC_LIFECYCLE_ACTIONS]
    .filter(([action]) => !declared.has(action))
    .map(([action, summary]) => ({ action, summary }));
}

/**
 * Handle `blogwright <command> <action> [env] [args]` once `command` has
 * failed the `KNOWN_COMMANDS` membership test - i.e. it is either an
 * installed plugin's namespace or entirely unknown.
 *
 * `ports` - the `fs`/`loader` pair `discover` needs - is supplied by the
 * caller (`cli.ts`, from a small factory `bin.ts` wires to the real
 * adapters) rather than read off an `OpsContext` built here. An EARLIER
 * version of this function built a throwaway `OpsContext` first (via
 * `makeContext`, guessing `production` or `--env`'s value) purely to reach
 * its `ports.fs`/`ports.loader` for discovery, then rebuilt a second
 * context once the real environment was known. That guess was not merely
 * wasteful - it was WRONG on a repo whose only config file is for a
 * non-default environment: `blogwright <plugin> <action> staging` on a repo
 * with `config/staging.jsonc` and neither `config/production.jsonc` nor
 * `ops.config.jsonc` made the throwaway build's `loadConfig` call
 * (`context.ts`) throw `no config found for environment "production"` -
 * naming an environment the operator never asked for, before the real one
 * (`staging`) was ever read off the positionals. That is worse than the
 * silent fallback-to-production this dispatcher exists to avoid, because
 * the message actively misleads.
 *
 * `discover` only ever needed `Pick<Ports, 'fs' | 'loader'>` - both of which
 * `createContext` builds BEFORE it loads any config (`context.ts`), and
 * `cli.ts`'s `init` branch already constructs a `FileSystem` directly with
 * no context at all - so threading the same two ports in from the caller
 * removes the guess completely: the environment is resolved from
 * `command`'s matched action BEFORE any `OpsContext` - throwaway or real -
 * is built, and exactly one `makeContext` call happens, with the confirmed
 * environment, reusing the SAME `fs`/`loader` discovery already used rather
 * than letting a second call default fresh ones.
 *
 * EXIT CODES, and a deliberate deviation tasks 13/16/17 must not assume away.
 * This task's definition of done asks that "a plugin command's return value
 * maps to the process exit code". It cannot: `PluginCommand.run` is declared
 * `Promise<void>` (`blogwright-core`'s `plugin.ts`), and the change spec names
 * no return-code channel. So there is no value to map. What this dispatcher
 * owns it returns - 0 once `run` resolves, 1 for an unknown plugin and 1 for an
 * unknown action - and a command that genuinely fails signals it by REJECTING,
 * which propagates to `bin.ts`'s error path. Adding actions here (tasks 13, 16,
 * 17) means following that contract: reject to fail, do not invent a numeric
 * return the SPI has nowhere to carry.
 */
export async function runPlugin(
  command: string,
  rest: string[],
  values: PluginValues,
  terminal: Terminal,
  logger: Logger,
  makeContext: (opts: ContextOptions) => Promise<OpsContext>,
  ports: Pick<Ports, 'fs' | 'loader'>,
): Promise<number> {
  const repoRoot = await findRepoRoot(ports.fs);
  const { plugins } = await discover(repoRoot, cliPackageDir(), ports);

  const found = plugins.find((candidate) => candidate.name === command);
  if (!found) {
    logger.error(
      `no built-in command or installed plugin claims "${command}" - run ` +
        '`blogwright plugin list` to see what is installed',
    );
    return 1;
  }
  // Widened from `Plugin` (i.e. `Plugin<never>`) to `Plugin<unknown>` by this
  // annotation alone - no cast. `PluginCommand.run` is declared with method
  // syntax specifically so this widening typechecks bivariantly (see
  // `blogwright-core`'s `plugin.ts` doc comment on `Plugin`); the host must
  // never construct a `PluginContext<never>`, because nothing inhabits
  // `never` and reaching one would need the `as` cast DEVELOPMENT.md §Code
  // style bans.
  const plugin: Plugin<unknown> = found;

  let match = matchAction(plugin.commands, rest);
  if (!match) {
    // The generic `init` action - only reached because no declared command
    // matched. A plugin with its own `init` command never gets here for
    // that action (matchAction already returned it above); a plugin with
    // neither a command nor a contributor falls through toward the generic
    // lifecycle check below, and from there to the unknown-action refusal.
    if (rest[0] === GENERIC_INIT_ACTION && typeof plugin.init === 'function') {
      return runGenericInit(
        plugin,
        plugin.init,
        repoRoot,
        rest.slice(1),
        values,
        terminal,
        logger,
        ports.fs,
      );
    }
    // The generic `bootstrap`/`status`/`destroy` lifecycle verbs - see this
    // module's TASK 16 PRECEDENCE section. Wrapped as a synthetic
    // single-word `ActionMatch` so it falls through the SAME env
    // resolution/context build/`run(ctx, args)` plumbing every declared
    // command already uses below, rather than a second copy of it here.
    const generic = genericLifecycleCommand(plugin, rest[0]);
    if (!generic) {
      logger.error(`unknown ${plugin.name} action: ${rest[0] ?? '(none)'}`);
      logger.info(renderActions(plugin));
      return 1;
    }
    match = { command: generic, wordCount: 1 };
  }

  const afterAction = rest.slice(match.wordCount);
  const envPositional = afterAction[0];
  const args = [...afterAction.slice(1), ...serialiseFlags(values)];
  const env = values.env ?? envPositional ?? DEFAULT_ENV;

  const ctx = await makeContext({
    env,
    configPath: values.config,
    domain: values.domain,
    endpointOverride: values.endpoint,
    ports: { terminal, fs: ports.fs, loader: ports.loader },
  });

  // Validated BEFORE `toPluginContext`, which loads the plugin's own scoped
  // state object: a plugin that refuses its own config block must fail
  // before the dispatch makes an AWS call on its behalf, and certainly
  // before its command runs. This is the one call site - the DISPATCHED
  // plugin's block and no other (`plugins.ts`'s task-19 DECISION note).
  const pluginConfig = resolvePluginConfig(plugin, ctx.configDocument);

  await match.command.run(await toPluginContext(ctx, plugin.name, pluginConfig), args);
  return 0;
}

/*
 * TASK 17 - the built-in `plugin` namespace.
 *
 * `runPluginNamespace` is NOT reached through `runPlugin` above: `plugin` is
 * a member of `KNOWN_COMMANDS` (`known-commands.ts`), so no installed plugin
 * can ever claim the name, and `cli.ts` dispatches it directly. It is
 * dispatched BEFORE `createContext` - beside the `init` branch, not from the
 * built-in `switch` - because `createContext` loads the environment's config
 * and calls `sts.getAccountId()`, neither of which holds on the repo this
 * namespace exists to serve: `blogwright plugin list` on a checkout with no
 * `config/<env>.jsonc` and no AWS credentials would otherwise fail with `no
 * config found for environment "production"` instead of printing the
 * empty-state line that names `blogwright plugin add` - the very command an
 * operator runs BEFORE the repo is configured. Nothing this namespace does
 * needs an environment at all, which is why it takes ports rather than a
 * `ContextFactory`.
 */

/**
 * The `plugin` namespace's own actions, `action -> summary`, in the same
 * shape {@link GENERIC_LIFECYCLE_ACTIONS} uses - so the refusal listing
 * ({@link renderPluginNamespaceActions}) is built from the same table the
 * dispatcher matches against and cannot advertise an action that does not
 * run, or hide one that does. Tasks 18 and 19 add `add` and `remove` here.
 */
const PLUGIN_NAMESPACE_ACTIONS: ReadonlyMap<string, string> = new Map([
  ['add', "install a plugin package, pinned to the CLI's own version"],
  ['list', 'show installed plugins, their versions and the config key each owns'],
  ['remove', 'uninstall a plugin package, asking first about its teardown'],
]);

/**
 * Printed when a repo has no plugins installed. Names the command that
 * installs one, because an empty listing with nothing else on it reads as a
 * broken command rather than an accurate report.
 */
const NO_PLUGINS_INSTALLED =
  'no plugins installed - run `blogwright plugin add <name>` to install one';

/**
 * List the `plugin` namespace's actions for a refusal, in the same shape
 * {@link renderActions} renders an installed plugin's actions in, so the two
 * refusals an operator can hit read identically.
 */
function renderPluginNamespaceActions(): string {
  return [
    '"plugin" actions:',
    ...Array.from(PLUGIN_NAMESPACE_ACTIONS, ([action, summary]) => `  ${action} - ${summary}`),
  ].join('\n');
}

/** Narrow parsed JSON to an object before reading a field off it - no cast, no `any`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read one plugin package's own declared `version` through the `FileSystem`
 * port - never a table in this module, never a registry lookup, so the
 * listing reports what is actually installed on this machine and works with
 * no network.
 *
 * `packageJsonPath` is what `ModuleLoader.packageJsonPathFor` resolved during
 * discovery (`plugins.ts`'s `InstalledPlugin`), not a path this module
 * builds from `ModuleLoader.resolve`'s entry file: for a package published
 * with the standard dual-package layout, the directory holding the entry
 * point carries a name-less `{"type":"module"}` stub rather than the
 * manifest.
 *
 * The file is re-read here rather than carried out of discovery already
 * parsed, so that `--help` and plugin dispatch - which run the same discovery
 * but never show a version - keep paying nothing for this field.
 *
 * `undefined`, rendered as an explicit marker by `render.ts`, for a manifest
 * that declares no `version` (a private workspace package, an unpublished
 * plugin under development). An unreadable or unparseable manifest is a
 * different thing entirely - the file discovery itself read moments ago,
 * broken underneath us - and propagates, exactly as the same distinction is
 * drawn between a MISSING and a MALFORMED `package.json` in `cli.ts`'s
 * `isMissingPackageJsonError`.
 */
async function readPackageVersion(
  fs: FileSystem,
  packageJsonPath: string,
): Promise<string | undefined> {
  const parsed: unknown = JSON.parse(await fs.readText(packageJsonPath));
  if (!isRecord(parsed)) return undefined;
  const version = parsed.version;
  return typeof version === 'string' && version.length > 0 ? version : undefined;
}

/**
 * Run `blogwright plugin list`: one row per installed plugin - namespace,
 * package, version and the config key it owns - plus one line per plugin
 * that failed to load, with the reason `discover` produced.
 *
 * Always returns 0. This is a REPORT: its exit code says the listing was
 * produced, not that every plugin in it is healthy - the same contract
 * `blogwright --help` already has (it lists load failures and exits 0) and
 * `status` has for drift. A failed plugin is data in the listing, and an
 * empty listing is never an error.
 *
 * Rows are ordered by namespace, never by `discover`'s own array order: the
 * candidate set is built from two `dependencies`/`devDependencies` maps
 * (`plugins.ts`'s `collectCandidates`) whose key order is an implementation
 * detail of those manifests, not something a CI-consumed listing should vary
 * with. The same reason - and the same plain string comparison rather than
 * `localeCompare` - as `cli.ts`'s `buildHelp`.
 */
async function runPluginList(
  ports: Pick<Ports, 'fs' | 'loader'>,
  terminal: Terminal,
  logger: Logger,
): Promise<number> {
  const repoRoot = await findRepoRoot(ports.fs);
  const discovered = await discover(repoRoot, cliPackageDir(), ports);

  const rows: PluginListRow[] = [];
  for (const entry of discovered.installed) {
    rows.push({
      namespace: entry.plugin.name,
      packageName: entry.packageName,
      version: await readPackageVersion(ports.fs, entry.packageJsonPath),
      configKey: entry.plugin.configKey,
    });
  }
  rows.sort((a, b) => (a.namespace < b.namespace ? -1 : a.namespace > b.namespace ? 1 : 0));

  // Printed whenever nothing LOADED, even when a failure line follows it: a
  // repo whose only plugin is broken has no usable plugin installed, and the
  // failure below says which one and why.
  if (rows.length === 0) logger.info(NO_PLUGINS_INSTALLED);
  const listing = { rows, failures: discovered.failures };
  for (const line of renderPluginList(listing, terminal.isInteractive)) logger.info(line);
  return 0;
}

/*
 * TASK 18 - `blogwright plugin add` and `blogwright plugin remove`.
 *
 * Both join `PLUGIN_NAMESPACE_ACTIONS` above and stay on the SAME side of
 * `cli.ts`'s dispatch line `list` does - ahead of `createContext` - which
 * matters more for `add` than for anything else in this namespace: installing
 * a plugin is what an operator does BEFORE the repo has a `config/<env>.jsonc`
 * or a usable AWS session, and a command that needed either to install a
 * package would be unusable exactly when it is wanted.
 *
 * NOTHING here shells out. Every install and uninstall crosses the
 * `PackageManager` port (`ports.ts`), whose one real adapter
 * (`adapters/process-package-manager.ts`) is constructed at the composition
 * root and injected as a FACTORY (`PluginNamespaceDeps.makePackages`) that
 * only these two verbs ever call - so `list`, and every refusal below,
 * construct no package manager at all.
 *
 * EXIT CODES, and the deliberate difference from `list`. `list` always
 * returns 0 because it is a REPORT: producing the listing is the whole job,
 * and a plugin in it that failed to load is data. These two are ACTIONS, and
 * an action that did not happen must not look like one that did:
 *
 *   - `add` of an already-installed plugin returns 0. The requested state -
 *     the plugin is installed - holds, so the run succeeded; re-running an
 *     install must be idempotent for any script that wraps it.
 *   - `remove` of a plugin that is not installed returns 1, NOT 0. This is
 *     the asymmetry worth stating: it is the shape of a name typo
 *     (`blogwright plugin remove analytcs`), and answering a typo with a
 *     success code is how a CI step "uninstalls" a plugin that is still
 *     installed. Idempotence is not the property here; "the package you named
 *     is not here" is.
 *   - Every refusal - no name, a name that is not a package name, a teardown
 *     question this session cannot ask - returns 1 and calls neither the
 *     package-manager port nor the destroy path.
 */

/**
 * What `add` and `remove` need beyond the `fs`/`loader` pair `list` runs on.
 * A single object rather than four more positional parameters, and every
 * member is a FACTORY or a value rather than a live port, so a refusal path
 * pays for none of them:
 *
 *   - `values` - the same parsed flags `runPlugin` reads (`--yes`, `--env`,
 *     and the context overrides `remove`'s teardown branch forwards).
 *   - `makePackages` - the `PackageManager` port, built at the composition
 *     root. Called at most once per invocation, and never by `list` or by any
 *     refusal.
 *   - `cliVersion` - the running CLI's own version (`context.ts`'s
 *     `cliVersion`), resolved there because this module may not touch
 *     `node:fs`. Called only once `add` has decided it is going to install
 *     something.
 *   - `makeContext` - the ONE `OpsContext` `remove`'s "tear it down first"
 *     branch needs, and the only path in this namespace that builds one at
 *     all. Never called for `add`, for `list`, or for a `remove` that does
 *     not run a teardown.
 */
export interface PluginNamespaceDeps {
  readonly values: PluginValues;
  readonly makePackages: () => PackageManager;
  readonly cliVersion: () => Promise<string>;
  readonly makeContext: (opts: ContextOptions) => Promise<OpsContext>;
}

/** The prefix a short plugin name is expanded with - `analytics` -> `blogwright-analytics`. */
const PLUGIN_PACKAGE_PREFIX = 'blogwright-';

/**
 * Expand a short plugin name into the package name to install or uninstall,
 * per §CLI → `blogwright plugin`: `analytics` becomes `blogwright-analytics`,
 * while a name containing `/` (a scoped package, `@scope/thing`) or already
 * starting with `blogwright-` is a literal package name and is returned
 * unchanged.
 *
 * Pure, and deliberately total: it never throws and never rejects. What is
 * ACCEPTABLE as a package name at all is a separate question, asked of the
 * RESULT by {@link PACKAGE_NAME_PATTERN} below - because both halves of this
 * function can produce something that is not a package name (`./evil` passes
 * through the `/` branch; `analytics@9.9.9` becomes
 * `blogwright-analytics@9.9.9`), and one gate over the result catches both.
 */
function resolvePluginPackage(name: string): string {
  return name.includes('/') || name.startsWith(PLUGIN_PACKAGE_PREFIX)
    ? name
    : `${PLUGIN_PACKAGE_PREFIX}${name}`;
}

/**
 * The package names these two verbs will hand to the `PackageManager` port:
 * npm's own grammar - an optional `@scope/` followed by a name of lowercase
 * ASCII alphanumerics, `-`, `.`, `_` and `~`.
 *
 * Two deliberate narrowings of npm's published pattern, both because the
 * value becomes an ARGUMENT VECTOR element for `pnpm add`/`npm uninstall`
 * (`adapters/process-package-manager.ts`):
 *
 *   - No leading `-`, so no input can arrive at the package manager as a
 *     FLAG. (`blogwright plugin add --force` never gets that far anyway - it
 *     is parsed as a flag by `main` - but `resolvePluginPackage` is not the
 *     place to rely on that.)
 *   - No leading `.`, so `./local-thing` and `../..` are refused rather than
 *     installed as a filesystem path. npm's own pattern already excludes
 *     these; it is stated here because it is the point.
 *
 * The `@` character is absent from the name body, which is what refuses
 * `analytics@9.9.9`: a caller must not be able to smuggle a version past
 * `add`'s pin by writing one into the name, because the resulting spec would
 * be `blogwright-analytics@9.9.9@0.3.3` - a request no manager can satisfy,
 * and, worse, a shape the version pin exists to make impossible.
 */
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9~][a-z0-9\-._~]*\/)?[a-z0-9~][a-z0-9\-._~]*$/;

/**
 * True when `packageName` is declared in the consuming repo's own
 * `package.json` - the same two maps discovery builds its candidate set from
 * (`plugins.ts`'s `collectCandidates`), read through the `FileSystem` port.
 *
 * This, not module resolution, is what "installed" means for both verbs, and
 * for the same reason in each direction: `add` must not re-install a plugin
 * the manifest already pins (even one whose `node_modules` copy is missing -
 * that is `pnpm install`'s job, not this command's), and `remove` must be
 * able to uninstall a plugin whose module no longer resolves at all, which is
 * precisely the state a half-broken install leaves behind.
 *
 * A missing or unparseable manifest propagates rather than being read as "no
 * dependencies": a repo with no `package.json` has no package manager to run
 * either, and silently treating that as an empty dependency set would make
 * `remove` report a plugin absent when nothing was actually checked.
 */
async function isDeclaredDependency(
  fs: FileSystem,
  repoRoot: string,
  packageName: string,
): Promise<boolean> {
  const parsed: unknown = JSON.parse(await fs.readText(join(repoRoot, 'package.json')));
  if (!isRecord(parsed)) return false;
  for (const field of ['dependencies', 'devDependencies']) {
    const declared = parsed[field];
    if (isRecord(declared) && Object.hasOwn(declared, packageName)) return true;
  }
  return false;
}

/**
 * Install one plugin package, pinned to the running CLI's own version.
 *
 * The order of the three steps is the contract: the manifest check comes
 * FIRST, so an already-installed plugin reports that and returns 0 having
 * touched neither the version read nor the `PackageManager` port; only then
 * is the version resolved and the port built and called.
 *
 * `exact: true` is what makes the pin survive. The spec string alone
 * (`blogwright-analytics@0.3.3`) tells the manager WHICH version to fetch,
 * but every supported manager would then write a `^0.3.3` RANGE into
 * `package.json` - so the next `install` on a colleague's checkout could
 * resolve something else entirely, `blogwright plugin list`'s version column
 * would stop meaning "the version this repo pins", and the CLI and its plugin
 * could drift apart across two developers' machines without either of them
 * changing anything.
 */
async function runPluginAdd(
  packageName: string,
  ports: Pick<Ports, 'fs'>,
  logger: Logger,
  deps: PluginNamespaceDeps,
): Promise<number> {
  const repoRoot = await findRepoRoot(ports.fs);
  if (await isDeclaredDependency(ports.fs, repoRoot, packageName)) {
    logger.info(`${packageName} is already installed - nothing to do`);
    return 0;
  }
  const spec = `${packageName}@${await deps.cliVersion()}`;
  await deps.makePackages().add(spec, { exact: true });
  logger.ok(`installed ${spec} - run \`blogwright plugin list\` to see the namespace it claims`);
  return 0;
}

/**
 * Resolve and load the ONE plugin `remove` is about to uninstall, so the
 * command knows whether it has resources to ask about.
 *
 * A single `resolve` + `load` pair through the `ModuleLoader` port - never
 * `discover` - so §Plugin discovery's laziness rule is untouched: removing
 * one plugin does not resolve, import or validate every other plugin in the
 * repo.
 *
 * `undefined` for every way that can fail - unresolvable, unimportable, or
 * rejected by `validatePlugin` - because all of them mean the same thing to
 * this command: there is no teardown to ask about. A broken plugin could not
 * run its `destroy` if we asked, so asking would be a question with one
 * honest answer. It is reported no further than that (no warning line): the
 * package is on its way out, `blogwright plugin list` is the command that
 * names load failures, and a refusal-shaped message about a package the
 * operator has just asked to delete would be noise.
 */
async function loadPluginForRemoval(
  packageName: string,
  repoRoot: string,
  ports: Pick<Ports, 'loader'>,
): Promise<Plugin<unknown> | undefined> {
  try {
    const entry = await ports.loader.resolve(packageName, repoRoot);
    if (!entry.found) return undefined;
    return validatePlugin(await ports.loader.load(entry.path), packageName);
  } catch {
    return undefined;
  }
}

/**
 * Run the plugin's own generic `destroy` before it is uninstalled - the exact
 * tail `runPlugin` runs for `blogwright <plugin> destroy --yes`: one
 * `makeContext` for the resolved environment, the plugin's OWN config block
 * validated off that context's raw document (`resolvePluginConfig`), the
 * narrow `PluginContext` with its scoped state store (`toPluginContext`), and
 * task 16's `runGenericDestroy` over `plugin.nodes(ctx)`.
 *
 * Reached only from an answered "yes", which is why `yes` is passed as `true`
 * here: the operator has just answered the question `runGenericDestroy`'s own
 * `--yes` refusal exists to force.
 *
 * A rejection propagates and the uninstall never runs - the caller awaits
 * this before touching the `PackageManager` port. That ordering is the whole
 * point: a teardown that failed must leave the package installed, so the
 * operator can fix the cause and run `blogwright <plugin> destroy --yes`
 * again.
 */
async function destroyBeforeRemoval(
  plugin: Plugin<unknown>,
  nodesOf: (ctx: PluginContext<unknown>) => ResourceNode[],
  env: string,
  ports: Pick<Ports, 'fs' | 'loader'>,
  terminal: Terminal,
  deps: PluginNamespaceDeps,
): Promise<void> {
  const ops = await deps.makeContext({
    env,
    configPath: deps.values.config,
    domain: deps.values.domain,
    endpointOverride: deps.values.endpoint,
    ports: { terminal, fs: ports.fs, loader: ports.loader },
  });
  const pluginConfig = resolvePluginConfig(plugin, ops.configDocument);
  await runGenericDestroy(
    plugin,
    nodesOf,
    await toPluginContext(ops, plugin.name, pluginConfig),
    true,
  );
}

/**
 * Uninstall one plugin package, asking first whether its resources should be
 * torn down - §CLI → `blogwright plugin`, and the settled decision
 * *`plugin remove` asks about teardown; a session that cannot ask is refused,
 * not defaulted*.
 *
 * The question is load-bearing because removal FORECLOSES ITS OWN REMEDY: the
 * generic `blogwright <plugin> destroy` verb exists only while the package is
 * installed, so an operator who uninstalls first has to reinstall before they
 * can tear anything down.
 *
 * That is also why the non-interactive path REFUSES rather than taking a
 * default. `confirm` (`logger.ts`) answers with its default when no TTY is
 * attached, which is right wherever one answer is safe; here neither is -
 * running a teardown nobody asked for is destructive, and skipping it strands
 * AWS resources behind a reinstall. So this follows `initSite`'s refusal
 * shape instead, naming BOTH ways forward, and `--yes` is the scripted
 * "uninstall, keep the resources" answer. `--plain` needs no separate test
 * here: `createNodeTerminal` builds a non-interactive terminal for it
 * (`plain` forces `isInteractive` false), so it arrives as the same
 * non-interactive session, and `terminal.isInteractive` stays the single
 * source of truth for "can this session be asked a question".
 */
async function runPluginRemove(
  name: string,
  packageName: string,
  afterName: readonly string[],
  ports: Pick<Ports, 'fs' | 'loader'>,
  terminal: Terminal,
  logger: Logger,
  deps: PluginNamespaceDeps,
): Promise<number> {
  const repoRoot = await findRepoRoot(ports.fs);
  if (!(await isDeclaredDependency(ports.fs, repoRoot, packageName))) {
    logger.error(
      `${packageName} is not a dependency of ${repoRoot} - nothing to remove; run ` +
        '`blogwright plugin list` to see what is installed',
    );
    return 1;
  }

  const plugin = await loadPluginForRemoval(packageName, repoRoot, ports);
  const nodesOf = plugin?.nodes;
  // The NAMESPACE `blogwright <namespace> destroy` actually dispatches on -
  // the plugin's own declared name, which need not match the package it ships
  // in (`blogwright-metrics` may claim `widget`) or the short name typed here.
  // Falls back to what was typed for a plugin that did not load, which is the
  // best guess available and the only one an operator could act on anyway.
  const namespace = plugin?.name ?? name;
  // The usual positional/`--env` rule every built-in command follows, applied
  // to `blogwright plugin remove <name> [env]`.
  const env = deps.values.env ?? afterName[0] ?? DEFAULT_ENV;

  let tornDown = false;
  if (plugin !== undefined && nodesOf !== undefined && !deps.values.yes) {
    if (!terminal.isInteractive) {
      logger.error(
        `removing ${packageName} would strand the resources "${namespace}" provisioned in ` +
          `"${env}", and this session cannot be asked about them: run \`blogwright ${namespace} ` +
          'destroy --yes` first to tear them down, or re-run `blogwright plugin remove ' +
          `${name} --yes\` to uninstall and keep them`,
      );
      return 1;
    }
    tornDown = await confirm(
      terminal,
      `tear down "${namespace}"'s resources in "${env}" before removing ${packageName}?`,
      { defaultYes: false },
    );
    if (tornDown) await destroyBeforeRemoval(plugin, nodesOf, env, ports, terminal, deps);
  }

  await deps.makePackages().remove(packageName);
  logger.ok(
    tornDown
      ? `removed ${packageName} - its "${env}" resources were torn down first, and its ` +
          'configuration is untouched'
      : `removed ${packageName} - configuration and provisioned resources are untouched; ` +
          `\`blogwright ${namespace} destroy\` tears them down and needs ${packageName} ` +
          'reinstalled to run',
  );
  return 0;
}

/**
 * Handle `blogwright plugin <action>`. Dispatched by `cli.ts` ahead of any
 * `OpsContext` - see this section's own comment above for why that placement
 * is load-bearing rather than merely tidy.
 *
 * An absent or unrecognised action lists the namespace's actions and returns
 * 1, the same shape `runPlugin` refuses an unknown action of an installed
 * plugin in. `add` and `remove` share this function's name resolution and
 * validation - one gate, so the two verbs cannot disagree about what
 * `analytics` means or about what is a package name at all.
 */
export async function runPluginNamespace(
  rest: readonly string[],
  terminal: Terminal,
  logger: Logger,
  ports: Pick<Ports, 'fs' | 'loader'>,
  deps: PluginNamespaceDeps,
): Promise<number> {
  const action = rest[0];
  if (action === undefined || !PLUGIN_NAMESPACE_ACTIONS.has(action)) {
    logger.error(`unknown plugin action: ${action ?? '(none)'}`);
    logger.info(renderPluginNamespaceActions());
    return 1;
  }
  if (action === 'list') return runPluginList(ports, terminal, logger);

  const name = rest[1];
  // An EMPTY name is a missing one, not a package name: `blogwright plugin
  // add ""` resolves to the bare prefix `blogwright-`, which the pattern
  // below accepts, so without this the operator gets the package manager's
  // 404 rather than the message that says what to type.
  if (name === undefined || name === '') {
    logger.error(
      `\`blogwright plugin ${action}\` needs a plugin name - e.g. \`blogwright plugin ${action} analytics\``,
    );
    return 1;
  }
  const packageName = resolvePluginPackage(name);
  // The pattern is asked of the RAW name as well as the resolved one, because
  // the `blogwright-` expansion hides a leading `.`: `..` resolves to
  // `blogwright-..`, which npm's grammar accepts, so the gate over the
  // resolved name alone would pass a path-shaped input to the package manager.
  // The raw test is NOT redundant with the resolved one and must not be
  // folded back into it. For a scoped name or an already-prefixed one the two
  // test the same string; everywhere else the raw test is the only thing that
  // sees what the prefix covered up. What it costs, over the resolved test
  // alone, is exactly the names the prefix would have made respectable: a
  // name of otherwise-legal package characters that OPENS with `-`, `.` or
  // `_` (`.`, `..`, `.npmrc`, `-rf`). Any other rejected opening character -
  // `A`, `$`, a space - fails the resolved test too, so the raw test adds
  // nothing there. And it strands nothing: whoever genuinely wants
  // `blogwright-.x` spells that package name out, which already starts with
  // the prefix, so it resolves to itself and clears both tests.
  if (!PACKAGE_NAME_PATTERN.test(name) || !PACKAGE_NAME_PATTERN.test(packageName)) {
    logger.error(
      `"${name}" is not a plugin package name - \`blogwright plugin ${action}\` takes a short ` +
        'name (`analytics`, installed as `blogwright-analytics`), a `blogwright-` package name, ' +
        'or a scoped package name (`@scope/thing`)',
    );
    return 1;
  }
  // `PLUGIN_NAMESPACE_ACTIONS` has exactly three members and `list` returned
  // above; the membership test at the top is what keeps this exhaustive.
  return action === 'add'
    ? runPluginAdd(packageName, ports, logger, deps)
    : runPluginRemove(name, packageName, rest.slice(2), ports, terminal, logger, deps);
}
