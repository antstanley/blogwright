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
 * left out because no pds command function reads them, and leaving them out
 * keeps `createTestContext` (`packages/pds/src/test-support.ts`) small: the
 * host hands every command and the `afterDeploy` hook a full `PluginContext`,
 * which satisfies this `Pick` by plain assignment. The plugin's one resource
 * node (`nodes.ts`) takes the full `PluginContext<PdsConfig>` instead, because
 * it reads `siteState`, `names`, `accountId` and `record()`.
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
