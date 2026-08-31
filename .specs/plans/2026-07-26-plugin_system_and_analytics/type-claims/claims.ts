/**
 * Compiled type-level claims: every compiler fact the three change specs and
 * their task files assert, checked against the repo's real types.
 *
 * Format: each claim is one `// CLAIM Cnn [document §section / task] expects
 * <TSxxxx | clean>` comment followed by the code that proves it. Claims that
 * must FAIL to compile sit under `@ts-expect-error`, so a claim that silently
 * stops erroring fails the gate too (TS2578). Claims that must compile are
 * plain code. `check.mjs` runs tsc and, on failure, names the claim nearest
 * each error.
 */

import type { OpsContext } from '../../../../packages/cli/src/context.js';
import type { PdsContext } from '../../../../packages/pds/src/context.js';
import type {
  OpsConfig,
  OpsState,
  PdsConfig,
  ResourceOutputs,
  SendOptions,
  ServiceKey,
  StateStore,
} from 'blogwright-core';
import type {
  AnalyticsConfig,
  EngineContext,
  Plugin,
  PluginContext,
  ProposedPdsConfig,
  ProposedPdsContext,
  ResolvedAnalyticsConfig,
  ResolvedPdsConfig,
  ResourceNode,
  ServiceDescriptor,
  SiteState,
} from './transcriptions.js';
import { applyGraphProposed } from './transcriptions.js';

