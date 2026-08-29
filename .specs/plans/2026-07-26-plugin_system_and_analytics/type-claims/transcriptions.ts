/**
 * TRANSCRIPTIONS of the proposed plugin-SPI types - none of these exist in
 * `packages/` yet. Each declaration cites the spec section it is copied from;
 * when a spec changes a proposed type, this file changes with it and
 * `node check.mjs` re-derives which task files now assert a stale truth.
 *
 * Real, existing types (`OpsContext`, `OpsConfig`, `OpsState`, `AwsClients`,
 * `PdsContext`, `StateStore`, `ResourceOutputs`, `ServiceKey`, `SendOptions`,
 * `Names`, `FileSystem`, `Terminal`, `SecretsManagerClient`) are imported
 * from `packages/` - they are ground truth, never transcribed. The tsconfig
 * maps `blogwright-core` onto `packages/core/src`, so nominal types such as
 * `StateStore` resolve to one declaration on every path.
 */

import type {
  AwsClients,
  FileSystem,
  Names,
  OpsConfig,
  OpsState,
  ResourceOutputs,
  SecretsManagerClient,
  StateStore,
  Terminal,
} from 'blogwright-core';

/**
 * 2026-07-26-cli_plugin_system.md §Plugin SPI → `PluginContext` (via task 01,
 * which restates the CLI `Logger` shape in core as `PluginLogger`).
 */
