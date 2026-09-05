# Independent combined gate — task 65

Revision: a57b3ffaca704a75bc548014f2c5510936935446 (change kqpssopskrpvnukmzppxqxllmyswlwot), parent 32225f50. Workspace: /private/tmp/blogwright-complete-65. Reviewer: verify65, independent of implementer and certificate author. Date: 2026-09-05.

P1: The change modifies packages/core/src/state.ts (new isRecord, isOutputValue, invalidStateField, validateState; StateStore.load), packages/core/src/state.test.ts (transport fixture and persisted-shape cases), packages/cli/src/plugin-commands.test.ts (three lifecycle rejection cases), and .changeset/validate-persisted-state.md.
P2: The task requires validating unknown persisted OpsState and ResourceOutputs at the S3 load boundary before graph execution, with contextual diagnostics and historical serialization compatibility.
P3: Must preserve missing-state defaults, malformed-JSON causes, valid historical and unknown fields, scoped/unscoped storage identities, and downstream CLI/plugin graph behavior.

## Function resolution

The five-step local / enclosing class / module / import / builtin sequence was applied to each changed call family. No behavior-changing shadowing or unresolved call was found.

- state.ts:18–54: isRecord, isOutputValue and invalidStateField have no local or class binding and resolve at module scope. Array.isArray, Object.entries, JSON.stringify and Error have no preceding binding and resolve to builtins. value.every resolves at local parameter value after Array.isArray narrowing, using the builtin Array.prototype.every; the callback tests each local item. JSON serialization of field names produces escaped field paths only.
- state.ts:104–122: this.s3.getObjectText resolves through the enclosing StateStore constructor property typed by imported S3Client to aws/s3.ts:151; its getObject uses the signing client and only AwsError.isNotFound becomes undefined. emptyState and validateState resolve at module scope after no local/class match. JSON.parse and Error resolve to builtins after all preceding scopes. The validator is outside the syntax catch; shape errors propagate directly. No cast of parsed data to OpsState remains.
- state.test.ts: response and s3With resolve at module scope; load resolves locally within describe.each, wrapping the actual StateStore.load. StateStore/emptyState are imports from ./state.js; S3Client and SigningClient resolve to their respective AWS modules. describe/it/expect resolve to vitest imports. map callbacks, store.load/store.save, request body and promise matchers resolve on their local receivers; TextEncoder/TextDecoder/JSON are builtins. Assertions use Vitest's imported expect and its matchers. There is no substitute validation helper in the tests.
- plugin-commands.test.ts: makeNodePlugin, fakePluginNode, recordingS3 and testContextFactory resolve at module scope; makeContext is the local factory result. buildDiscoveryPorts resolves to ./test-support.js:395; runPlugin to ./plugin-commands.js; createLogger to ./logger.js; createScriptedTerminal to blogwright-core's exported terminal implementation. describe/it/expect resolve to vitest imports. effects.push/calls.push resolve to local arrays; Set and JSON resolve to builtins. s3.getObjectText is intentionally replaced locally as the recorded S3 input, while production StateStore.load remains real.

## Concrete before/after trace

Input is JSON {"version":1,"env":"production","resources":{"node":{"output":null}}} stored at state/production.demo.json.
1. Previously StateStore.load returned JSON.parse(text) as OpsState; runPlugin could receive a null output and proceed into the selected graph command.
2. Now getObjectText returns that same text; JSON.parse produces unknown data and validateState calls invalidStateField.
3. Envelope types pass; resources and node outputs are objects; isOutputValue(null) is false.
4. invalidStateField returns resources["node"]["output"]; validateState throws Error naming the bucket, key and field without the null value or raw document.
5. toPluginContext rejects before runPlugin's awaited command argument completes (plugin-commands.ts:720), so nodes construction, resource reads/writes, save and deletion cannot run. All bootstrap/status/destroy cases independently assert no nodes call, unchanged fake world, and exactly one S3 get.

This closes the root cause at the shared persisted trust boundary rather than adding a CLI-only symptom guard.

## Regression traces and edge cases

