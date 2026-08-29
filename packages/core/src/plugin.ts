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
 * operator's terminal. Deliberately narrower than the CLI's four-member
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
 * `OpsContext` carries CLI-private concerns (`agentDir`, the four-member
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
