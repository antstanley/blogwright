/**
 * The plugin service-provider interface (SPI) vocabulary. A plugin is a
 * package that depends on `blogwright-core` and never on the CLI - it never
 * imports from `blogwright` (the CLI package), only from this module and the
 * rest of core. The CLI's own `OpsContext` (`packages/cli/src/context.ts`) is
 * deliberately wider than what a plugin is handed: it carries CLI-private
 * concerns - `agentDir` (the build-agent artifact directory) and the full
 * `Ports` (`vcs`, `ping`, and any port a later CLI feature adds) - that a
 * plugin must never see, because seeing them would let a plugin depend on
 * types this module cannot even name. `PluginContext<TConfig>` below is the
 * narrow slice the CLI carves out of `OpsContext` at the dispatch boundary
 * for a plugin command to run against.
 */

import type { AwsClients } from './clients.js';
import type { Names, OpsConfig } from './config.js';
import type { FileSystem, Terminal } from './ports.js';
import type { OpsState, ResourceOutputs, StateStore } from './state.js';

/**
 * Leveled logger surface a plugin command reports through. Restates the CLI's
 * `Logger` (`packages/cli/src/logger.ts`) and pds's `PdsLogger`
 * (`packages/pds/src/context.ts`) so this module never imports either.
 */