/** `[A] extends [B] ∧ [B] extends [A]` - pins an enumeration exactly. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

declare const ops: OpsContext;
declare const opsState: OpsState;
declare const scopedStore: StateStore;
declare const pluginCtx: PluginContext;
declare const unknownCtx: PluginContext<unknown>;

// ---------------------------------------------------------------------------
// The Plugin contract - the `never` default
// ---------------------------------------------------------------------------

// CLAIM C01 [cli_plugin_system §The `Plugin` contract] expects TS2339 -
// under the `never` default every property read off `pluginConfig` errors:
// "Property 'anything' does not exist on type 'never'".
// @ts-expect-error TS2339
void pluginCtx.pluginConfig.anything;

// CLAIM C02 [cli_plugin_system §The `Plugin` contract] expects clean -
// the recorded unsoundness: the whole-field assignment compiles, because
// `never` is assignable to everything.
const wholeFieldAssignment: number = pluginCtx.pluginConfig;
void wholeFieldAssignment;

// CLAIM C03 [cli_plugin_system §The `Plugin` contract] expects clean -
// "the host's registry is `Plugin<unknown>[]`; a `Plugin<PdsConfig>` and a
// `Plugin<AnalyticsConfig>` both join it because `commands[].run` and `nodes`
// are method-declared and therefore bivariant."
declare const pdsPlugin: Plugin<ResolvedPdsConfig>;
declare const analyticsPlugin: Plugin<AnalyticsConfig>;
const registry: Plugin<unknown>[] = [pdsPlugin, analyticsPlugin];
void registry;

// CLAIM C04 [cli_plugin_system §The `Plugin` contract] expects TS2322 -
// "It is never a `PluginContext<never>`: nothing inhabits `never`", so the
// host's empty-object `pluginConfig` cannot type against it …
declare const emptyBlock: Record<string, never>;
// @ts-expect-error TS2322
const neverConfig: PluginContext<never>['pluginConfig'] = emptyBlock;
void neverConfig;

// CLAIM C05 [cli_plugin_system §The `Plugin` contract / task 19] expects clean -
// … while the `PluginContext<unknown>` the host actually builds takes it.
const unknownConfig: PluginContext<unknown>['pluginConfig'] = emptyBlock;
void unknownConfig;

// ---------------------------------------------------------------------------
// Typed plugin config - why `pluginConfig` exists
// ---------------------------------------------------------------------------

// CLAIM C06 [cli_plugin_system §Typed plugin config] expects TS2339 -
// "`OpsConfig` has no index signature, so `ctx.config.analytics` does not
// compile … TS2339: Property 'analytics' does not exist on type 'OpsConfig'."
// @ts-expect-error TS2339
void pluginCtx.config.analytics;

// CLAIM C07 [cli_plugin_system §Typed plugin config] expects TS7053 -
// "`config[plugin.configKey]` is TS7053: No index signature with a parameter
// of type 'string' was found on type 'OpsConfig'."
declare const config: OpsConfig;
declare const configKey: string;
// @ts-expect-error TS7053
void config[configKey];

// ---------------------------------------------------------------------------
// OpsContext vs PluginContext - the dispatch boundary
// ---------------------------------------------------------------------------

// CLAIM C08 [cli_plugin_system §Assumptions / task 01] expects TS2739 -
// "the assignment is TS2739 naming exactly those three": `pluginConfig`,
// `siteState` and `record` have no counterpart on `OpsContext`.
// @ts-expect-error TS2739
const bareAssignment: PluginContext<unknown> = ops;
void bareAssignment;

// CLAIM C09 [migrate_pds_to_plugin_system §Config ownership] expects TS2345 -
// argument position: "passing an `OpsContext` to a parameter typed with
// `pluginConfig` is TS2345".
declare function takesPluginContext(ctx: PluginContext<unknown>): void;
// @ts-expect-error TS2345
takesPluginContext(ops);

// CLAIM C10 [migrate_pds_to_plugin_system §Config ownership] expects TS2345 -
// the single-member elaboration: "Property 'pluginConfig' is missing in type
// 'OpsContext' but required in type …".
declare function readsPluginConfig(ctx: { pluginConfig: ResolvedPdsConfig }): void;
// @ts-expect-error TS2345
readsPluginConfig(ops);

// CLAIM C11 [task 01 DoD / cli_plugin_system §The two state surfaces] expects
// clean - the dispatch boundary's composition: an `OpsContext` spread plus
// exactly `pluginConfig`, `siteState` and `record`, no cast, no field written
// twice. Thirteen of the sixteen members come from the `OpsContext`; if
// `PluginContext` gains a member neither supplies, this claim breaks first.
const composed: PluginContext<unknown> = {
  ...ops,
  pluginConfig: {},
  siteState: { resources: ops.state.resources },
  record: (nodeId: string, outputs: ResourceOutputs): void => {
    void nodeId;
    void outputs;
  },
};
void composed;

// CLAIM C12 [cli_plugin_system §`PluginContext` / task 01 DoD] expects clean -
// the enumeration is exhaustive: exactly these sixteen members and nothing
// else. Adding or removing a member in the transcription (or the spec) breaks
// this claim before any consumer notices.
const sixteenMembers: Exact<
  keyof PluginContext<unknown>,
  | 'env'
  | 'domain'
  | 'preview'
  | 'config'
  | 'pluginConfig'
  | 'names'
  | 'accountId'
  | 'clients'
  | 'ports'
  | 'tags'
  | 'logger'
  | 'store'
  | 'state'
  | 'siteState'
  | 'record'
  | 'save'
> = true;
void sixteenMembers;

// ---------------------------------------------------------------------------
// The two state surfaces
// ---------------------------------------------------------------------------

// CLAIM C13 [task 01 DoD / verification record] expects TS2542 -
// "`siteState` is readonly in the type, so `ctx.siteState.resources['x'] = {}`
// does not typecheck".
// @ts-expect-error TS2542
pluginCtx.siteState.resources['x'] = {};

// CLAIM C14 [task 01 step / cli_plugin_system §The two state surfaces] expects
// TS18048 - a plugin state typed as the bare outputs map breaks the engine:
// against `state: Record<string, ResourceOutputs>`, the engine's
// `delete ctx.state.resources[id]` is "TS18048: 'ctx.state.resources' is
// possibly 'undefined'" (noUncheckedIndexedAccess).
declare const bareMapContext: { state: Record<string, ResourceOutputs> };
// @ts-expect-error TS18048
delete bareMapContext.state.resources['node-id'];

// CLAIM C15 [task 01 step] expects clean - "`OpsState` satisfies [`SiteState`]
// because a mutable property is assignable to a `readonly` one, so the CLI
// needs no wrapper object."
const siteStateFromOps: SiteState = opsState;
void siteStateFromOps;

// ---------------------------------------------------------------------------
// ResourceNode and the engine - the relocation (task 02)
// ---------------------------------------------------------------------------

// CLAIM C16 [cli_plugin_system §Vocabulary relocation / task 02] expects clean -
// the CLI's instantiation `ResourceNode<OpsContext>` compiles under the
// unconstrained declaration; the CLI keeps
// `type ResourceNode = CoreResourceNode<OpsContext>`.
type CliResourceNode = ResourceNode<OpsContext>;
declare const cliNodes: CliResourceNode[];

// CLAIM C17 [task 02 doc-comment mandate / cert 02 O3] expects TS2344 -
// the constraint task 02 must NOT declare: under
// `Ctx extends PluginContext`, `ResourceNode<OpsContext>` fails, because
// `OpsContext` lacks `pluginConfig`, `siteState` and `record`. If this stops
// erroring, `OpsContext` has started satisfying `PluginContext` and task 02's
// rationale (and task 01's TS2739 gate) need rewriting.
interface ResourceNodeConstrained<Ctx extends PluginContext = PluginContext> {
  read(ctx: Ctx): Promise<boolean>;
}
// @ts-expect-error TS2344
type CliNodeUnderConstraint = ResourceNodeConstrained<OpsContext>;
export type { CliNodeUnderConstraint };

// CLAIM C18 [cli_plugin_system §Vocabulary relocation / task 02] expects clean -
// both real contexts satisfy the engine's structural minimum
// (`logger`, `save()`, `state.resources`).
const engineFromOps: EngineContext = ops;
const engineFromPlugin: EngineContext = pluginCtx;
void engineFromOps;
void engineFromPlugin;

// CLAIM C19 [task 02 fixture / task 16 step] expects clean - the generic
// engine accepts both instantiations with no cast: the CLI's nodes with an
// `OpsContext`, and a plugin's default-typed nodes with the composed
// `PluginContext` the dispatch boundary builds.
declare const pluginNodes: ResourceNode[];
void applyGraphProposed(cliNodes, ops);
void applyGraphProposed(pluginNodes, composed);

// ---------------------------------------------------------------------------
// PdsContext - today's boundary and the proposed narrowing (task 24)
// ---------------------------------------------------------------------------

// CLAIM C20 [migrate_pds_to_plugin_system §Motivation / DEVELOPMENT.md
// §Hexagonal architecture] expects clean - today's ground truth: the CLI's
// `OpsContext` satisfies the real `PdsContext` by plain assignment.
const pdsFromOps: PdsContext = ops;
void pdsFromOps;

// CLAIM C21 [migrate_pds_to_plugin_system §Context / task 24] expects clean -
// the proposed `Pick`-based narrowing preserves that structural satisfaction:
// `OpsContext` still satisfies it by plain assignment, so `createTestContext`
// and the dispatch boundary keep working.
const proposedPdsFromOps: ProposedPdsContext = ops;
void proposedPdsFromOps;

// CLAIM C22 [migrate_pds_to_plugin_system §Context] expects clean - the
// narrowing "leaves out nine of its sixteen members": `preview`, `names`,
// `accountId`, `pluginConfig`, `state`, `store`, `siteState`, `record`,
// `save` - three host fields pds never needed plus the six the dispatch
// boundary builds.
const nineLeftOut: Exact<
  Exclude<keyof PluginContext<ProposedPdsConfig>, keyof ProposedPdsContext>,
  | 'preview'
  | 'names'
  | 'accountId'
  | 'pluginConfig'
  | 'state'
  | 'store'
  | 'siteState'
  | 'record'
  | 'save'
> = true;
void nineLeftOut;

// ---------------------------------------------------------------------------
// PdsConfig - the widening and the resolved shape (tasks 21, 22, 27)
// ---------------------------------------------------------------------------

// RETIRED CLAIM C23 - 2026-08-31 at plan close, its landing task being TASK 27.
// It pinned today's ground truth - core's `PdsConfig.secretName` was a required
// `string` - and instructed its own deletion the moment task 27 widened it.
// Task 27 landed and the claim broke, exactly as designed; this is the
// deliberate deletion it asked for, not a silent edit. C25 below still pins the
// widened-and-resolved shape, so the guarantee did not leave with it.

// CLAIM C24 [migrate_pds_to_plugin_system §Config ownership] expects TS2322 -
// the widening the migration must not leak: under the proposed shape every
// unresolved read is `string | undefined`.
declare const proposedPdsConfig: ProposedPdsConfig;
// @ts-expect-error TS2322
const widenedRead: string = proposedPdsConfig.secretName;
void widenedRead;

// CLAIM C25 [migrate_pds_to_plugin_system §Config ownership / §Type changes]
// expects clean - `ResolvedPdsConfig` keeps every call site total:
// `secretName` narrows to `string`, and the resolved block is still a valid
// proposed block.
declare const resolvedPdsConfig: ResolvedPdsConfig;
const secretNameTotalResolved: string = resolvedPdsConfig.secretName;
const resolvedIsProposed: ProposedPdsConfig = resolvedPdsConfig;
void secretNameTotalResolved;
void resolvedIsProposed;

// ---------------------------------------------------------------------------
// The transport seam (tasks 31, 38)
// ---------------------------------------------------------------------------

// CLAIM C26 [cli_plugin_system §Plugin-supplied AWS services] expects TS2322 -
// rewritten 2026-08-30, when task 31 landed. It used to read "ground truth
// today: `SendOptions.service` is the closed `ServiceKey` union", and used to
// instruct that the claim be DELETED once the seam opened. Both were wrong to
// keep. The seam widened `SendOptions['service']` to
// `ServiceKey | ServiceDescriptor`, and a bare service-name string is
// assignable to neither arm - so this claim did not retire, it changed
// meaning. It now pins the shape of the widening: the seam takes a
// DESCRIPTOR, never a plain string, so core keeps a closed set of names it
// will sign under while a plugin supplies its own signing name and global
// flag explicitly. Deleting it would have dropped that guarantee and the
// plan's stated claim count with it.
const knownService: SendOptions['service'] = 's3';
void knownService;
// @ts-expect-error TS2322
const pluginService: SendOptions['service'] = 's3tables';
void pluginService;

// CLAIM C27 [cli_plugin_system §Plugin-supplied AWS services] expects clean -
// the proposed union accepts a descriptor carrying its own `global` flag
// alongside core's own keys.
const descriptorAccepted: ServiceKey | ServiceDescriptor = {
  service: 's3tables',
  signingName: 's3tables',
  global: false,
};
const keyStillAccepted: ServiceKey | ServiceDescriptor = 'microvms';
void descriptorAccepted;
void keyStillAccepted;

// RETIRED CLAIM C28 - 2026-08-31 at plan close, its landing task being TASK 38.
// It pinned that `AwsClients` did not yet carry `signingUsEast1` and instructed
// its own deletion once task 38 added it. Task 38 landed; the directive went
// unused and the gate reported it broken. This is that deletion. Unlike C26 -
// which task 31 rewrote rather than retired, because the seam changed its
// meaning instead of ending it - this claim had nothing left to say: the member
// now exists and `pnpm typecheck` covers it as ordinary shipped code.
// ---------------------------------------------------------------------------
// Scoped state (task 04) - the store type is shared, only the key changes
// ---------------------------------------------------------------------------

// CLAIM C29 [cli_plugin_system §Scoped state stores / task 04] expects clean -
// the plugin's scoped store is the same `StateStore` type as the site's, so
// `PluginContext.store` types against core's class with no wrapper.
const storeOnContext: PluginContext<unknown>['store'] = scopedStore;
void storeOnContext;

// ---------------------------------------------------------------------------
// The analytics config block (task 44) - the sealed environment-carrying names
// ---------------------------------------------------------------------------

declare const analyticsCtx: PluginContext<AnalyticsConfig>;

// CLAIM C30 [analytics_plugin §Configuration → The `analytics` block / task 44]
// expects TS2339 - `validateConfig(raw)` receives no `env` and no `siteName`
// (task 19's `resolvePluginConfig`), so `tableBucket` and `saltSecretName`
// cannot be defaulted on the validated block and are not readable off it.
// That is what stops a node writing
// ``ctx.pluginConfig.tableBucket ?? `${ctx.config.siteName}-analytics` `` - a
// line that would compile if the field were merely optional, and would make
// `analytics destroy --yes` in staging delete production's table bucket.
// @ts-expect-error TS2339
void analyticsCtx.pluginConfig.tableBucket;
// @ts-expect-error TS2339
void analyticsCtx.pluginConfig.saltSecretName;

// CLAIM C31 [analytics_plugin §Configuration → The `analytics` block / task 44]
// expects clean - the four settings whose defaults are literals ARE total on
// `pluginConfig` (the spec's "applies the plugin's own defaults", carried as
// far as a validator with no environment can carry it), and the total
// six-field shape the spec describes is what `resolveAnalyticsConfig` returns.
const totalOnPluginConfig: { namespace: string; table: string; port: number } = {
  namespace: analyticsCtx.pluginConfig.namespace,
  table: analyticsCtx.pluginConfig.table,
  port: analyticsCtx.pluginConfig.dashboard.port,
};
void totalOnPluginConfig;
declare const resolvedAnalytics: ResolvedAnalyticsConfig;
const totalAfterResolve: {
  tableBucket: string;
  saltSecretName: string;
  bots: 'flag' | 'filter';
} = resolvedAnalytics;
void totalAfterResolve;
