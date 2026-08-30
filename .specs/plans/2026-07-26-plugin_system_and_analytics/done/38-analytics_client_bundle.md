# Task 38 - Build the plugin's four clients over the shared signer, pinned to us-east-1

**Plan:** [plan.md](../plan.md) · **Certificate:** [38-analytics_client_bundle-certificate.md](38-analytics_client_bundle-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics plugin → Its own service clients (Add)](../../../changes/2026-07-26-analytics_plugin.md) and §Analytics pipeline → Region pinning (Add) (the plugin builds its four clients over the `SigningClient` on its context, pinned to us-east-1 because CloudFront standard logging accepts a Firehose stream only there) and [2026-07-26-cli_plugin_system.md §Plugin SPI → Plugin-supplied AWS services (Add)](../../../changes/2026-07-26-cli_plugin_system.md) ("`AwsClients` gains `signingUsEast1` alongside `signing`" - owned by the plugin-system spec, which is why task 58 and not task 20 flips that spec's `Status:`; this task is its first consumer)
**Depends on:** 33, 34, 35, 36
**Produces:** `packages/analytics/src/aws/clients.ts` exposing `createAnalyticsClients(ctx)` - the plugin's four new clients (`s3tables`, `firehose`, `glue`, `lambda`) plus core's existing `S3Client` and `SecretsManagerClient`, all six built over `ctx.clients.signingUsEast1` and signing against `us-east-1` whatever `config.region` says, with core's `AwsClients` gaining that one signer and no service key
**Pointers:** `packages/analytics/src/aws/clients.ts` (new - the plugin's bundle), `packages/analytics/src/aws/clients.test.ts` (new), `packages/core/src/clients.ts:21-39` (`AwsClients` - gains `signingUsEast1` and nothing else), `packages/core/src/clients.ts:28-32` (the `logsUsEast1` doc comment whose shape the plugin's comments copy), `packages/core/src/clients.ts:52,54` (the `signing` and `usEast1` clients - `:54` is the local const this task exposes as `signingUsEast1`), `packages/core/src/aws/signer.ts:83,89` (a `SigningClient`'s region is fixed at construction) and `:85-86` (`credentials` and `transport` are private, which is why exposing the host's existing us-east-1 signer is the only route to one that shares them), `packages/core/src/aws/signer.test.ts:6-16` (the `capture()` recording transport to reuse), `packages/cli/src/test-support.ts:32,35,69-88` (`ServiceName`, `ClientOverrides` and the explicit `testClients` enumeration, which widens by `signingUsEast1` alone), `packages/cli/src/context.ts:127` (the CLI composition root's `createClients` call), `packages/pds/src/test-support.ts:50` (the pds package's `createClients` call)

> **ROUTED FINDING - added 2026-08-30 from task 34's implementation.**
> `stripAwsFraming` and `rethrowWithContext` are duplicated between
> `s3tables.ts` and `firehose.ts`, and tasks 35 and 36 make that a third and
> fourth copy. Task 34 declined to extract them because doing so means editing
> task 33's landed file, which no contract instructed - the right call, and it
> lands the decision here instead.
> This task assembles the four clients, so it is the natural home. Extract a
> shared `packages/analytics/src/aws/errors.ts` and re-point all four, OR record
> why four copies are preferable. If you extract, note that the two helpers are
> NOT interchangeable across the four services: task 33's local
> `isAlreadyExists` needs a `statusCode === 409` limb because S3 Tables returns
> its code only in `x-amzn-ErrorType`, while every Firehose exception is HTTP
> 400 so `code` is the only usable signal there. Extract the framing helpers;
> do NOT collapse the four already-exists predicates into one, and do not
> assume a shared helper can key on status.
> **This task also closes a gap all four clients share** (named honestly by task
> 35, 2026-08-30): no client's own tests can catch a wrong `signingName`.
> Mutating it changes only the SigV4 signature, which a transport stub does not
> verify - so `signingName: 'gluex'` passes every test in `glue.test.ts`. This
> task's authorization-header assertions ARE that check: the credential scope is
> `<date>/<region>/<service>/aws4_request`, where `<service>` is the signing
> name, so `/us-east-1/glue/` pins it. Treat those four assertions as
> load-bearing rather than as a region test with a service name incidentally
> attached, and make sure a wrong signing name is what one of them reddens on.
>
> Task 34 also found an edge worth preserving: `DeleteDeliveryStream` returns
> `ResourceInUseException` meaning "still CREATING, cannot delete yet", so that
> predicate is create-path-only. A shared module must not tempt a later reader
> into reusing it on a delete path.

## Steps

- [x] Add `signingUsEast1: SigningClient` to `AwsClients` and `createClients` (`packages/core/src/clients.ts:21,42`) - the delta the plugin-system change spec owns and this task lands, since it is its first consumer. The us-east-1 signer already exists as a local `const` at `:54` but is reachable only through the pre-built `acm`/`cloudfront`/`route53`/`logsUsEast1` clients. A `SigningClient`'s region is fixed at construction (`packages/core/src/aws/signer.ts:83,89`), and every analytics service is us-east-1. The plugin could technically construct its own - `SigningClient` and `createCredentialProvider` are public core exports - but not one that shares the host's: `credentials` and `transport` are `private readonly` (`packages/core/src/aws/signer.ts:85-86`), so a hand-built signer re-resolves credentials, drops the CLI's `--endpoint` override and ignores the transport a test injected. Exposing the one the host already built is what keeps the plugin inside transport-level substitution. This is a core change, but a generic one: it exposes a signer, not a plugin's service.
- [x] Build the clients in `packages/analytics/src/aws/clients.ts`, NOT in core's `createClients`. Core's `AwsClients` gains nothing: adding four plugin-only services there would put analytics topography in core, construct them for every `deploy`, and leave `pnpm knip` reporting four exported clients nothing in core or the CLI consumes. Each client is constructed with the service descriptor task 31's transport seam accepts.
- [x] Assert core is untouched: a test (or the task's review step) confirms `packages/core/src/clients.ts` has no `s3tables`/`firehose`/`glue`/`lambda` key and `SIGNING_NAMES` is unchanged.
- [x] Give `createAnalyticsClients(ctx)` one doc comment stating the reason for the pin once: CloudFront standard logging accepts a Firehose stream only in `us-east-1`, so the whole analytics pipeline - stream, transform function, table bucket and catalog federation - is created there regardless of `config.region`. Match the shape of core's `logsUsEast1` comment at `packages/core/src/clients.ts:28-32`.
- [x] Add the two clients the plugin reuses from core to the same bundle, constructed over `ctx.clients.signingUsEast1` and exposed beside the four: `S3Client` for `analytics-error-bucket` and `SecretsManagerClient` for `analytics-salt-secret` (task 50). Neither is a new client - four is the count of *new* clients, not of clients in the bundle - but neither may be taken from `ctx.clients`: `ctx.clients.s3` and `ctx.clients.secrets` are built over the primary-region signer (`packages/core/src/clients.ts:59,68`), so reusing them would create those two resources in `config.region`, outside the region pin every other analytics node obeys and away from the us-east-1 Lambda that reads the secret.
- [x] Write `packages/analytics/src/aws/clients.test.ts` reusing the `capture()` recording transport from `packages/core/src/aws/signer.test.ts:6-16`: build a `PluginContext` whose `config.region` is `eu-west-1` with a static credential provider, issue one call per client, and assert the SigV4 credential scope in each `authorization` header - `/us-east-1/s3tables/`, `/us-east-1/firehose/`, `/us-east-1/glue/`, `/us-east-1/lambda/`, `/us-east-1/s3/` and `/us-east-1/secretsmanager/`.
- [x] Add the core-side negative half in `packages/core/src/clients.test.ts`: adding `signingUsEast1` moves nothing - `logs`, `s3`, `microvms` and `secrets` still scope to `/eu-west-1/`, with `microvms` asserted explicitly because it shares the `lambda` signing name and is the client most likely to be moved by mistake, and `signingUsEast1` itself scopes to `/us-east-1/`.
- [x] Widen the explicit client enumeration in `testClients` at `packages/cli/src/test-support.ts:69-88` with `signingUsEast1` so `ClientOverrides` (`:35`), which derives from `keyof AwsClients` at `:32`, can substitute it - without this it spreads from `...base` and the override is silently ignored. The node tasks that follow substitute the *plugin's* bundle, not core's clients.
- [x] Confirm the four clients are exported from `packages/analytics/src/index.ts` (added by tasks 33–36), that `grep -rn "s3tables\|firehose\|glue" packages/core/src --include='*.ts' --exclude='*.test.ts'` returns nothing - test files are excluded because task 31's descriptor cases in `packages/core/src/aws/endpoint.test.ts` name all four services as its regression coverage - and run `pnpm knip` from the repo root to check no export or dependency is left unused.
- [x] Record the changeset decision: either add a `.changeset/*.md` marking a minor on `blogwright-core` covering `signingUsEast1`, task 31's transport seam and task 37's `LogsClient` delivery-configuration parameters, or state in the change description that it is deferred to task 58 - and say which in the certificate's residue.

## Definition of done

- [x] Core's `AwsClients` gains exactly one member - `signingUsEast1`, the signer already constructed at `packages/core/src/clients.ts:54` - and no service key: `grep -rn "s3tables\|firehose\|glue" packages/core/src --include='*.ts' --exclude='*.test.ts'` returns nothing, and the `createClients` return object is otherwise byte-identical.
- [x] `createAnalyticsClients(ctx)` builds all six clients over `ctx.clients.signingUsEast1` - the four new ones with the descriptors task 31's seam accepts, plus core's `S3Client` and `SecretsManagerClient` - carrying one doc comment that states the region pin once in the shape of core's `logsUsEast1` comment. Neither `ctx.clients.s3` nor `ctx.clients.secrets` is reused: `grep -n "ctx.clients.s3\b\|ctx.clients.secrets" packages/analytics/src/` returns nothing.
- [x] A plugin-side test constructs the bundle from a context whose `config.region` is not `us-east-1` and asserts, through a recording transport, that all six sign against `us-east-1` - the secrets client explicitly, because reusing the primary-region one is the easy mistake and would leave the salt secret in the wrong region from the transform Lambda that reads it; a core-side test asserts `logs`, `s3`, `microvms` and `secrets` still sign against the configured region, `microvms` explicitly, because it shares the `lambda` signing name.
- [x] `pnpm knip` reports no unused export and no unused dependency.
- [x] A changeset records the minor on `blogwright-core` for `signingUsEast1` plus the `LogsClient` parameters, or the change description states in writing that it is deferred to task 58.
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: run `pnpm --filter blogwright-analytics exec vitest run clients --reporter=verbose` in both `packages/analytics` and `packages/core`, then `pnpm knip`; confirm the plugin's recorded `authorization` headers show `us-east-1` for all six clients and core's show `eu-west-1` for `logs`/`s3`/`microvms`/`secrets`, and that `pnpm --filter blogwright exec vitest run nodes --reporter=verbose` still passes with no change to its client fakes (CORRECTED 2026-08-30 - this line said `--filter blogwright-core`, which has no `nodes` test file at all and exits 1 with "No test files found"; the nodes suite lives in the CLI package. Third filter defect of mine in this plan, all three the same mistake of naming the package a task cites rather than the one its tests live in).
