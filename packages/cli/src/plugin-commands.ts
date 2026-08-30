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
 *      environment is confirmed, adapts it into the narrow `PluginContext`
 *      the SPI promises (`toPluginContext`, below), and runs the matched
 *      command, mapping a normal return to exit code 0.
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
 */

import {
  findRepoRoot,
  parseConfig,
  type ConfigBlockEntry as PluginConfigBlockEntry,
  type FileSystem,
  type Plugin,
  type PluginCommand,
  type PluginContext,
  type PluginInitIo,
  type Terminal,
} from 'blogwright-core';

import { renderConfigBlock, spliceConfigBlock } from './config-block.js';
import {
  cliPackageDir,
  resolveConfigPath,
  type ContextOptions,
  type OpsContext,
} from './context.js';
import { ask } from './init.js';
import type { Logger } from './logger.js';
import type { Ports } from './ports.js';
import { discover } from './plugins.js';

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

/** Render a plugin's declared actions, one per line, for an unknown-action refusal. */
function renderActions(plugin: Plugin<unknown>): string {
  return [
    `"${plugin.name}" actions:`,
    ...plugin.commands.map((command) => `  ${command.action} - ${command.summary}`),
  ].join('\n');
}

/**
 * Adapt an `OpsContext` into the narrow `PluginContext` a plugin command
 * runs against. This is an ADAPTATION, not an assignment: an `OpsContext`
 * carries thirteen of `PluginContext`'s sixteen members and none of
 * `pluginConfig`, `siteState` or `record`, so a bare assignment is
 * `TS2739`. This function supplies exactly those three - plus the
 * two-member `ports` `PluginPorts` narrows the CLI's six-member `Ports`
 * to - and passes every other member through unchanged. No cast, no `any`,
 * anywhere in it.
 *
 * `pluginConfig` is `{}` until task 19 reads it from the plugin's own
 * `validateConfig` over `configDocument[plugin.configKey]`; no plugin
 * declares `configKey` before then, so nothing reads `pluginConfig` as
 * anything but the empty object the no-null rule requires in its place.
 * This function has no `plugin: Plugin<unknown>` parameter yet because
 * nothing in it needs one - both later extensions do, and are expected to
 * EXTEND this function rather than recreate it: task 16 needs `plugin.name`
 * to build the scoped `StateStore` (see below), and task 19 needs
 * `plugin.configKey`/`plugin.validateConfig` for `pluginConfig`. Add the
 * parameter when the first of the two lands, not before.
 *
 * `siteState` is `ops.state` passed through as the read-only view the SPI
 * promises, and `record` writes into `ops.state.resources` directly.
 * CRITICALLY, `store`, `state` and `save()` are STILL the site's own, byte
 * for byte - task 16 is what re-points all three at a `StateStore` scoped
 * to the plugin's own name. The compiler will not catch this: `OpsContext`'s
 * `store`/`state`/`save()` typecheck straight through as `PluginContext`'s
 * of the same names with no error, because the TYPES happen to line up even
 * though the STORAGE they point at does not yet. Until task 16 lands, every
 * one of the three state surfaces this function builds reads and writes the
 * SITE's own `state/<env>.json` - which is exactly why nothing between this
 * task and task 16 may call a plugin's `nodes(ctx)` against a context this
 * function built: doing so would silently record a plugin's resources into
 * the site's own state document instead of a scoped one.
 */
export function toPluginContext(ops: OpsContext): PluginContext<unknown> {
  return {
    env: ops.env,
    domain: ops.domain,
    preview: ops.preview,
    config: ops.config,
    pluginConfig: {},
    names: ops.names,
    accountId: ops.accountId,
    clients: ops.clients,
    ports: { fs: ops.ports.fs, terminal: ops.ports.terminal },
    tags: ops.tags,
    logger: ops.logger,
    store: ops.store,
    state: ops.state,
    siteState: ops.state,
    record: (nodeId, outputs) => {
      ops.state.resources[nodeId] = outputs;
    },
    save: ops.save,
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

  const match = matchAction(plugin.commands, rest);
  if (!match) {
    // The generic `init` action - only reached because no declared command
    // matched. A plugin with its own `init` command never gets here for
    // that action (matchAction already returned it above); a plugin with
    // neither a command nor a contributor falls through to the same unknown
    // action refusal every other unmatched action gets, which already
    // reports the action unavailable and lists what the plugin does have.
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
    logger.error(`unknown ${plugin.name} action: ${rest[0] ?? '(none)'}`);
    logger.info(renderActions(plugin));
    return 1;
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

  await match.command.run(toPluginContext(ctx), args);
  return 0;
}