- createContext (context.ts:239) calls store.load before returning OpsContext. A missing object/bucket produces emptyState(env), allowing ordinary first-run operation; invalid or malformed state rejects before the caller obtains graph context: PRESERVED.
- toPluginContext (plugin-commands.ts:332) calls scoped store.load; valid loaded resources are returned as the plugin's state, with siteState kept separate. The existing save closure persists that same state; generic lifecycle commands run only after the await: PRESERVED.
- save/load round-trip accepts string, number, boolean, string arrays including empty arrays; save updates the timestamp as before. Negative/fractional version, mismatched historical env, arbitrary identifiers/output names, non-ISO timestamp strings, and unknown envelope fields survive unchanged: PRESERVED.
- NoSuchKey/NoSuchBucket are translated by S3Client into undefined, and only undefined gets empty state. Empty body and malformed text retain the contextual Error and SyntaxError cause, in both key forms: PRESERVED.
- New shape diagnostics interpolate location and escaped field names only, never output values or full state: PRESERVED.
- Omitted updatedAt resolves to undefined and is accepted, consistent with JSON serialization of the exported string | undefined field. Unknown envelope fields are not filtered. Nested outputs, non-string arrays, null/array objects and wrong envelope primitives are rejected. No unhandled edge cases identified within the declared type/JSON boundary.

## Executed evidence

All commands used PATH=/private/tmp/blogwright-tools:$PATH and the existing pnpm store; no installation or VCS mutation was performed. Logs are /tmp/verify65-<name>.log.

| Check | Result |
| --- | --- |
| pnpm build | exit 0 (build.log) |
| pnpm typecheck | exit 0 (typecheck.log) |
| TZ=America/New_York pnpm test | exit 0; 1609 passed, 1 skipped: core 220+1 skipped, build-agent 27, pds 150, analytics 827, CLI 385 (test.log) |
| pnpm lint | exit 0; existing warnings (lint.log) |
| pnpm exec oxfmt --check . | exit 0; 205 files (format.log) |
| pnpm knip | exit 0 (knip.log) |
| focused core src/state.test.ts | exit 0; 73 passed (state.log) |
| focused CLI src/context.test.ts src/plugin-commands.test.ts | exit 0; 105 passed (cli.log) |
| validation call bypass | exit 1; 52 failed, 21 passed, all shape rejection assertions fail (negative.log) |
| exact-byte restoration and state rerun | exit 0; 73 passed (restored.log) |

The negative control removed only the production validateState call, using a finally block to restore original bytes. Restored state.ts SHA256: 72e7f4c8406363e40b289ce26c480dc1b289d92f54542dba8a27e514ff02819d. Full suite was run after restoration. Changeset declares blogwright-core patch and describes state-boundary rejection.

## Obligation discharge

O1 SATISFIED: state.ts:4–11 type contract matches guards at 18–54 and unknown parsing at 112–122; state.test.ts:116 onward exercises 26 invalid shape cases for each of two scopes and contextual/no-value-leak diagnostics.
O2 SATISFIED: focused scoped/unscoped missing bucket/key and malformed JSON/cause cases pass, and static context/lifecycle traces establish rejection before graph context is usable; no fallback catches shape errors.
O3 SATISFIED: historical compatibility and save/load round-trip tests pass for both scopes; static code adds no format, identity, version range or unknown-field restrictions.
O4 SATISFIED: all six gates executed successfully, changeset inspected, negative control failed 52 assertions, exact bytes restored and tests passed.
O5 SATISFIED: focused 73 state and 105 context/lifecycle tests pass, three invalid-state lifecycle paths show zero graph effects, and unchecked JSON.parse-as-state boundary is removed.

All obligations match the main task DoD in order; no contract drift or weakening. Existing serialization/defaults, CLI/plugin graph callers and diagnostic confidentiality are PRESERVED.

Correctness VERDICT: CORRECT
Completeness VERDICT: DONE
CONFIDENCE: high
SUMMARY: All five obligations are independently satisfied by source traces, six passing repository gates, focused tests and a failing/restored negative control; no regression or unresolved call remains.
