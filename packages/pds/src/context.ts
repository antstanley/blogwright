/**
 * The narrow slice of the host CLI's context this feature package depends on,
 * expressed as a narrowing of core's `PluginContext`. The CLI's `OpsContext`
 * satisfies it structurally, so the dispatch boundary is a plain assignment -
 * this package never imports CLI types.
 */

import type {
  PdsConfig,
  PluginContext,
  PluginLogger,
  PluginPorts,
  SecretsManagerClient,
} from 'blogwright-core';

/** Leveled logger surface the pds commands report through - core's `PluginLogger`. */
export type PdsLogger = PluginLogger;

/** The ports the pds feature crosses: repo files and the operator's terminal - core's `PluginPorts`. */
export type PdsPorts = PluginPorts;

/**
 * Everything a pds command needs from its host - config, secrets, ports,
 * logging. A `Pick` over core's `PluginContext<PdsConfig>` of exactly the
 * members pds uses today - `env`, `domain`, `config`, `ports` (already
 * exactly the `fs`/`terminal` pair `PluginPorts` names), `logger` and
 * optional `tags` - plus `clients`, narrowed here to the one client pds
 * calls rather than picked verbatim: `PluginContext.clients` is the full
 * `AwsClients`, and `test-support.ts` builds a context supplying only
 * `secrets`.
 *
 * Everything else on `PluginContext` is left out on purpose. `preview`,
 * `names` and `accountId` are host surface pds has never needed.
 * `pluginConfig`, `state`, `store`, `siteState`, `record()` and `save()` are
 * all built at a dispatch boundary that no pds command function runs behind:
 * `deploy` calls `syncAfterDeploy(ctx)` with a plain `OpsContext`
 * (`packages/cli/src/commands.ts`), which has none of them, so picking any
 * of the six would break that call. The plugin's one resource node
 * (`nodes.ts`) takes a full `PluginContext<PdsConfig>` instead, because only
 * the lifecycle verbs have a dispatch boundary to build one.
 *
 * `Pick`, never `Omit`: an `Omit` of those six dispatch-boundary members
 * from `PluginContext`'s sixteen would drag `preview`, `names` and
 * `accountId` back in, and `createTestContext`
 * (`packages/pds/src/test-support.ts`) would have to fabricate a whole
 * `Names` to keep compiling.
 */
export interface PdsContext extends Pick<
  PluginContext<PdsConfig>,
  'env' | 'domain' | 'config' | 'ports' | 'logger' | 'tags'
> {
  clients: { secrets: SecretsManagerClient };
}
