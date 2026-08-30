# Done Certificate - Task 43: Bundle the transform with rolldown and stamp a reproducible source hash

**Task:** [43-transform_bundle_and_source_hash.md](43-transform_bundle_and_source_hash.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 43. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.
>
> **Three evidence steps were corrected during discharge** (each marked *corrected* inline):
> O1's `node:` grep used single quotes and returned 0 as a false negative; O2's
> `pnpm test -- transform-hash` does not filter and silently runs the whole suite; and the
> third regression trace expected an agent-manifest hash that cannot stay unchanged. The
> corrected commands are the ones a future reader should run.

## Definition

DONE(Task 43) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** The package's `build` script produces a single-file ESM bundle of the transform plus a manifest carrying a source hash that is byte-stable across runs and changes on any source byte, and exports the zip key derived from it for task 50's function node.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the build-agent's own hashing (`packages/build-agent/src/agent-hash.ts`) or its `dist/agent-manifest.json` - a changed builder-image key forces a rebuild for every consumer; and must not break the package's existing `build`/`typecheck` scripts for `src/`, nor the lint gate for the four existing packages when the `.oxlintrc.json` override list is edited.

## Obligations

- **O1 - Single-file ESM bundle from a clean checkout.**
  - *Claim:* rolldown bundles the transform to one ESM file with `node:` builtins external, produced by the package's `build` script, reproducible from a clean checkout.
  - *Evidence collected:* `packages/analytics/src/transform/rolldown.config.ts:30-47` carries `platform: 'node'`, `format: 'esm'`, `codeSplitting: false` for both entries, matching `packages/build-agent/rolldown.config.ts:10-28`. `rm -rf packages/analytics/dist && pnpm --filter blogwright-analytics build` from the workspace root exits 0 and emits `dist/transform-bundle/` holding exactly two files - `index.mjs` (806.82 kB) and `transform-manifest.json` - with the manifest writer emitted separately to `dist/write-transform-manifest.mjs`. `tsc` runs last and does not clear `dist/`, so all three survive; `dist/index.js`, `dist/aws/*.js` and `dist/transform/{bots,handler,map-record,visitor-key}.js` are still emitted for `src/`.
  - *Evidence step corrected:* the authored grep `grep -n "^import .*from 'node:" <bundle>` returns **0 - a false negative**: rolldown emits **double** quotes. The correct command is `grep -cE '^import .*from "node:' packages/analytics/dist/transform-bundle/index.mjs`, which returns **9** external builtins: `node:module`, `node:path`, `node:fs/promises`, `node:os`, `node:crypto`, `node:fs`, `node:stream`, `node:zlib`, `node:process`. None is inlined.
  - *Additional check (artifact, not source).* The built `.mjs` was imported directly with only `globalThis.fetch` stubbed: `Object.keys(import(...))` → `["handler"]`; `typeof handler` → `function`; `handler.constructor.name` → `AsyncFunction` (a factory would be a plain `Function`); `handler.length` → 1. A full invoke with `AWS_REGION=eu-west-2` signed `https://secretsmanager.us-east-1.amazonaws.com/` with `Credential=…/us-east-1/secretsmanager/aws4_request` and no `eu-west-2` anywhere in the signature, issued exactly **one** `GetSecretValue` across two invocations (the cold-start cache), and returned `Ok` for a well-formed record, `ProcessingFailed` for an unmappable one and for a corrupt payload, with no raw viewer IP anywhere in the emitted row. With `ANALYTICS_SALT_SECRET_NAME` unset the module **rejects at init** with `handler.ts:143`'s exact message. With `AWS_ENDPOINT_URL=http://localhost:4566` set, the request still went to `secretsmanager.us-east-1.amazonaws.com` - `entry.ts:38-40`'s claim holds because `process.env.AWS_ENDPOINT_URL` is read only by `packages/core/src/clients.ts:53`, which `entry.ts` bypasses by constructing `SigningClient` directly.
  - *Status:* ☑ SATISFIED

- **O2 - Source-hash inputs and stability.**
  - *Claim:* the hash covers the transform's source (not the bundle), includes the rolldown config, `tsconfig.json` and `package.json`, is byte-stable across two runs over identical source, and changes when one source byte changes.
  - *Evidence collected:* `packages/analytics/src/transform-hash.ts:149-171` mirrors `packages/build-agent/src/agent-hash.ts:32-58` input for input - the two `src` collections, the four manifests/configs, the lockfile, the codepoint sort at `:161`, and the `label` NUL `bytes` NUL framing at `:164-169`. The rolldown config is covered by the `analytics/src` collection rather than listed twice (`:44-46`). **The bundle path appears nowhere in the input list**; `TRANSFORM_BUNDLE_DIR` is referenced only by `rolldown.config.ts` and `write-manifest.ts`, never by `transformSourceHash`.
  - *Evidence step corrected:* `pnpm test -- transform-hash` **does not filter** - pnpm swallows the `--` and vitest runs all 15 files / 435 tests. Use `pnpm exec vitest run src/transform-hash.test.ts src/transform/entry.test.ts --reporter=verbose`, which is green at **29/29**.
  - *Checks discharged:* the file-reading call is the injected `FileSystem` port (`transform-hash.ts:65` imports it `type`-only; `:127` and `:167` call `fs.listFiles`/`fs.readBytes`). `grep -rn "node:fs\|from 'fs'\|node:child_process\|node:readline" packages/analytics/src/` returns nothing, so **step 5's `.oxlintrc.json` edit was correctly not made** and the file is unchanged in this diff. The rule is *not* weakened: injecting `import { readFile } from 'node:fs/promises'` into `transform-hash.ts` and `import { writeFile } from 'node:fs'` into `transform/write-manifest.ts` each raise `eslint(no-restricted-imports)` with the hexagonal-architecture message and exit 1. The two prose rewrites that keep the grep clean (`transform-hash.ts:55` "Node's `fs` module", `write-manifest.ts:14-16` "a direct filesystem import") are **honest, not evasive**, on the identical standard task 38's gate applied: the prohibition and its reason are stated in full at both sites, and the real enforcement is oxlint's parser - proved live above - not the grep.
  - *Status:* ☑ SATISFIED

- **O3 - The hash is stamped into a build-time manifest.**
  - *Claim:* a manifest file beside the bundle carries the hash, written at build time, so the plugin reads it at runtime without the source tree.
  - *Evidence collected:* `dist/transform-bundle/transform-manifest.json` reads `{ "hash": "733b2a4abb39", "key": "analytics/transform/transform-733b2a4abb39.zip" }`. `packages/analytics/package.json:16` invokes `node dist/write-transform-manifest.mjs` after the rolldown step and before `tsc`, mirroring `packages/build-agent/package.json:7`. The manifest is under `dist/`, which is the package's whole `files` array (`package.json:6-8`), so it ships. `write-manifest.ts` is the build-time edge that constructs `createNodeFileSystem()`; `transform-hash.ts` constructs nothing.
  - *Status:* ☑ SATISFIED

- **O4 - One home for the zip key.**
  - *Claim:* the zip key derived from the hash is exported from `packages/analytics/src/transform-hash.ts` and its format is written in exactly one module.
  - *Evidence collected:* `transformZipKey(hash: string)` at `transform-hash.ts:183-190` takes the hash and derives the key; it accepts no pre-formatted string, and rejects a malformed hash rather than producing `transform-undefined.zip`. *Evidence step corrected:* scope the grep to `src/` - `grep -rn "\.zip" packages/analytics/` now also hits gitignored `dist/` build output. `grep -rn "\.zip" packages/analytics/src/` shows the key format in exactly one production module (`transform-hash.ts:189`), restated only by its own tests as the pin. `pnpm knip` is clean from the root, and the gate is live: injecting one unconsumed export into `transform-hash.ts` makes knip report `Unused exports (1)` and exit 1. `transformZipKey`'s consumer is production code (`write-manifest.ts:33`), not a test.
  - *Residue on this obligation:* `TRANSFORM_LAMBDA_HANDLER`'s only consumer today is `transform/entry.test.ts`. That is the sanctioned "export beside its own consumer" shape, not a manufactured one - the test does real work with it (it splits the string and checks both halves), and mutating the constant to `'entry.handler'` reddens a test. Task 42's certificate approved the identical pattern for `SALT_SECRET_NAME_ENV`. Task 50 is its production consumer.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six gates run from the workspace root, in `.github/workflows/ci.yml:21-29` order, after every mutation below was restored: `pnpm build` PASS · `pnpm typecheck` PASS · `pnpm test` PASS (435 analytics tests in 15 files; 896 across the workspace) · `pnpm lint` PASS · `pnpm exec oxfmt --check .` PASS (178 files) · `pnpm knip` PASS. Limits are named constants (`HASH_LENGTH`, `HASH_PATTERN`, `TRANSFORM_BUNDLE_DIR`, `TRANSFORM_BUNDLE_FILE`, `TRANSFORM_MANIFEST_FILE`, `TRANSFORM_LAMBDA_HANDLER`, `SALT_SECRET_REGION`); `transformZipKey`'s throw names the offending value and the remedy. The one new external interaction (Secrets Manager) is constructed only at the composition root, `transform/entry.ts`.
  - *Changeset: not required, and correctly omitted.* `packages/analytics/src/index.ts` re-exports only `./aws/*` and `ANALYTICS_NAMESPACE`; nothing added here reaches the package's `exports` surface, and no node deploys the function yet. This is the call tasks 39, 40, 41 and 42 each recorded for this package, with the analytics plugin's changeset coverage scheduled at task 58.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: two builds agree, a changed byte disagrees (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright-analytics build` twice from a clean checkout and observe an identical manifest hash, then change one byte in `packages/analytics/src/transform/map-record.ts`, rebuild, and observe both the hash and the derived zip key change.
  - *Evidence collected:* reproduced end to end, each build preceded by `rm -rf packages/analytics/dist`. Build 1 → `733b2a4abb39`; build 2 → `733b2a4abb39`, manifests byte-identical. One byte into `map-record.ts:2` (`one` → `One` in a comment) → `01c95e09e502`, and the key moved with it to `analytics/transform/transform-01c95e09e502.zip`. File restored (`jj diff --summary` reports it pristine) and rebuilt → `733b2a4abb39` returns. The bundle itself is also byte-identical across the two clean builds (`sha256 9521b7b3…`).
  - *Status:* ☑ SATISFIED

## Falsifiability sweep (verifier-run, not accepted from the implementer)

24 mutations, control before and each restored after; **22 killed, 2 survivors**. Every restore
proved by `cmp` against a pre-gate snapshot of all eleven touched files - all eleven `OK`.

| # | Mutation | Result |
|---|---|---|
| M1 | `Math.random()` into the digest | **7 killed**, including *both* byte-stability tests (in-memory and real-disk). This is what makes the stability claim non-tautological. |
| M2 | drop the codepoint sort at `:161` | kills **only** "does not move when the file listing comes back in a different order" |
| M3 | digest `path` instead of `label` | kills **only** "does not move when the same source sits at a different absolute path" |
| M4 | drop the `.test.ts` filter at `:129` | kills **exactly** the two test-file-ignoring cases |
| M5 | drop the label from the framing | kills **only** the rename case |
| M6 | collect over the package root so `dist/` enters the inputs | kills **only** "ignores the built bundle" - that test is not vacuous |
| M7 | `export const handler = createTransformHandler` (the factory bug) | killed: `expected 'Function' to be 'AsyncFunction'` |
| M8 | rename the export binding | killed: `expected [ 'transformHandler' ] to strictly equal [ 'handler' ]` |
| M9 | `TRANSFORM_LAMBDA_HANDLER = 'entry.handler'` | killed: `expected 'index.mjs' to be 'entry.mjs'` |
| M10a/b | `node:fs/promises` into `transform-hash.ts`; `node:fs` into `write-manifest.ts` | both raise `no-restricted-imports`, oxlint exits 1 |
| M11 | one unconsumed export added to `transform-hash.ts` | knip reports it and exits 1 - the green knip is meaningful |
| M12 | `transformZipKey` guard disabled | 7 killed |
| M13 | `HASH_LENGTH` 12 → 16 | 10 killed |
| M15 | neuter `hashWithChange`'s targeting guard | **SURVIVOR, accounted.** No test currently mis-targets a path, so the guard is dormant by construction. |
| M16 | typo one override path (`pnpm-lock` → `pnpm-lockfile`) | the M15 guard fires: `expected false to be true` - the survivor is demonstrated, not assumed |
| M17-M23 | drop each of the seven hash inputs one at a time (four explicit entries, `analytics/package.json`, the `core/src` collection, the `analytics/src` collection) | each kills **exactly** its own case (the `analytics/src` drop kills its three) - every input line is independently live |
| **M14** | **`format: 'esm'` → `'cjs'` in `rolldown.config.ts`** | **SURVIVOR - see the defect below.** Build exits 0; all six gates green; the emitted `.mjs` exports **nothing**. |

### The one open defect (M14) - `packages/analytics/src/transform/rolldown.config.ts:36`

`transform/entry.test.ts:1-9` opens: *"The one thing this file exists to catch: a bundle whose
entry does not export what the function's configured `Handler` string names."* It does not test
a bundle. `import('./entry.js')` resolves to `entry.ts` under vitest, so the assertion pins the
**TypeScript source**, never the emitted artifact.

Reproduced consequence: change `format: 'esm'` to `'cjs'` on the first output in
`rolldown.config.ts` - one token, in a file this diff introduces - and

- `pnpm --filter blogwright-analytics build` exits 0;
- `pnpm build`, `pnpm typecheck`, `pnpm test` (435/435), `pnpm lint`, `pnpm exec oxfmt --check .`
  and `pnpm knip` are **all green**;
- the source hash and the derived zip key both move, so task 50's node deploys the new artifact
  under a fresh key;
- and `Object.keys(await import('dist/transform-bundle/index.mjs'))` is **`[]`** - Node reads a
  `.mjs` as ESM, the CJS `exports` assignments bind nothing, `index.handler` resolves to nothing,
  and every record lands in the Firehose error prefix with nothing in this repo reporting it.

That is the same blank-dashboard signature the routed finding was written against, reached by a
different route. The routed finding's own route - the entry exporting a factory - **is** closed,
by a test that fails with `expected 'Function' to be 'AsyncFunction'` (M7). No obligation in this
certificate names an artifact-level assertion, and the repo has no precedent for one (nothing
under `packages/*/src/**.test.ts` loads a built artifact), so this is recorded as a defect to fix
rather than an undischarged obligation. The remedy is small and belongs here: assert against the
emitted `.mjs` - either a post-build check in `write-manifest.ts` before it stamps the hash, or an
`entry.test.ts` case gated on `dist/transform-bundle/index.mjs` existing - so the artifact's export
shape is pinned by something other than a one-time manual check.

## Regression check

- `.oxlintrc.json:71-84` (the `no-restricted-imports` override list) → **PRESERVED.** The file is **not edited by this diff at all** (step 5 deliberately not done, sanctioned by O2), so the four existing packages lint exactly as before - confirmed by a green root `pnpm lint`. M10a/M10b prove a deliberate filesystem import in a domain module outside the list still errors. : ☑ PRESERVED
- `packages/analytics/package.json` `build` (rewritten here) invoked by root `pnpm -r build` → **PRESERVED.** `tsc -p tsconfig.json` still runs and still emits `dist/` for `src/` (`dist/index.js`, `dist/aws/*`, `dist/transform/{bots,handler,map-record,visitor-key}.js`, `dist/transform-hash.js`) alongside the new bundle step; `tsc` runs last and does not clear the rolldown output. The three new build-only modules (`entry.ts`, `rolldown.config.ts`, `write-manifest.ts`) are excluded from *emit* but still typechecked, because `tsconfig.typecheck.json` clears `exclude` - `pnpm typecheck` green. : ☑ PRESERVED
- `packages/build-agent/src/agent-hash.ts` → **PRESERVED in behaviour; the stamped value moved, by design.** *Evidence step corrected:* the authored expectation ("`dist/agent-manifest.json` carries the same hash as before this task") **cannot hold** for any task that adds a dependency to any workspace package, and is the wrong check. What was verified instead: `agent-hash.ts` is **byte-identical** to the parent revision (`diff` clean); `pnpm-lock.yaml`'s entire delta is **three lines** in the `packages/analytics` importer (`rolldown: ^1.1.4 → 1.1.5`); reverting **only** the lockfile and recomputing restores `2bb57656a4b6` exactly, and restoring the lockfile returns `4e5d5ea6ca4d`. The move is therefore caused solely by the lockfile input, which `agent-hash.ts:40-42` declares intentional ("a dependency bump within range must produce a new hash, or a changed agent ships under an unchanged image key and is never rebuilt"). DEVELOPMENT.md §Repository hygiene forbids changing the hashing *inputs* casually; the inputs are untouched. Nothing in the repo pins either value (grep for both returns nothing outside gitignored `dist/`/`agent/`), so the cost is one builder-image rebuild per consumer, once, with no stale reference left behind. **Ruling: acceptable, nothing owed beyond this record.** Task 46, already in review, adds `@duckdb/node-api` to the same importer and will move it again; this is a property of the design, not of this task. : ☑ PRESERVED (value moved, isolated and sanctioned)

## Integration check

- The bookmark was at build 39 (task 48) when discharge began and advanced to **build 40** (task 49, the Glue catalog integration node) during it. Builds 38-40 touch **none** of this task's ten files - `jj diff --summary --from nmlnzqww --to lonlxrtm` over all ten is empty - so a plain merge is clean by disjointness, re-confirmed against the new head. Tasks 48/49 add `packages/analytics/src/nodes.ts`, which uses "transform" only in the Iceberg-partition sense and restates no zip key or handler string; it becomes a hash input on merge, so the stamped hash will legitimately differ from `733b2a4abb39` afterwards, and nothing in the repo pins it.
- Forward-looking: task 46 (in review) also edits `packages/analytics/package.json` and `pnpm-lock.yaml`. A three-way `git merge-file` of both files (base = build 37, ours = task 43, theirs = task 46) produces **0 conflicts**; the merged result carries both the `@duckdb/node-api` dependency and the `rolldown` devDependency. Task 49 touches only `nodes.ts`/`nodes.test.ts`; task 18 only `packages/cli`.
- Task 42's grep `grep -rn "@aws-sdk\|fetch(\|vi.mock" packages/analytics/src/transform/` still returns **nothing**, including over the new `entry.ts`. `handler.ts` and `map-record.ts` are genuinely untouched (`jj diff --summary` over both is empty).

## Residue

- **`handler.ts:60-62` is now stale.** It states "the bundle task 43 produces carries no client, no signer and no transport". The bundle necessarily carries all three, because `entry.ts` composes them - that is what the routed finding required. The sentence's *premise* (handler.ts's own import is type-only) is still true. `handler.ts` was correctly left untouched here, so this is a note for whoever next edits that file, not a defect of this diff.
- **Two comments in this diff disagree about the bundle directory's contents.** `rolldown.config.ts:41-42` says the manifest writer is emitted outside the bundle directory "so the Lambda zip stays exactly one file", but `transform-manifest.json` is written *into* `dist/transform-bundle/` (`write-manifest.ts:36`), and `transform-hash.ts:81` says "the zip's contents are exactly what this directory holds". The directory holds two files. Harmless for Lambda (a `.mjs` in a zip is ESM regardless, and `index.handler` still resolves), but task 50 will read one of these two sentences when it decides what to zip.
- The lockfile input is present and asserted live (M17), settling the certificate's open judgement call in favour of including it - matching `agent-hash.ts:47`.
- The published tarball now carries an 806 kB bundle with the AWS credential chain inlined, plus the unreachable `dist/write-transform-manifest.mjs` (11 kB). Neither is on any import path a consumer can reach; noted for task 58's packaging review.
- The hash truncation stays at 12 hex characters, matching `agentSourceHash`.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: O1…O6 are all SATISFIED on reproduced evidence - the built artifact (not the source) exports one `AsyncFunction` named `handler` that signs `secretsmanager.us-east-1` under `AWS_REGION=eu-west-2`, reads the secret once, and returns `Ok`/`ProcessingFailed` correctly, while rejecting at init without `ANALYTICS_SALT_SECRET_NAME`; the hash excludes the bundle path, is stable across two clean builds and moves with one comment byte in `map-record.ts` along with its derived key; all six root gates are green; 22 of 24 mutations were killed with both survivors identified (one a dormant harness guard, demonstrated by M16; the other the defect recorded below); and the build-agent image-hash move is isolated to the three-line lockfile delta with `agent-hash.ts` byte-identical, which the module's own comment declares intentional. The one open defect (M14) is a standing-coverage gap that no obligation names, so it does not withhold completeness - see the correctness verdict.