export interface PluginLogger {
  info(msg: string): void;
  step(msg: string): void;
  ok(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/**
 * The two ports core owns that a plugin may cross: repo files and the
 * operator's terminal. Deliberately narrower than the CLI's six-member
 * `Ports` (`packages/cli/src/ports.ts`) - `vcs` and `ping` are CLI-private
 * ports declared in the CLI, and any port a later CLI feature adds joins
 * them - so a `PluginContext` declared in core cannot name any of those
 * types. A separate declaration from the CLI's `Ports`, rather than a
 * `Pick`, keeps this module free of any import from the CLI.
 */
export interface PluginPorts {
  fs: FileSystem;
  terminal: Terminal;
}

/**
 * A **read-only** view of the site's recorded outputs (`state/<env>.json`).
 * A plugin reads it to find resources the site owns - the analytics
 * log-delivery node reads the site's CloudFront distribution ARN through it
 * - but can never write through it: every property is `readonly`, all the
 * way into the map values, so `ctx.siteState.resources['x'] = {}` does not
 * typecheck. This is one of the two state surfaces a plugin sees (see
 * {@link PluginContext.siteState}); the plugin's own, writable state is
 * `PluginContext.state`. Any `OpsState` (`state.ts`) satisfies this type
 * structurally - a mutable property is assignable to a `readonly` one of the
 * same type - so the CLI needs no wrapper object to hand its site state to a
 * plugin this way.
 */
export interface SiteState {
  readonly resources: Readonly<Record<string, Readonly<ResourceOutputs>>>;
}

/**
 * The narrow slice of the host CLI's context a plugin command receives,
 * generic over `TConfig` - the shape of the config block the plugin owns
 * (the block its own `validateConfig` returned). It names exactly sixteen
 * members and nothing else; the enumeration is exhaustive on purpose,
 * because plugins are written against this type before they exercise it. A
 * field left out here surfaces as a compile error many features downstream,
 * not a runtime one.
 *
 * Every member is required except {@link PluginContext.tags}.
 */
export interface PluginContext<TConfig = never> {
  /** The environment name (e.g. `production`), the same value `names` was derived from. */
  env: string;
  /** The site's domain, when the site has one configured. */
  domain: string | undefined;
  /** True for the shared preview stack (host-routed, per-PR prefixes). */
  preview: boolean;
  /** The full, validated site config. A plugin's own block is `pluginConfig`, not a key read off this - `OpsConfig` has no index signature to read a plugin's key from. */
  config: OpsConfig;
  /**
   * The plugin's own config block, as returned by its `validateConfig`. A
   * plugin reads its settings from here, never from `ctx.config`: `OpsConfig`
   * (`config.ts`) has no index signature, so `ctx.config.<pluginKey>` does
   * not compile, and casting or widening to `any` around that is banned by
   * DEVELOPMENT.md §Code style. Returning the validated block also gives a
   * plugin's own defaults somewhere to live, so every reader keeps a total
   * type instead of re-checking for `undefined`.
   */
  pluginConfig: TConfig;
  /**
   * Deterministic, environment-prefixed resource names the site derived.
   * `names.deliverySource` is load-bearing for the analytics plugin: it hangs
   * its CloudFront log delivery off the source name the site already owns,
   * rather than deriving a second one.
   */
  names: Names;
  /**
   * The AWS account id the site's resources live in. Both the pds and
   * analytics plugins build IAM resource ARNs from it directly (for example
   * `arn:aws:secretsmanager:<region>:<accountId>:secret:<name>-*`).
   */
  accountId: string;
  /** The signed AWS service clients the host built, shared with every node this context reaches. */
  clients: AwsClients;
  /** The two ports core owns. See {@link PluginPorts} for what stays CLI-side. */
  ports: PluginPorts;
  /**
   * Tags applied to every AWS resource this stack creates. Optional - not
   * merely possibly-empty - under `exactOptionalPropertyTypes`, because
   * `PdsContext` (`packages/pds/src/context.ts`) already declares it this
   * way and `createTestContext` (`packages/pds/src/test-support.ts`) builds
   * a complete feature context without one; a required `tags` here would
   * propagate through the pds migration's `Pick` and break every existing
   * pds test.
   */
  tags?: Record<string, string> | undefined;
  /** Leveled logger a plugin command reports progress, successes, and failures through. */
  logger: PluginLogger;
  /**
   * The plugin's own scoped `StateStore` (`state/<env>.<plugin>.json`), the
   * store `state`/`save()` persist through. A plugin node must never call
   * `store.save()` itself - see {@link PluginContext.record}.
   */
  store: StateStore;
  /**
   * The plugin's **own** state, loaded from its scoped `store`. Typed as
   * core's `OpsState` - not a bare outputs map - because the engine reaches
   * through it: `destroyGraph` does `delete ctx.state.resources[node.id]`
   * (`packages/cli/src/graph.ts:94`). This is the only state a plugin may
   * write, and only through {@link PluginContext.record}; contrast with the
   * read-only {@link PluginContext.siteState}.
   */
  state: OpsState;
  /**
   * The read-only view of the site's own recorded outputs. See
   * {@link SiteState}.
   */
  siteState: SiteState;
  /**
   * Record a resource node's outputs (ARNs, ids, domains) under `nodeId` in
   * the plugin's own `state`. This is the *only* way a plugin's resource
   * nodes may record outputs - it mirrors what the CLI's own nodes do through
   * the private `output(ctx, id)` helper (`packages/cli/src/nodes.ts:20-22`),
   * but a plugin node must never call `store.save()` directly: the engine
   * (`applyGraph`) saves the in-memory state after every node, and a node's
   * own direct write would be clobbered by that next save.
   */
  record(nodeId: string, outputs: ResourceOutputs): void;
  /**
   * Persist the plugin's own working state through `store`. `applyGraph`
   * calls this after every node (`packages/cli/src/graph.ts:84`); a plugin
   * node itself never calls `store.save()` - see {@link PluginContext.record}.
   */
  save(): Promise<void>;
}

/**
 * One command a plugin's namespace answers, generic over the same `TConfig`
 * as the owning {@link Plugin}. `action` is a plain string, not a nested
 * sub-namespace, so a multi-word action such as `secret status`
 * (`packages/cli/src/cli.ts:198`) is one `PluginCommand`, not two levels of
 * dispatch; the host matches the longest declared action first against the
 * remaining positionals. Declared with a method signature (`run(...)`), not
 * an arrow-typed property (`run: (...) => ...`) - that is what makes
 * `PluginCommand<A>[]` and `PluginCommand<B>[]` both assignable to
 * `PluginCommand<unknown>[]` with no cast; see {@link Plugin} for why the
 * host's registry depends on it.
 */
export interface PluginCommand<TConfig = never> {
  /** The action name, e.g. `sync` or `secret status`. */
  action: string;
  /** One line, shown next to the action in help output. */
  summary: string;
  /**
   * Run the command. `args` is whatever positionals/flags remain once
   * `action` - and, by the usual positional/`--env` rule every built-in
   * command already follows, the environment - are consumed.
   */
  run(ctx: PluginContext<TConfig>, args: string[]): Promise<void>;
}

/**
 * A node in the infrastructure dependency graph, generic over `Ctx` - the
 * context its four methods receive. `Ctx` defaults to {@link PluginContext},
 * so a plugin writes plain `ResourceNode` for a node typed against its own
 * narrow context; the CLI instantiates `ResourceNode<OpsContext>`
 * (`packages/cli/src/nodes.ts`) for its own, wider one.
 *
 * The parameter is deliberately **unconstrained** - there is no
 * `Ctx extends PluginContext` here, and there cannot be. The CLI's
 * `OpsContext` (`packages/cli/src/context.ts`) does not satisfy
 * `PluginContext`: it lacks `pluginConfig`, `siteState` and `record` - the
 * same three members task 01's `PluginContext composition` test
 * (`packages/cli/src/context.test.ts`) names off the `TS2739` its own gate
 * rests on. Under a `Ctx extends PluginContext` bound the CLI stops
 * compiling with `TS2344`, because the argument fails the constraint: its
 * fifteen node factories annotate `ResourceNode` bare, so the error surfaces
 * at the one alias they resolve through (`nodes.ts`'s
 * `type ResourceNode = CoreResourceNode<OpsContext>`) and at each remaining
 * explicit instantiation - twelve diagnostics in all, measured, not
 * estimated.
 * Nor is there a supertype of the two contexts worth naming as a bound -
 * `OpsContext` carries CLI-private concerns (`agentDir`, the six-member
 * `Ports`) that `PluginContext` must never see, and `PluginContext` carries
 * `pluginConfig`/`siteState`/`record` that `OpsContext` has no use for.
 * `ResourceNode<OpsContext>` and `ResourceNode<PluginContext>` are therefore
 * two unrelated instantiations of the same generic type, with nothing
 * converting between them.
 *
 * What lets one engine run both - `topoSort`, `applyGraph` and
 * `destroyGraph` (`packages/cli/src/graph.ts`) - is that the engine's own
 * generic constraint is not `PluginContext` either. It is the structural
 * minimum the engine actually reads off a node's context (a logger, a way
 * to persist state, and the state's resources map - `graph.ts`'s exported
 * `GraphContext`), which both `OpsContext` and `PluginContext` satisfy
 * structurally, without either one naming the other or this module.
 */
export interface ResourceNode<Ctx = PluginContext> {
  id: string;
  dependsOn: string[];
  /** Human label for logging. */
  title: string;
  /** Does the resource already exist? (Also hydrates outputs into ctx.state.) */
  read(ctx: Ctx): Promise<boolean>;
  create(ctx: Ctx): Promise<void>;
  /** Reconcile an existing resource (optional). */
  update?(ctx: Ctx): Promise<void>;
  delete(ctx: Ctx): Promise<void>;
}

/**
 * One question a plugin's `init` contributor asks, generalising
 * `packages/cli/src/init.ts:16-40`'s `Question`. An unanswered optional
 * question (`required` unset or `false`) resolves to the empty string,
 * never `undefined` - DEVELOPMENT.md §Error handling bans `undefined`
 * standing in for a domain value.
 */
export interface PluginQuestion {
  /** The prompt text shown to the operator. */
  prompt: string;
  /** Prefilled answer, shown in the prompt and used verbatim when the operator presses enter with no input. */
  defaultValue?: string | undefined;
  /** When true, an empty answer re-prompts instead of being accepted. */
  required?: boolean | undefined;
  /** Return a problem message to re-prompt with, or nothing when the answer is acceptable. */
  validate?: ((answer: string) => string | undefined) | undefined;
}

/**
 * The init contributor's surface: the narrow, terminal-shaped slice an
 * `init?(io)` contributor needs to ask its own questions, without depending
 * on the CLI's `Terminal`/`Logger` types directly. It lives here, in core,
 * because both the config-block splice (`blogwright <plugin> init`) and the
 * first-run wizard (`blogwright init`) reach a plugin's contributor through
 * it and need one shared shape.
 */
export interface PluginInitIo {
  /** True when the session has an interactive TTY, mirroring `Terminal.isInteractive`. */
  readonly isInteractive: boolean;
  /** Leveled logger for the contributor to report through. */
  logger: PluginLogger;
  /** Ask one question and resolve with the answer - the empty string for an unanswered optional question, never `undefined`. */
  ask(question: PluginQuestion): Promise<string>;
}

/**
 * One property/comment pair an `init?(io)` contributor returns, mirroring
 * the entry shape `renderConfig` builds at `packages/cli/src/init.ts:48-65`.
 * `property` is the rendered `"key": value` text; `comment` is an optional
 * trailing `//` note. A contributor the operator declines returns an empty
 * array, never `undefined`.
 */
export interface ConfigBlockEntry {
  property: string;
  comment?: string | undefined;
}

/**
 * Namespace pattern shared by `Plugin.name` and {@link PluginManifest}'s
 * `plugin` field, so the JSON Schema fragment
 * (`.specs/changes/2026-07-26-cli_plugin_system.md` §Type changes) and this
 * runtime check cannot drift apart. Lowercase alphanumerics and dashes.
 */
export const PLUGIN_NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * The `blogwright` field a plugin package declares in its own
 * `package.json` - not in blogwright's own config. Discovery reads this to
 * decide a candidate dependency is a plugin at all; `plugin` is the CLI
 * namespace the package claims, checked against {@link PLUGIN_NAME_PATTERN}
 * the same way `Plugin.name` is.
 */
export interface PluginManifest {
  plugin: string;
}

/**
 * A plugin's default export: the whole SPI surface, generic over `TConfig` -
 * the shape of the config block it owns (see {@link PluginContext.pluginConfig}
 * and its doc comment on why the block is read from there, never from
 * `ctx.config`). A plugin declares exactly these members and nothing else:
 * no lifecycle hooks, no plugin-to-plugin dependencies, no contributed
 * ports or adapters, and no merged config schema beyond the one owned key.
 *
 * The default type argument is `never`, not `unknown`, so a plugin that
 * owns no `configKey` writes bare `Plugin` with no argument. Inside such a
 * plugin every property read off `ctx.pluginConfig` -
 * `ctx.pluginConfig.anything` - is `TS2339: Property 'anything' does not
 * exist on type 'never'` (verified against this repo's tsc 6.0.3): that is
 * the check worth having, because under `unknown` the same plugin would
 * instead have to narrow a value it has no schema for, for no benefit. The
 * one unsoundness `never` leaves - recorded here rather than designed
 * around, because no plugin reads its config this way, and the
 * property-level check above is what a mistaken read actually looks like -
 * is the *whole-field* assignment `const n: number = ctx.pluginConfig`,
 * which compiles, because `never` is assignable to every type. Widening the
 * default to `unknown` would trade that property-level check away for a
 * narrowing no plugin has a schema for, and must not be done to "fix" this.
 *
 * The host's registry is `Plugin<unknown>[]`: a `Plugin<PdsConfig>` and a
 * `Plugin<AnalyticsConfig>` both join it, because `commands[].run` and
 * `nodes` are method-declared (not arrow-typed properties) and therefore
 * bivariant in their parameter types - see the type-level test in
 * `plugin.test.ts`. The host consequently builds a `PluginContext<unknown>`
 * and dispatches every plugin through that one registry with no cast. It
 * never constructs a `PluginContext<never>`: nothing inhabits `never`, so
 * `pluginConfig` would have no value to put there, and reaching one would
 * take the `as` cast DEVELOPMENT.md §Code style bans. For a plugin that
 * owns no `configKey` the host puts an empty object in `pluginConfig`
 * instead of `undefined`, per the no-null rule - and such a plugin cannot
 * read it either way, since it never names a `TConfig` to narrow it with.
 */
export interface Plugin<TConfig = never> {
  /** The CLI namespace this plugin claims (`analytics` answers `blogwright analytics <action>`). Lowercase alphanumerics and dashes - see {@link PLUGIN_NAME_PATTERN}. */
  name: string;
  /** One line, shown in `blogwright --help`. */
  description: string;
  /** The actions this namespace accepts. */
  commands: PluginCommand<TConfig>[];
  /** Resource-graph nodes this plugin contributes, if any. Never invoked by {@link validatePlugin}. */
  nodes?(ctx: PluginContext<TConfig>): ResourceNode[];
  /** The single top-level config key this plugin owns, if any. */
  configKey?: string;
  /**
   * Validate this plugin's raw config block and **return it**, applying the
   * plugin's own defaults, raising in the repo's own error vocabulary when
   * it does not hold. Never invoked by {@link validatePlugin}.
   */
  validateConfig?(raw: unknown): TConfig;
  /**
   * The init contributor: ask questions through `io` and return the config
   * block to write - an empty array when the operator declines. Never
   * invoked by {@link validatePlugin}.
   */
  init?(io: PluginInitIo): Promise<ConfigBlockEntry[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Raise, naming `packageName` and stating what would fix it. Never echoes a value read off the module. */
function rejectPlugin(packageName: string, detail: string): never {
  // No space before `detail`: six of the seven details open with a possessive
  // `'s`, so a joining space renders `plugin package "acme" 's Plugin.name ...`.
  // Details that are not possessive supply their own leading space.
  throw new Error(`plugin package "${packageName}"${detail}`);
}

/**
 * Turn an arbitrary imported module into a trusted {@link Plugin}, or raise
 * naming `packageName` and stating what would fix it. This is the *only*
 * boundary between a package discovery resolved off disk and the rest of
 * the host: validation never invokes anything the module supplies - not
 * `nodes`, not `init`, not `validateConfig`, not any command's `run` - only
 * property reads and `typeof`/`Array.isArray` narrowing, so a malformed or
 * hostile module cannot run code merely by being validated. No raised
 * message echoes a value read off the module; only `packageName`, supplied
 * by the caller, appears in the text.
 */
export function validatePlugin(module: unknown, packageName: string): Plugin {
  if (!isRecord(module)) {
    rejectPlugin(
      packageName,
      ' has no default export - export a Plugin object as the package default export',
    );
  }
  const candidate = module.default;
  if (candidate === undefined) {
    rejectPlugin(
      packageName,
      ' has no default export - export a Plugin object as the package default export',
    );
  }
  if (!isRecord(candidate)) {
    rejectPlugin(
      packageName,
      "'s default export is not a Plugin object - export an object with name, description and commands",
    );
  }

  const name = candidate.name;
  if (typeof name !== 'string' || name.length === 0) {
    rejectPlugin(
      packageName,
      '\'s Plugin.name is required - the CLI namespace it claims, e.g. "analytics"',
    );
  }
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    rejectPlugin(
      packageName,
      `'s Plugin.name must be lowercase alphanumerics and dashes, matching ${PLUGIN_NAME_PATTERN}`,
    );
  }

  const description = candidate.description;
  if (typeof description !== 'string' || description.length === 0) {
    rejectPlugin(
      packageName,
      "'s Plugin.description is required - a one-line summary shown in `blogwright --help`",
    );
  }

  const commands = candidate.commands;
  if (!Array.isArray(commands)) {
    rejectPlugin(packageName, "'s Plugin.commands must be an array of { action, summary, run }");
  }
  for (const command of commands) {
    const valid =
      isRecord(command) &&
      typeof command.action === 'string' &&
      command.action.length > 0 &&
      typeof command.summary === 'string' &&
      command.summary.length > 0 &&
      typeof command.run === 'function';
    if (!valid) {
      // `summary` is checked because this function's return is asserted to
      // `Plugin`, whose PluginCommand declares `summary: string` as required.
      // Without the check a command omitting it validates and reads back
      // `undefined` while typed `string` - and tasks 11 and 17 render exactly
      // that field into `blogwright --help` and `blogwright plugin list`.
      rejectPlugin(
        packageName,
        "'s Plugin.commands has an entry missing action, summary or run - each command needs a non-empty action, a non-empty summary and a run(ctx, args) function",
      );
    }
  }

  return candidate as unknown as Plugin;
}
