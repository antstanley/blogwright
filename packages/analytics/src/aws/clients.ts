/**
 * The plugin's own AWS client bundle. Assembled here rather than in core's
 * `createClients` (`packages/core/src/clients.ts`): core enumerates no
 * `s3tables`, `firehose`, `glue` or `lambda` key, adding them there would put
 * analytics topography in core and construct four clients on every `deploy`,
 * and `pnpm knip` would report four exports nothing in core or the CLI
 * consumes. Core exposes one signer; the plugin builds its own services over
 * it.
 *
 * Not re-exported from `../index.js`, for the same reason `config.ts` is not:
 * the package's published surface is what the CLI loads through the SPI, and
 * this factory is reached only by this package's own nodes, which import it
 * from here. Adding it to the barrel would put an export on the public surface
 * that nothing outside the package consumes.
 */

import { S3Client, SecretsManagerClient, type PluginContext } from 'blogwright-core';

import { FirehoseClient } from './firehose.js';
import { GlueClient } from './glue.js';
import { LambdaClient } from './lambda.js';
import { S3TablesClient } from './s3tables.js';

/**
 * The slice of a plugin context {@link createAnalyticsClients} reads, taken as
 * a `Pick` of core's own `PluginContext` rather than a restatement of it, so it
 * cannot drift from the SPI. Any `PluginContext<T>` satisfies it, so a node
 * passes `ctx` straight through. Not exported: a caller passes its context and
 * never names this type.
 */
type AnalyticsClientContext = Pick<PluginContext<unknown>, 'clients'>;

/** Every AWS client an analytics node reaches for, all signing in us-east-1. */
export interface AnalyticsClients {
  s3tables: S3TablesClient;
  firehose: FirehoseClient;
  glue: GlueClient;
  lambda: LambdaClient;
  /**
   * The client `analytics-error-bucket` creates its bucket with - core's
   * `S3Client`, built here over the pinned signer, never the host bundle's own
   * copy, which signs in `config.region`.
   */
  s3: S3Client;
  /**
   * The client `analytics-salt-secret` creates its secret with - core's
   * `SecretsManagerClient`, built here over the pinned signer, never the host
   * bundle's own copy, which signs in `config.region`.
   */
  secrets: SecretsManagerClient;
}

/**
 * Build the plugin's clients over the host's us-east-1 signer.
 *
 * Every one of them is pinned to us-east-1 regardless of `config.region`:
 * CloudFront standard logging accepts a Firehose delivery stream only there, so
 * the whole pipeline - stream, transform function, table bucket, catalog
 * federation, error bucket and salt secret - is created in that region, the
 * same global-service quirk core's `logsUsEast1` documents
 * (`packages/core/src/clients.ts`).
 *
 * That is why `s3` and `secrets` are constructed here rather than lifted off
 * the host bundle: the host's own pair is built over the primary-region signer,
 * so reusing either would put the error bucket and the salt secret in
 * `config.region` - the salt out of reach of the us-east-1 transform Lambda
 * that reads it, in the one region no other analytics node is in.
 *
 * The signer is the host's, never a hand-built one: `SigningClient`'s
 * `credentials` and `transport` are private and its region is fixed at
 * construction, so a fresh one would re-resolve credentials, drop the CLI's
 * `--endpoint` override and ignore the transport a test injected.
 */
export function createAnalyticsClients(ctx: AnalyticsClientContext): AnalyticsClients {
  const signing = ctx.clients.signingUsEast1;
  return {
    s3tables: new S3TablesClient(signing),
    firehose: new FirehoseClient(signing),
    glue: new GlueClient(signing),
    lambda: new LambdaClient(signing),
    s3: new S3Client(signing),
    secrets: new SecretsManagerClient(signing),
  };
}
