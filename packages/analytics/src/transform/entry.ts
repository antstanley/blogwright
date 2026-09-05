/**
 * The transform bundle's entry point, and the only composition root the
 * analytics plugin has on the Lambda side.
 *
 * `handler.ts` exports `createTransformHandler(secrets, env)` - a factory, not
 * a bound handler - and constructs nothing: its port on Secrets Manager is a
 * **type-only** import of core, so it erases at compile and the module carries
 * no client, no signer and no transport. That is what keeps the envelope
 * testable against a plain object instead of a cloud. The consequence is that
 * something has to build the real client and call the factory, and that
 * something is this file: DEVELOPMENT.md §Hexagonal architecture puts adapter
 * construction at the composition root and nowhere else, and for a Lambda the
 * composition root is the module the runtime loads.
 *
 * ## The export shape is load-bearing
 *
 * Lambda resolves its configured `Handler` string as
 * `<file base name>.<exported binding>` inside the deployment package, so this
 * module must export a **function** named `handler` - the binding
 * `TRANSFORM_LAMBDA_HANDLER` (`../transform-hash.ts`) names, which task 50 sets
 * on the function. Bundling the factory instead would build cleanly, deploy
 * cleanly, and fail at *invoke* time with an AWS-side error: every record would
 * go to the Firehose error prefix, nothing in this repo would report it, and
 * the only symptom would be an empty dashboard. `entry.test.ts` pins the export
 * against that constant for exactly that reason.
 *
 * ## Why us-east-1, and why the whole credential chain
 *
 * The salt secret is created in us-east-1 by `analytics-salt-secret` (task 50),
 * because CloudFront standard logging accepts a Firehose delivery stream only
 * there and the whole pipeline is pinned to that region - the same quirk core's
 * `logsUsEast1` documents. The execution role grants `GetSecretValue` on an ARN
 * that embeds the region, so signing anywhere else would be denied.
 *
 * The credentials come from core's ambient provider chain rather than a
 * hand-read of `AWS_ACCESS_KEY_ID`: the chain reads the environment first, which
 * is where the Lambda runtime puts the execution role's credentials, and it is
 * the one credential path this repo has already reviewed. No endpoint override
 * is read here; a deployed function that honoured `AWS_ENDPOINT_URL` would
 * silently redirect the secret read, and this module runs only in AWS.
 */

import { createCredentialProvider, SecretsManagerClient, SigningClient } from 'blogwright-core';

import { createTransformDiagnostics } from '../adapters/transform-diagnostics.js';
import { createTransformHandler } from './handler.js';

/** Where the salt secret lives, and therefore where this function signs. */
const SALT_SECRET_REGION = 'us-east-1';

const signing = new SigningClient({
  region: SALT_SECRET_REGION,
  credentials: createCredentialProvider({}),
});

/**
 * The bound Lambda handler. Built at module load, so a function deployed
 * without the salt secret's name in the environment fails at initialisation
 * with the message `handler.ts` writes, rather than once per batch.
 */
export const handler = createTransformHandler(
  new SecretsManagerClient(signing),
  process.env,
  createTransformDiagnostics((line) => console.info(line)),
);
