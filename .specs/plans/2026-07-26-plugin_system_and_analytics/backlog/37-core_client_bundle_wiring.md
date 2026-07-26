# Task 37 — Wire the four new clients into AwsClients, pinned to us-east-1

**Plan:** [plan.md](../plan.md) · **Certificate:** [37-core_client_bundle_wiring-certificate.md](37-core_client_bundle_wiring-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §`blogwright-core` → New service clients (Add)](../../../changes/2026-07-26-analytics_plugin.md) and §Analytics pipeline → Region pinning (Add) (the four clients joining `AwsClients`/`createClients`, constructed against the existing `usEast1` signer because CloudFront standard logging accepts a Firehose stream only there)
**Depends on:** 32, 33, 34, 35
**Produces:** `AwsClients` carries `s3tables`, `firehose`, `glue` and `lambda`, every one signing against `us-east-1` whatever `config.region` says, with a recording-transport test proving the split against the site's own clients
**Pointers:** `packages/core/src/clients.ts:21-39` (the `AwsClients` interface the four keys join), `packages/core/src/clients.ts:28-32` (the `logsUsEast1` doc comment whose shape the four new comments copy), `packages/core/src/clients.ts:42-70` (`createClients`), `packages/core/src/clients.ts:52,54` (the primary `signing` client and the `usEast1` client the four are constructed against), `packages/core/src/clients.ts:67` (`microvms` on the primary signer — must not move), `packages/core/src/clients.test.ts` (new — the bundle has no test file today), `packages/core/src/aws/signer.test.ts:6-16` (the `capture()` recording transport to reuse), `packages/cli/src/test-support.ts:32,35,69-88` (`ServiceName`, `ClientOverrides` and the explicit `testClients` enumeration that must widen so later node tasks can substitute the four), `packages/cli/src/context.ts:127` (the CLI composition root's `createClients` call), `packages/pds/src/test-support.ts:50` (the pds package's `createClients` call)

## Steps

- [ ] Add `s3tables`, `firehose`, `glue` and `lambda` to the `AwsClients` interface at `packages/core/src/clients.ts:21`, each carrying a doc comment in the shape of the `logsUsEast1` comment at `:28-32` that states the reason for the pin once: CloudFront standard logging accepts a Firehose stream only in `us-east-1`, so the whole analytics pipeline — stream, transform function, table bucket and catalog federation — is created there regardless of `config.region`.
- [ ] Construct all four in `createClients` at `packages/core/src/clients.ts:56-69` against the existing `usEast1` `SigningClient` at `:54`, leaving `microvms` at `:67` and every other entry on the primary `signing` client at `:52` untouched.
- [ ] Write `packages/core/src/clients.test.ts` reusing the `capture()` recording transport from `packages/core/src/aws/signer.test.ts:6-16`: build the bundle with `region: 'eu-west-1'` and a static credential provider, issue one call per client, and assert the SigV4 credential scope in each `authorization` header — `/us-east-1/s3tables/`, `/us-east-1/firehose/`, `/us-east-1/glue/` and `/us-east-1/lambda/` for the four new clients.
- [ ] Add the negative half of the same test: `logs`, `s3`, `microvms` and `secrets` still scope to `/eu-west-1/`, with `microvms` asserted explicitly because it shares the `lambda` signing name and is the client most likely to be moved by mistake.
- [ ] Widen the explicit client enumeration in `testClients` at `packages/cli/src/test-support.ts:69-88` with the four new keys so `ClientOverrides` (`:35`), which derives from `keyof AwsClients` at `:32`, can actually substitute them for the node tasks that follow — without this the four spread from `...base` and every override is silently ignored.
- [ ] Confirm the four clients are exported from `packages/core/src/index.ts` (added by tasks 32–35) and run `pnpm knip` from the repo root to check no export or dependency is left unused.
- [ ] Record the changeset decision: either add a `.changeset/*.md` marking a minor on `blogwright-core` covering the four clients and task 36's `LogsClient` delivery-configuration parameters, or state in the change description that it is deferred to task 57 — and say which in the certificate's residue.

## Definition of done

- [ ] `AwsClients` gains `s3tables`, `firehose`, `glue` and `lambda`, constructed in `createClients` against the existing `usEast1` signer, each with a doc comment stating why it is region-pinned — the same shape as the existing `logsUsEast1` comment.
- [ ] A test constructs the bundle with a non-`us-east-1` region and asserts, through a recording transport, that all four sign against `us-east-1` while `logs`, `s3`, `microvms` and `secrets` still sign against the configured region; no existing client's signer changes, and `microvms` is asserted explicitly.
- [ ] `pnpm knip` reports no unused export and no unused dependency.
- [ ] A changeset records the minor on `blogwright-core` for the four clients plus the `LogsClient` parameters, or the change description states in writing that it is deferred to task 57.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- clients` and `pnpm knip`; confirm the recorded `authorization` headers show `us-east-1` for the four new clients and `eu-west-1` for `logs`/`s3`/`microvms`/`secrets`, and that `pnpm test -- nodes` still passes with no change to its client fakes.
