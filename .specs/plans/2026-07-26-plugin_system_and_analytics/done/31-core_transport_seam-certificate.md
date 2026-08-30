# Done Certificate - Task 31: Open the transport so a plugin can supply its own AWS services

**Task:** [31-core_transport_seam.md](31-core_transport_seam.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 31. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 31) ≡ every obligation O1…O8 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `resolveEndpoint` and `SendOptions.service` accept a plugin-supplied service descriptor as well as a core `ServiceKey`, so a plugin signs against any AWS service without an edit to core - with `SIGNING_NAMES` unchanged and every existing core request byte-identical.
- **P2 - Obligations.** The task is done iff O1…O8 all hold. One Oi per definition-of-done item, in DoD order; O8 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the MicroVM control-plane path (`packages/core/src/aws/microvms.ts` through `SigningClient.send` at `packages/core/src/aws/signer.ts:96`), the global-service signing rule for `iam`/`cloudfront`/`route53` (`packages/core/src/aws/endpoint.ts:36`), the `AwsError` contract (`packages/core/src/aws/signer.ts:171-193` - `service` is a name, never an object), or the floci endpoint-override route used by `packages/core/src/aws/s3.floci.test.ts`.

## Obligations

- **O1 - `SIGNING_NAMES` stays closed while the seam opens.**
  - *Claim:* `SIGNING_NAMES` at `packages/core/src/aws/endpoint.ts:19-33` is byte-identical to today - it gains NO keys - and `resolveEndpoint`/`SendOptions.service` additionally accept a `{ service, signingName, global? }` descriptor.
  - *Evidence collected:* the `SIGNING_NAMES` literal was extracted from the parent revision (`jj file show -r @-`) and from the working copy by `awk '/^export const SIGNING_NAMES/,/^} as const;/'`; both hash to `67be3fadbb2236205c2b75783fe18374` and `diff` is empty - byte-identical, the two-line `microvms` comment included. `export type ServiceKey = keyof typeof SIGNING_NAMES;` is still line 33 in both. `jj diff --git packages/core/src/aws/endpoint.ts` removes exactly four lines, all of them signatures/bodies of `resolveEndpoint`/`canonicalHost`; nothing inside the literal. `grep -rn "s3tables\|firehose\|glue" packages/core/src --include='*.ts' --exclude='*.test.ts'` exits 1 with no output. The unscoped grep hits only `endpoint.test.ts` and `signer.test.ts`, which is O2's required coverage. `SendOptions.service` is `ServiceKey | ServiceDescriptor` (`signer.ts:32`); `resolveEndpoint`'s first parameter is the same union (`endpoint.ts:75`).
  - *Status:* ☑ SATISFIED

- **O2 - `canonicalHost`'s branches are unchanged and a descriptor resolves through its default branch.**
  - *Claim:* `canonicalHost` has no new `case` and no changed output; its parameter widens from `ServiceKey` to `string` because `resolveEndpoint` now passes a resolved name. The four analytics descriptors resolve to `s3tables.`/`firehose.`/`glue.`/`lambda.us-east-1.amazonaws.com`.
  - *Evidence collected:* `canonicalHost`'s body was extracted from the parent and the working copy below the signature line and `diff`ed - byte-identical. The `switch` still lists exactly `iam`, `cloudfront`, `route53`, `s3`, `microvms` before `default`, and the sole edit on the signature line is `service: ServiceKey` → `service: string`. `pnpm --filter blogwright-core exec vitest run endpoint --reporter=verbose` shows `resolveEndpoint > uses canonical hosts without an override` passing with one assertion per host (`endpoint.test.ts:20-33`). Note the resolution is by *name*, so the `microvms` case is reached by `resolveService('microvms').name === 'microvms'`, not by the signing name - the case is still live.
  - *Status:* ☑ SATISFIED

