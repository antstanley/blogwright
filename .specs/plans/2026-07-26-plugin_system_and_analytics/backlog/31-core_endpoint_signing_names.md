# Task 31 — Add s3tables, firehose, glue and lambda to the AWS endpoint resolver

**Plan:** [plan.md](../plan.md) · **Certificate:** [31-core_endpoint_signing_names-certificate.md](31-core_endpoint_signing_names-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §`blogwright-core` → New service clients (Add)](../../../changes/2026-07-26-analytics_plugin.md) (the four service keys that join `SIGNING_NAMES`, and the spec's claim that `canonicalHost`'s default branch already produces the correct host for all four)
**Depends on:** —
**Produces:** `resolveEndpoint` accepts `s3tables`, `firehose`, `glue` and `lambda`, each resolving to its canonical regional host under its own signing name, with `microvms` provably unchanged
**Pointers:** `packages/core/src/aws/endpoint.ts:19` (the `SIGNING_NAMES` map the four keys join), `packages/core/src/aws/endpoint.ts:27-29` (the `microvms: 'lambda'` entry and its comment, which a new `lambda` key must not disturb), `packages/core/src/aws/endpoint.ts:33` (`ServiceKey`, derived from the map), `packages/core/src/aws/endpoint.ts:36` (`GLOBAL_SERVICES`, which the four keys stay out of), `packages/core/src/aws/endpoint.ts:63,75` (`canonicalHost` and its `default` branch, `` `${service}.${region}.amazonaws.com` ``), `packages/core/src/aws/endpoint.test.ts:6,16,24` (the three existing describes the new assertions join), `packages/core/src/aws/signer.ts:96,124` (`resolveEndpoint` and `SIGNING_NAMES[opts.service]` — the map's only consumers)

## Steps

- [ ] Add `s3tables: 's3tables'`, `firehose: 'firehose'`, `glue: 'glue'` and `lambda: 'lambda'` to `SIGNING_NAMES` at `packages/core/src/aws/endpoint.ts:19`, leaving every existing entry — including the `microvms: 'lambda'` line at `:29` and the two-line comment above it — byte-identical, so `ServiceKey` at `:33` widens without any existing key changing.
- [ ] Leave `canonicalHost` (`packages/core/src/aws/endpoint.ts:63`) and `GLOBAL_SERVICES` (`:36`) unedited: the `default` branch at `:75` already yields `<service>.<region>.amazonaws.com` for all four keys, and none of the four is a global service, so both omissions are deliberate and should be stated in the change description rather than in a code comment.
- [ ] Extend the `uses canonical hosts without an override` test at `packages/core/src/aws/endpoint.test.ts:6` with `s3tables`, `firehose`, `glue` and `lambda` against `us-east-1`, keeping the existing `microvms` assertion at `:11` in place as the regression anchor and adding an assertion that `SIGNING_NAMES.microvms` is still `'lambda'`.
- [ ] Add a negative-space test asserting the four new keys sign in the region passed rather than being forced to `us-east-1` (the behaviour the `GLOBAL_SERVICES` test at `:16` pins for `iam`/`cloudfront`), and extend the override test at `:24` so each of the four routes to `http://localhost:4566` with `override: true`.

## Definition of done

- [ ] `SIGNING_NAMES` gains `s3tables`, `firehose`, `glue` and `lambda`, each mapping to its own signing name; every existing entry, including `microvms: 'lambda'`, is byte-identical.
- [ ] `canonicalHost` is unchanged: tests assert `resolveEndpoint` returns `s3tables.us-east-1.amazonaws.com`, `firehose.us-east-1.amazonaws.com`, `glue.us-east-1.amazonaws.com` and `lambda.us-east-1.amazonaws.com` for the four new keys.
- [ ] A regression test asserts `microvms` still resolves to `lambda.<region>.amazonaws.com` and signs as `lambda`, so the new `lambda` key does not disturb the MicroVM path.
- [ ] Negative-space tests assert the four keys are not global services (they sign in the region passed, not forced to `us-east-1`) and that an endpoint override still routes them to the override origin with `override: true`.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- endpoint` and `jj diff packages/core/src/aws/endpoint.ts`; confirm the tests cover all four new keys plus `microvms`, and the diff adds only four lines inside `SIGNING_NAMES`.