export interface PluginLogger {
  info(msg: string): void;
  step(msg: string): void;
  ok(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/**
 * 2026-07-26-cli_plugin_system.md §Plugin SPI → `PluginContext`: "`ports` is a
 * core-declared `PluginPorts` of `fs` and `terminal` - the two ports core owns."
 */
export interface PluginPorts {
  fs: FileSystem;
  terminal: Terminal;
}

/**
 * 2026-07-26-cli_plugin_system.md §Plugin SPI → The two state surfaces:
 * "`siteState` is the same shape [as `OpsState`] with `resources` readonly."
 * Task 01 spells the declaration:
 * `{ readonly resources: Readonly<Record<string, ResourceOutputs>> }`.
 */
export interface SiteState {
  // Readonly at BOTH levels. The shallow form this transcribed until 2026-08-29 let a
  // plugin write `siteState.resources[id]['arn']`, and since the dispatch boundary hands
  // the site's own `state.resources` through by reference, that write reaches the site's
  // in-memory state and is persisted by the site's own save() - falsifying task 01's
  // definition-of-done claim that a plugin can never write state/<env>.json. Claim C13
  // exercises only the outer index signature, so the gate passed while this was wrong.
  readonly resources: Readonly<Record<string, Readonly<ResourceOutputs>>>;
}

/**
 * 2026-07-26-cli_plugin_system.md §Plugin SPI → `PluginContext`: "It names
 * exactly `env`, `domain`, `preview`, `config`, `pluginConfig`, `names`,
 * `accountId`, `clients`, `ports`, `tags`, `logger`, `store`, `state`,
 * `siteState`, `record(nodeId, outputs)` and `save()` - and nothing else.
 * Every member is required except `tags`." Sixteen members; `state` is core's
 * own `OpsState` (§The two state surfaces - the engine does
 * `delete ctx.state.resources[node.id]`). The default type argument is `never`,
 * matching the diagnostics the corpus quotes (`PluginContext<never>`).
 */
export interface PluginContext<TConfig = never> {
  env: string;
  domain: string | undefined;
  preview: boolean;
  config: OpsConfig;
  pluginConfig: TConfig;
  names: Names;
  accountId: string;
  clients: AwsClients;
  ports: PluginPorts;
  tags?: Record<string, string> | undefined;
  logger: PluginLogger;
  store: StateStore;
  state: OpsState;
  siteState: SiteState;
  record(nodeId: string, outputs: ResourceOutputs): void;
  save(): Promise<void>;
}

/**
 * 2026-07-26-cli_plugin_system.md §Plugin SPI → The `Plugin` contract:
 * "Each carries an `action` name, a `summary` for help output, and
 * `run(ctx, args)`." Method-declared, which is what makes the host registry
 * bivariant.
 */
export interface PluginCommand<TConfig = never> {
  action: string;
  summary: string;
  run(ctx: PluginContext<TConfig>, args: string[]): Promise<void>;
}

/**
 * 2026-07-26-cli_plugin_system.md §Resource graph → Vocabulary relocation
 * (and task 02): "It moves as `ResourceNode<Ctx>`, generic over the context
 * its methods receive." The parameter is deliberately UNCONSTRAINED - see
 * claims C13/C14: `OpsContext` does not satisfy `PluginContext`, so an
 * `extends PluginContext` bound would make every CLI instantiation `TS2344`.
 */
export interface ResourceNode<Ctx = PluginContext> {
  id: string;
  dependsOn: string[];
  title: string;
  read(ctx: Ctx): Promise<boolean>;
  create(ctx: Ctx): Promise<void>;
  update?(ctx: Ctx): Promise<void>;
  delete(ctx: Ctx): Promise<void>;
}

/**
 * 2026-07-26-cli_plugin_system.md §Resource graph → Vocabulary relocation:
 * "the engine taking a structural constraint covering what it actually uses -
 * `logger`, `save()`, and `state.resources`" (task 02 lands it in graph.ts).
 */
export interface EngineContext {
  logger: PluginLogger;
  state: { resources: Record<string, ResourceOutputs> };
  save(): Promise<void>;
}

/**
 * 2026-07-26-cli_plugin_system.md §Resource graph → Vocabulary relocation
 * (task 02 step 4): the engine's proposed generic signature. Transcribed as a
 * declaration so claims can exercise both real instantiations.
 */
export declare function applyGraphProposed<Ctx extends EngineContext>(
  nodes: ResourceNode<Ctx>[],
  ctx: Ctx,
): Promise<void>;

/**
 * 2026-07-26-cli_plugin_system.md §Plugin SPI → The `Plugin` contract: name,
 * description, commands, `nodes?(ctx)`, `configKey?`,
 * `validateConfig?(raw: unknown): TConfig`, `init?(io)` - "a plugin declares
 * nothing else". `init`'s io/return shapes are task 13/47 detail the claims
 * here do not pin, so they stay `unknown`.
 */
export interface Plugin<TConfig = never> {
  name: string;
  description: string;
  commands: PluginCommand<TConfig>[];
  nodes?(ctx: PluginContext<TConfig>): ResourceNode[];
  configKey?: string;
  validateConfig?(raw: unknown): TConfig;
  init?(io: unknown): unknown;
}

/**
 * 2026-07-26-cli_plugin_system.md §Plugin SPI → Plugin-supplied AWS services
 * (implementation note 1): "`SendOptions.service` accepts a
 * `{ service, signingName, global? }` descriptor as well as a `ServiceKey`."
 */
export interface ServiceDescriptor {
  service: string;
  signingName: string;
  global?: boolean;
}

/**
 * 2026-07-26-migrate_pds_to_plugin_system.md §Type changes: `PdsConfig` with
 * `secretName` optional, "because the plugin now applies the default". This is
 * the PROPOSED shape; core's current `PdsConfig` (imported in claims.ts) still
 * has it required until task 27.
 */
export interface ProposedPdsConfig {
  name: string;
  description?: string | undefined;
  handleResolver?: string | undefined;
  secretName?: string | undefined;
}

/**
 * 2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-pds` → Config
 * ownership: "a `ResolvedPdsConfig` - core's `PdsConfig` with `secretName`
 * narrowed to `string`" - what `requirePdsConfig` returns and what
 * `validateConfig` puts on `pluginConfig`.
 */
export type ResolvedPdsConfig = ProposedPdsConfig & { secretName: string };

/**
 * 2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-pds` → Context (and
 * task 24): `PdsContext` restated as "a `Pick` of exactly the members
 * `PdsContext` has today: `env`, `domain`, `config`, `clients` (narrowed to
 * `{ secrets }`), `ports` (narrowed to `fs` and `terminal`), `logger`, and
 * optional `tags`" over `PluginContext<PdsConfig>`.
 */
export type ProposedPdsContext = Pick<
  PluginContext<ProposedPdsConfig>,
  'env' | 'domain' | 'config' | 'logger' | 'tags'
> & {
  clients: { secrets: SecretsManagerClient };
  ports: { fs: FileSystem; terminal: Terminal };
};

/**
 * 2026-07-26-analytics_plugin.md §Configuration → The `analytics` block and
 * §Type changes: the RESOLVED shape (`validateConfig` "applies the plugin's
 * own defaults", so every field is total on `pluginConfig`).
 */
export interface AnalyticsConfig {
  tableBucket: string;
  namespace: string;
  table: string;
  bots: 'flag' | 'filter';
  saltSecretName: string;
  dashboard: { port: number };
}