- **O3 - `microvms` still resolves and signs as before.**
  - *Claim:* `resolveEndpoint('microvms', region, undefined).host` is `lambda.<region>.amazonaws.com` and `SIGNING_NAMES.microvms` is `'lambda'`, unaffected by the plugin's `lambda` descriptor.
  - *Evidence collected:* the pre-existing assertion at `endpoint.test.ts:11-13` survived verbatim; `SIGNING_NAMES.microvms === 'lambda'` is newly pinned at `:16`; a dedicated test `is undisturbed for microvms: host, signing name and signing region` (`:82-95`) asserts host, `signingRegion` and `override: false` plus `resolveService('microvms')` deep-equalling `{ name: 'microvms', signingName: 'lambda', global: false }`. Both pass.
  - *Checks:* `signer.ts:130` reads `resolved.signingName`; for `opts.service === 'microvms'` `resolveService` returns `SIGNING_NAMES['microvms'] === 'lambda'`. `MicrovmsClient.call` (`microvms.ts:130-131`) still passes `service: 'microvms'`, and `PATHS.image` (`microvms.ts:17`) still builds `${API}/microvm-images/...` with `API = '/2025-09-09'`. An independent end-to-end signing harness confirmed `https://lambda.eu-west-1.amazonaws.com/2025-09-09/microvm-images/img-1` with `Credential=…/eu-west-1/lambda/aws4_request` and `host: lambda.eu-west-1.amazonaws.com`.
  - *Status:* ☑ SATISFIED

- **O4 - Negative space: a descriptor is not global unless it says so, and override still wins.**
  - *Claim:* a descriptor with no `global` flag resolves `signingRegion` to the region passed, a descriptor with `global: true` resolves it to `us-east-1`, and any descriptor under `'http://localhost:4566'` returns `{ protocol: 'http:', host: 'localhost:4566', override: true }`.
  - *Evidence collected:* all three tests exist and pass - `signs a descriptor without global in the region passed, not us-east-1` (`endpoint.test.ts:54-67`, covering both the absent flag and an explicit `global: false`), the `global: true` case inside `signs global services in us-east-1` (`:45-52`), and `routes a descriptor to an override origin too` (`:73-80`). `GLOBAL_SERVICES` (`endpoint.ts:53`) is textually identical to the parent - still `new Set<ServiceKey>(['iam', 'cloudfront', 'route53'])`, still typed over core's keys alone; the descriptor path never touches it, reading `service.global ?? false` instead (`endpoint.ts:70`).
  - *Status:* ☑ SATISFIED

- **O5 - All four `service` sites read one resolution helper, each taking the right field.**
  - *Claim:* one exported helper turns `ServiceKey | ServiceDescriptor` into `{ name, signingName, global }`, and `SIGNING_NAMES[opts.service]` takes the signing name while `uriEscapePath` and `parseError` take the service name; a descriptor whose service is `s3` gets `uriEscapePath: false` and every other descriptor gets `true`.
  - *Evidence collected:* `resolveService` (`endpoint.ts:59-72`) is the single exported helper. The four sites: `signer.ts:130` `service: resolved.signingName`; `signer.ts:141` `uriEscapePath: resolved.name !== 's3'`; `signer.ts:169` `parseError(resolved.name, response)`; and the region/global site inside `resolveEndpoint` (`endpoint.ts:79-80`) reading `resolved.global`. `SIGNING_NAMES` is no longer imported by `signer.ts` at all, so the signing-name lookup cannot be re-derived. `grep -n "opts\.service" packages/core/src/aws/signer.ts` returns only `:101` (`resolveService(opts.service)`) and `:102` (`resolveEndpoint(opts.service, …)`), and `resolveEndpoint` itself resolves through the same helper - no site keys off the raw union.
  - *Checks (mutation-tested, not inherited):* reverting `:141` to `uriEscapePath: opts.service !== 's3'` **still typechecks** (`tsc -p tsconfig.typecheck.json` exit 0 - `ServiceKey` overlaps `'s3'`, so no TS2367) and is caught by `signer.test.ts:153`, `signs a descriptor named "s3" without path escaping, and every other descriptor with it`, which reports two different SigV4 signatures for the same path. The trap is live. Both directions are asserted: the `s3` descriptor's `Authorization` must equal the `s3` `ServiceKey`'s, and a `glue` descriptor's must differ.
  - *Status:* ☑ SATISFIED

- **O6 - A plugin-service failure raises an `AwsError` naming the service, not `[object Object]`.**
  - *Claim:* `parseError` is called with the resolved service *name*, its parameter is still `string`, and the `AwsError` it constructs carries that name for a descriptor-built request.
  - *Evidence collected:* the correct fix was taken. `signer.ts:169` passes `resolved.name`; `parseError`'s signature at `:177` is still `function parseError(service: string, response: RawResponse): AwsError`; `:199` still constructs `new AwsError({ service, code, message, statusCode, requestId })` unchanged, and `AwsError.service` (`errors.ts:6`) is still `string`. `signer.test.ts:162-183` drives a 400 through a descriptor-built request and asserts `service: 's3tables'`, `code`, `statusCode` and the full message `s3tables: ValidationException - bad table name (HTTP 400)`.
  - *Checks (mutation-tested, not inherited):* the shortcut was reproduced - `parseError(opts.service, …)` with the parameter widened to `ServiceKey | ServiceDescriptor` and `String(service)` at the `AwsError` construction (needed because `AwsError.service` is `string`, so the naive widening only moves TS2345 from `:163` to `:193`). It typechecks clean (exit 0) and yields exactly the predicted symptom: `service: "[object Object]"` and the message losing the name. `signer.test.ts:177` catches it. The trap is live.
  - *Status:* ☑ SATISFIED

