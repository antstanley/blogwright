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

// CLAIM C23 [migrate_pds_to_plugin_system §`blogwright-core` → Config] expects
// clean - today's ground truth this claim retires WHEN TASK 27 LANDS: core's
// `PdsConfig.secretName` is still a required `string`. When task 27 widens it,
// this fails; delete the claim and re-run - the corpus statements that say
// "today" have become history at that commit.
declare const corePdsConfig: PdsConfig;
const secretNameTotalToday: string = corePdsConfig.secretName;
void secretNameTotalToday;

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

// CLAIM C28 [cli_plugin_system §Plugin-supplied AWS services / task 38] expects
// TS2339 - ground truth today: `AwsClients` does not carry `signingUsEast1`
// yet ("the us-east-1 signer … is a local const reachable only through the
// pre-built clients"). Retires when task 38 lands; delete the claim and
// re-run.
// @ts-expect-error TS2339
void ops.clients.signingUsEast1;

// ---------------------------------------------------------------------------
// Scoped state (task 04) - the store type is shared, only the key changes
// ---------------------------------------------------------------------------

// CLAIM C29 [cli_plugin_system §Scoped state stores / task 04] expects clean -
// the plugin's scoped store is the same `StateStore` type as the site's, so
// `PluginContext.store` types against core's class with no wrapper.
const storeOnContext: PluginContext<unknown>['store'] = scopedStore;
void storeOnContext;
