# Task 36 - LambdaClient in blogwright-analytics, distinct from core's MicrovmsClient

**Plan:** [plan.md](../plan.md) · **Certificate:** [36-analytics_lambda_client-certificate.md](36-analytics_lambda_client-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics plugin → Its own service clients (Add)](../../../changes/2026-07-26-analytics_plugin.md) (`LambdaClient` - create/get/update/delete function and its configuration; "the standard Lambda API, distinct from `MicrovmsClient`, which shares the host and signing name but addresses the `/2025-09-09/` MicroVM paths")
**Depends on:** 31, 32
**Produces:** a `LambdaClient` for the standard Lambda function API sharing the host and signing name with `MicrovmsClient` but none of its paths, with the relationship stated in a module doc comment and proved by a test asserting no request carries the `/2025-09-09/` prefix
**Pointers:** `packages/analytics/src/aws/lambda.ts` (new - the client lives here), `packages/core/src/aws/microvms.ts:4-11` (the module doc comment to mirror and extend with a back-reference), `packages/core/src/aws/microvms.ts:13,15-21` (`API = '/2025-09-09'` and the `PATHS` table this task must leave untouched), `packages/core/src/aws/microvms.ts:124-140,179-195` (the REST-JSON `call<T>` helper and the get-returns-undefined / delete-swallows-not-found shapes), `packages/core/src/aws/endpoint.ts:19-31` (`SIGNING_NAMES`, which gains NO `lambda` key - the plugin supplies `{ service: 'lambda', signingName: 'lambda' }` as a descriptor through task 31's seam), `packages/core/src/aws/logs.test.ts:9-16` (the transport-stub helpers the tests mirror), `packages/analytics/src/index.ts` (task 32's seeded barrel - the client is exported from there, never from core)

> **ROUTED FINDING - added 2026-08-30 from task 33's verification gate.**
> This task has the SAME defect task 33 shipped, for the same reason. Core's
> `parseError` (`packages/core/src/aws/signer.ts:177-197`) reads a code only from
> a JSON body (`__type`/`code`/`Code`) or an XML `<Code>` - it never reads
> response headers. Lambda is REST-JSON: its error body is `{"Type":…,"message":…}`
> with the code in the **`x-amzn-ErrorType` header**, so `AwsError.code` arrives as
> `"Http409"` and `ResourceConflictException` never matches `isAlreadyExists`;
> `requestId` is always `undefined`. Task 33's gate confirmed this against the live
> service, not from documentation.
> Mirror task 33's resolution: a local predicate with a `statusCode === 409` limb
> (409 is `ResourceConflictException`'s only status), and an error-response test
> helper that emits the header shape AWS actually sends rather than an invented
> body `code`. Do NOT edit `packages/core`.
> The durable fix - `parseError` reading `x-amzn-errortype`/`x-amzn-requestid`
> from headers it already receives - is recorded in plan.md's open questions as a
> follow-up, and would subsume both instances.

## Steps

- [x] Write `packages/analytics/src/aws/lambda.ts` opening with a module doc comment in the `packages/core/src/aws/microvms.ts:4-11` shape that states the relationship explicitly: the same host (`lambda.<region>.amazonaws.com`) and SigV4 signing name (`lambda`) as `MicrovmsClient`, but the standard `/2015-03-31/functions` API rather than the `/2025-09-09/` MicroVM paths.
- [x] Declare a `PATHS` table in the `packages/core/src/aws/microvms.ts:15-21` shape covering `POST /2015-03-31/functions`, `GET|DELETE /2015-03-31/functions/{name}`, `PUT /2015-03-31/functions/{name}/code` and `PUT /2015-03-31/functions/{name}/configuration`, percent-encoding the function name as `microvms.ts:17` does, and verify each method and path against the Lambda API reference before writing.
- [x] Add a private `call<T>(method, path, payload?)` helper in the `packages/core/src/aws/microvms.ts:124-140` shape, sending the `lambda` service descriptor through task 31's seam with `content-type: application/json`.
- [x] Expose exactly what the transform-function node needs - `createFunction`, `getFunction`, `updateFunctionCode`, `updateFunctionConfiguration`, `deleteFunction` - with a typed input interface for the function's role, runtime, handler, memory, timeout, environment and code location, units stated in doc comments the way `packages/core/src/aws/microvms.ts:23-41` does.
- [x] Give `getFunction` an `AwsError.isNotFound` catch returning `undefined` and `deleteFunction` an `isNotFound` swallow (`packages/core/src/aws/microvms.ts:179-195` is the shape), rethrowing every other failure as an `AwsError` preserving `code`, `statusCode` and `requestId` with the operation and function name prefixed onto the message.
- [x] ~~Extend the `MicrovmsClient` module doc comment at `packages/core/src/aws/microvms.ts:4-11` with a one-line pointer to `LambdaClient`~~ **STRUCK 2026-08-30.** This step contradicted this task's own Definition of done (`packages/core` is untouched) and the change spec, and the implementer correctly refused it rather than picking one. Resolved against the step, for a reason stronger than the vote count: `blogwright-core` is published independently and does NOT depend on `blogwright-analytics`, so a comment in core naming a plugin package's client is a dangling reference for every consumer who installs core alone - and it inverts the dependency direction the whole plugin system exists to enforce, where core knows nothing of plugins. Discoverability from one side is the correct outcome here, not a shortfall: `lambda.ts`'s own doc comment names `microvms.ts`, its `API` constant and its exclusive ownership of `/2025-09-09/`, which is the direction that can be kept true.
- [x] Write `packages/analytics/src/aws/lambda.test.ts` with the `packages/core/src/aws/logs.test.ts:9-16` transport helpers: one recording case per operation pinning method, path and body, an assertion over every recorded URL that none contains `/2025-09-09/`, an absent-function `getFunction` returning `undefined`, a not-found `deleteFunction` resolving, and a `500` rejecting.
- [x] Export the client from `packages/analytics/src/index.ts`, keeping the barrel alphabetical. Nothing is added to `packages/core/src/index.ts`.

## Definition of done

- [x] `LambdaClient` exposes create/get/update/delete for a function and its configuration, and nothing the transform-function node does not need.
- [x] A module doc comment states the relationship - the same host and signing name as `MicrovmsClient`, which addresses the `/2025-09-09/` MicroVM paths - and tests pin the standard Lambda API paths and assert no request carries the `/2025-09-09/` prefix, so the two clients provably do not collide.
- [x] `getFunction` returns `undefined` for an absent function and `deleteFunction` swallows not-found; both directions tested, with non-not-found errors rethrown with context.
- [x] The client is exported from `packages/analytics/src/index.ts`, `packages/core` is untouched, and `pnpm knip` reports no unused export.
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: run `pnpm --filter blogwright-analytics exec vitest run lambda --reporter=verbose` and `grep -rn "2025-09-09" packages/analytics/src/aws/lambda.ts packages/analytics/src/aws/lambda.test.ts`; confirm the suite is green, the grep matches only the test's negative assertion, and `packages/core/src/aws/microvms.ts` still owns every `/2025-09-09/` path.