- **O7 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* from the worktree root, all six CI gates in `.github/workflows/ci.yml:21-29` order exit 0 - `pnpm build`, `pnpm typecheck`, `pnpm test` (core 132 passed / 1 skipped, cli 234, pds 96, build-agent 27), `pnpm lint` (0 errors; the `no-shadow` warnings in `packages/cli/src/nodes.test.ts` are pre-existing and untouched by this diff), `pnpm exec oxfmt --check .` (139 files), `pnpm knip`. The one skipped test is `s3.floci.test.ts`, gated on `FLOCI=1` - pre-existing, not caused by this change; its override route is covered instead by `endpoint.test.ts:68-80` and by 18 override-mode byte-identity cases below. `node .specs/plans/.../type-claims/check.mjs` re-run in the worktree: `PASS: 29 claims held`. Changeset `.changeset/core-transport-service-descriptor.md` is present, declares `minor` for `blogwright`, `blogwright-core` and `blogwright-pds` - the exact `fixed` group in `.changeset/config.json`, matching the sibling `generic-plugin-dispatch.md` - and describes the widening as additive with core's clients signing byte-identically. `minor` is the right semver call: widening an input parameter type and adding exports is backward-compatible for every caller.
  - *Status:* ☑ SATISFIED

- **O8 - Run the `Reviewable:` line; confirm the descriptor tests cover the regional, global and override paths plus `microvms`, and that the diff touches `SIGNING_NAMES` not at all.**
  - *Claim:* a reviewer can run those two commands and observe a green endpoint suite and a diff whose `SIGNING_NAMES` literal is unchanged.
  - *Evidence collected:* `pnpm --filter blogwright-core exec vitest run endpoint --reporter=verbose` - 8 passed / 8: `uses canonical hosts without an override` (regional, incl. the four descriptors), `signs global services in us-east-1` (global, incl. a `global: true` descriptor), `signs a descriptor without global in the region passed, not us-east-1`, `routes everything to an override origin`, `routes a descriptor to an override origin too`, `is undisturbed for microvms: host, signing name and signing region`, and two `resolveService` tests. `jj diff packages/core/src/aws/endpoint.ts` - 41 insertions, 4 deletions; all four deletions are outside the `SIGNING_NAMES` literal (`service: ServiceKey,`, the `GLOBAL_SERVICES.has(service)` line, the `canonicalHost(service, region)` call, and `canonicalHost`'s signature). Insertions inside the literal: zero.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/core/src/aws/signer.ts:130` resolves the signing name for `opts.service = 'microvms'` → `'lambda'` : ☑ PRESERVED (`resolveService('microvms').signingName === SIGNING_NAMES.microvms === 'lambda'`; the live request carries `/eu-west-1/lambda/aws4_request`)
- `packages/core/src/aws/signer.ts:141` computes `uriEscapePath` for `opts.service = 's3'` → `false`, and for every other core key → `true` : ☑ PRESERVED (`resolveService(key).name === key` for every `ServiceKey`, so the comparison is value-identical to the old `opts.service !== 's3'` on the key path)
- `packages/core/src/aws/signer.ts:169` raises for a 5xx from a core `ServiceKey` request → the `AwsError`'s `service` is that key's own string : ☑ PRESERVED (`resolved.name === opts.service` for a key; an independent harness confirmed `service: 'microvms'` and a message beginning `microvms:`, not `lambda:`)
- `packages/cli/src/nodes.ts:285` calls `ctx.clients.microvms.getImage(arn)` → signed request to `lambda.<region>.amazonaws.com/2025-09-09/microvm-images/<id>` : ☑ PRESERVED (traced through `microvms.ts:179 → :181 → PATHS.image → call() → send({ service: 'microvms' })`; harness produced that exact URL and `Authorization`)
- `packages/core/src/aws/signer.ts:102` calls `resolveEndpoint('iam', 'eu-west-1', undefined)` → `signingRegion: 'us-east-1'`, `host: 'iam.amazonaws.com'` : ☑ PRESERVED (`endpoint.test.ts:37-40`; harness produced `https://iam.amazonaws.com/` with `/us-east-1/iam/aws4_request` from an `eu-west-1` client)

**Independent byte-identity proof (beyond the shipped tests).** A throwaway harness was run in the worktree and removed afterwards: for all nine `ServiceKey`s × three regions (`us-east-1`, `eu-west-1`, `ap-south-1`) × two endpoint modes (canonical and `http://localhost:4566`) = 54 cases, a `ServiceKey` request and the request built from its equivalent descriptor `{ service: name, signingName, global }` were compared under `vi.setSystemTime` on the full transport payload - URL, method, body and every header including `authorization`, `host`, `x-amz-date` and `x-amz-content-sha256` - with `toStrictEqual`. All 54 identical, with awkward paths (`/my-bucket/a%20b/c+d~e.txt`, `/Some Path/with+plus~tilde/x`), query params needing escaping, a session token, and a request body. Plus four named cases (microvms end-to-end, the `iam` global rule, and both mutation traps): 58 passed. The nine keys are exactly the nine services every core client sends with (`acm`, `route53`, `iam`, `logs`, `sts`, `secretsmanager`, `s3`, `cloudfront`, `microvms` - grepped across `packages/*/src`), so no core client's wire format moved.

## Residue

Notes carried forward for the plan, none of them blocking this task:

1. **The type-claim corpus is now the stale side, not the code.** `type-claims/claims.ts:305-313` (CLAIM C26) still reads "ground truth today: `SendOptions.service` is the closed `ServiceKey` union", and instructs "Retires when task 31 opens the seam; delete the claim and re-run." Task 31 opened the seam, so that prose is now false. The claim's *assertion* nevertheless still holds and the gate passes: `SendOptions['service']` is `ServiceKey | ServiceDescriptor`, and the bare string `'s3tables'` is assignable to neither arm, so the `@ts-expect-error TS2322` is still consumed (the run reports 17 pinned compile-errors, and an unused directive would fail with TS2578). The corpus is wrong only in its comment - and arguably its retirement instruction is wrong too, because C26 has become a *useful* negative-space pin that the seam widened to a descriptor and not to plain `string`. Recommended fix, owned by task 00 and not by this task's diff: rewrite C26's comment to state that invariant, rather than deleting it and dropping the plan's stated count of 29 claims. Separately, C27 types `descriptorAccepted` against `transcriptions.ts:165`'s proposed `ServiceDescriptor`, not the one core now exports through `packages/core/src/index.ts:8` - so no claim yet compiles against the *shipped* descriptor. Worth switching that import when C26 is revised.
2. **Coverage gap (not a defect).** Feeding `parseError` `resolved.signingName` instead of `resolved.name` was mutation-tested and is **silent** under the whole shipped core suite (132 passed). It would relabel every MicroVM `AwsError` as `lambda` instead of `microvms` - `microvms` is the only core key where name ≠ signingName, and no shipped test asserts `AwsError.service` for it (`signer.test.ts:54-66` asserts only `code` and `statusCode` for `s3`, where the two names coincide). The shipped code is correct; a one-line assertion on that error's `service` would close the hole for a future refactor.
3. `resolveService` runs twice per `send` - once at `signer.ts:101` and again inside `resolveEndpoint` at `:102`, which is handed the raw union. The helper is pure, so this is redundant work, not a behaviour difference; passing the resolved value would need a second `resolveEndpoint` overload and was reasonably not done.
4. `ServiceDescriptor` performs no runtime validation, so `{ service: '', signingName: '' }` would resolve to `.<region>.amazonaws.com`. The type makes both fields required under `exactOptionalPropertyTypes`, which is what the DoD's "impossible by construction" asks for; runtime validation of plugin-supplied descriptors belongs with the `Plugin` contract validator (task 03) if it is wanted at all.
5. The seam has no consumer in core until task 33 lands, as expected; `pnpm knip` is clean regardless. Region availability for Firehose and S3 Tables remains task 38's concern.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All eight obligations are satisfied on collected evidence - `SIGNING_NAMES` and `canonicalHost`'s body are byte-identical to the parent by hash, one exported `resolveService` feeds all four `service`-keyed sites with the right field each, both silent-failure traps were independently re-mutated and are caught by shipped tests, 54 `ServiceKey`-vs-descriptor request pairs across every core client's service are byte-identical under a frozen clock, and all six CI gates plus the 29-claim type gate are green.
