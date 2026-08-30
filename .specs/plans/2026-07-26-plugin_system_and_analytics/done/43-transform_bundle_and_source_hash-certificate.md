# Done Certificate - Task 43: Bundle the transform with rolldown and stamp a reproducible source hash

**Task:** [43-transform_bundle_and_source_hash.md](43-transform_bundle_and_source_hash.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 43. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.
>
> **Three evidence steps were corrected during the first discharge and are carried forward**
> (each marked *corrected* inline): O1's `node:` grep used single quotes and returned 0 as a
> false negative; O2's `pnpm test -- transform-hash` does not filter and silently runs the whole
> suite; and the third regression trace expected an agent-manifest hash that cannot stay
> unchanged. The corrected commands are the ones a future reader should run.
>
> **This is the second discharge**, over the delta that closes the first discharge's one open
> defect (M14). Every obligation was re-collected against the current tree, not inherited on
> paper; the hash the build now stamps is `14b704813aea`, not the `733b2a4abb39` the first
> discharge recorded, because the delta edits four hashed source files.

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
  - *Evidence collected:* `packages/analytics/src/transform/rolldown.config.ts:38-58` carries `platform: 'node'`, `format: 'esm'`, `codeSplitting: false` for both entries, matching `packages/build-agent/rolldown.config.ts:10-28`. `rm -rf packages/analytics/dist && pnpm --filter blogwright-analytics build` from the workspace root exits 0 and emits `dist/transform-bundle/` holding exactly two files - `index.mjs` (806,821 bytes) and `transform-manifest.json` (88 bytes) - with the manifest writer emitted separately to `dist/write-transform-manifest.mjs` (17,350 bytes). `tsc` runs last and does not clear `dist/`, so all three survive; `dist/index.js`, `dist/aws/*.js` and `dist/transform/{bots,handler,map-record,visitor-key}.js` are still emitted for `src/`.
  - *Evidence step corrected (carried forward):* the authored grep `grep -n "^import .*from 'node:" <bundle>` returns **0 - a false negative**: rolldown emits **double** quotes. The correct command is `grep -cE '^import .*from "node:' packages/analytics/dist/transform-bundle/index.mjs`, which returns **9** external builtins, re-confirmed on this tree: `node:crypto`, `node:fs`, `node:fs/promises`, `node:module`, `node:os`, `node:path`, `node:process`, `node:stream`, `node:zlib`. None is inlined; all nine are provided by the Lambda Node runtime.
  - *Additional check (artifact, not source) - inherited from the first discharge, undisturbed by the delta.* The delta does not touch `entry.ts`, `handler.ts` or `map-record.ts`, so the runtime behaviour proved there stands: the built `.mjs` exports one `AsyncFunction` named `handler` of arity 1; a full invoke under `AWS_REGION=eu-west-2` signed `https://secretsmanager.us-east-1.amazonaws.com/` with `Credential=…/us-east-1/secretsmanager/aws4_request` and no `eu-west-2` anywhere in the signature; exactly **one** `GetSecretValue` across two invocations; `Ok` for a well-formed record and `ProcessingFailed` for an unmappable one and for a corrupt payload, with no raw viewer IP in the emitted row; reject-at-init with `handler.ts:143`'s exact message when `ANALYTICS_SALT_SECRET_NAME` is unset; and `AWS_ENDPOINT_URL` does not move the request off us-east-1, because `entry.ts` constructs `SigningClient` directly and bypasses `packages/core/src/clients.ts:53`.
  - *New this discharge - the artifact's export shape is now gated by the build, not by a one-time manual check.* `write-manifest.ts:114` runs `await assertBundleExportsHandler()` before anything else, as step 2 of the `&&` chain in `packages/analytics/package.json:16`. Three mutations, each with a control build first and each restored after:

    | Mutation | Build exit | Message | Manifest written? |
    |---|---|---|---|
    | **A** `format: 'esm'` → `'cjs'` (`rolldown.config.ts:44`) | **1** | "could not be loaded as an ES module … a rolldown output `format` other than 'esm' is the usual one", `[cause]: ReferenceError: exports is not defined in ES module scope` | **no** |
    | **B** entry export `handler` → `transformHandler` | **1** | "exports [transformHandler], so the configured Handler \"index.handler\" resolves to nothing at invoke time" | **no** |
    | **C** `export const handler = createTransformHandler` (the factory) | **1** | "exports \"handler\" as an ordinary **Function**, not the async function Lambda awaits" | **no** |

    On Node v24.19.0 the CJS-in-`.mjs` bundle **throws at load**, as the implementer reports. The try/catch at `write-manifest.ts:88-100` genuinely handles **both** outcomes: the throw path was exercised by mutation A above, and the earlier gate's import-to-`[]` outcome was exercised directly by substituting a bundle that is valid ESM but exports nothing (`var exports = {}; exports.handler = …`), which fails on the *second* branch - `exports [], so the configured Handler "index.handler" resolves to nothing` - also exit 1, also no manifest. A **missing** bundle fails the same way with `[cause]: ERR_MODULE_NOT_FOUND`.
  - *Both required properties of the fix, proved separately.*
    - **It cannot be skipped.** The check is an unconditional top-level `await` (`write-manifest.ts:114`), not gated on `dist/` existing, on an env var, or on a flag; it is step 2 of the package `build` script, so it runs on `pnpm --filter blogwright-analytics build` and on the root `pnpm build`. Deleting the second rolldown entry would not skip it either - `node dist/write-transform-manifest.mjs` then fails on a missing file.
    - **It precedes the stamp.** Proved at runtime, not from source: after each of A, B and C, `dist/transform-bundle/` contained `index.mjs` **and no `transform-manifest.json`**. A failing bundle never acquires a key, so task 50 has nothing to deploy.
  - *The detail the fix depends on, verified in the emitted artifact.* `dist/write-transform-manifest.mjs:347` reads `bundle = await import(pathToFileURL(bundlePath).href);` - the computed specifier survived bundling as a **real runtime import of the file on disk**. Rolldown did not resolve or inline the entry: grep over the emitted writer for `mapRecord`, `dailySalt`, `ProcessingFailed`, `decodePayload`, `loadSaltSecret` and `transformFirehoseRecords` returns **0 for every one**, and the only hits for `createTransformHandler`/`SigningClient` are inside a comment and an error-message string. Had rolldown inlined `entry.ts`, the step would have re-checked the source and reproduced the very defect it closes.
  - *Expectations derived, not restated.* In the emitted writer: `const handlerBinding` comes from `TRANSFORM_LAMBDA_HANDLER.split(".")` (`:327`), the path from `resolve(TRANSFORM_BUNDLE_DIR, TRANSFORM_BUNDLE_FILE)` (`:344`). The only `"handler"`- or `"index"`-shaped literals in the file are the three constant definitions themselves (`:182`, `:203`). Mutating `TRANSFORM_LAMBDA_HANDLER` to `'index.transformHandler'` reddens **both** pins: `entry.test.ts` fails `expected [ 'handler' ] to strictly equal [ 'transformHandler' ]`, and the build fails `exports [handler], so the configured Handler "index.transformHandler" resolves to nothing`.
  - *No secret is read during a build.* `SALT_SECRET_NAME_ENV` is set to the placeholder **name** `build-time-export-check/not-a-real-secret` only when the variable is absent or blank (`write-manifest.ts:83-85`), verified by observing the final value in three runs: unset → placeholder; `'   '` → placeholder; `'example-site/prod/analytics-salt'` → **preserved**. `createTransformHandler` resolves only the secret's *name* at construction (`handler.ts:230`) and reads its value on first invoke, and nothing is invoked. Proved live: the build step run with `globalThis.fetch`, `http.request/get` and `https.request/get` all replaced by a trap that exits 97 completes with **exit 0** and stamps the manifest - **zero `GetSecretValue`, zero network of any kind**. It is also environment-independent: with `env -i` (no `HOME`, no `~/.aws`, no `AWS_*`) and separately with hostile `AWS_REGION=eu-west-2 AWS_ACCESS_KEY_ID=nope AWS_ENDPOINT_URL=http://localhost:1`, it exits 0 and stamps the **identical** hash, so no ambient credential state leaks into the artifact.
  - *Status:* ☑ SATISFIED

- **O2 - Source-hash inputs and stability.**
  - *Claim:* the hash covers the transform's source (not the bundle), includes the rolldown config, `tsconfig.json` and `package.json`, is byte-stable across two runs over identical source, and changes when one source byte changes.
  - *Evidence collected:* `packages/analytics/src/transform-hash.ts:169-191` mirrors `packages/build-agent/src/agent-hash.ts:32-58` input for input - the two `src` collections, the four manifests/configs, the lockfile, the codepoint sort at `:181`, and the `label` NUL `bytes` NUL framing at `:184-189`. The rolldown config is covered by the `analytics/src` collection rather than listed twice (`:44-46` of the module docstring). **The bundle path appears nowhere in the input list**; `TRANSFORM_BUNDLE_DIR` is referenced only by `rolldown.config.ts` and `write-manifest.ts`, never by `transformSourceHash`.
  - *Evidence step corrected (carried forward):* `pnpm test -- transform-hash` **does not filter** - pnpm swallows the `--` and vitest runs all 15 files / 435 tests. Use `pnpm exec vitest run src/transform-hash.test.ts src/transform/entry.test.ts --reporter=verbose`, which is green at **29/29** on this tree.
  - *Checks discharged:* the file-reading call is the injected `FileSystem` port (`transform-hash.ts` imports it `type`-only; `collectSource` and the digest loop call `fs.listFiles`/`fs.readBytes`). `.oxlintrc.json` is **not edited by this diff at all**, so **step 5 was correctly skipped**: the delta's two new imports in `write-manifest.ts` are `node:path` and `node:url`, neither of which is on the `no-restricted-imports` list (`.oxlintrc.json:56-68` restricts `fs`, `fs/promises`, `child_process`, `readline`, `module` and their `node:` spellings). The rule is *not* weakened, re-proved live on the delta's own file: injecting `import { writeFile } from 'node:fs'` into `transform/write-manifest.ts` raises `eslint(no-restricted-imports)` with the hexagonal-architecture message and oxlint exits 1.
  - *Status:* ☑ SATISFIED

- **O3 - The hash is stamped into a build-time manifest.**
  - *Claim:* a manifest file beside the bundle carries the hash, written at build time, so the plugin reads it at runtime without the source tree.
  - *Evidence collected:* `dist/transform-bundle/transform-manifest.json` reads `{ "hash": "14b704813aea", "key": "analytics/transform/transform-14b704813aea.zip" }`. `packages/analytics/package.json:16` invokes `node dist/write-transform-manifest.mjs` after the rolldown step and before `tsc`, mirroring `packages/build-agent/package.json:7`. The manifest is under `dist/`, which is the package's whole `files` array (`package.json:6-8`), so it ships. `write-manifest.ts:116` is the build-time edge that constructs `createNodeFileSystem()`; `transform-hash.ts` constructs nothing.
  - *The delta does not disturb the stamp.* `write-manifest.ts:114-125` keeps the original order - check, then `createNodeFileSystem()`, then `transformSourceHash`, then `fs.writeText` to `${TRANSFORM_BUNDLE_DIR}/${TRANSFORM_MANIFEST_FILE}` - and the same order is visible in the emitted `dist/write-transform-manifest.mjs:355-362`.
  - *Status:* ☑ SATISFIED

- **O4 - One home for the zip key.**
  - *Claim:* the zip key derived from the hash is exported from `packages/analytics/src/transform-hash.ts` and its format is written in exactly one module.
  - *Evidence collected:* `transformZipKey(hash: string)` at `transform-hash.ts:200-207` takes the hash and derives the key; it accepts no pre-formatted string, and rejects a malformed hash rather than producing `transform-undefined.zip`. *Evidence step corrected (carried forward):* scope the grep to `src/` - `grep -rn "\.zip" packages/analytics/` also hits gitignored `dist/` build output. `grep -rn "\.zip" packages/analytics/src/` shows the key format in exactly one production module (`transform-hash.ts:206`); the only other hits are that module's own error message and `aws/lambda.ts:360`'s `ZipFile` API field, which is not a key format. `pnpm knip` is clean from the root, and the gate is live: injecting one unconsumed export into `transform-hash.ts` makes knip report `Unused exports (1) GATE_PROBE_UNUSED` and exit 1.
  - *Prior residue on this obligation is retired.* The first discharge noted `TRANSFORM_LAMBDA_HANDLER`'s only consumer was `transform/entry.test.ts`. The delta gives it a **production** consumer: `write-manifest.ts:62` splits it to derive the binding the emitted bundle must export. The constant is now pinned by one test and one build step, exactly as its docstring claims.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six gates run from the workspace root, in `.github/workflows/ci.yml:21-29` order, on a pristine tree with `packages/*/dist` wiped first and after every mutation below was restored: `pnpm build` PASS (exit 0) · `pnpm typecheck` PASS · `pnpm test` PASS (**435** analytics tests in 15 files; **1045 passing + 1 skipped** across the five packages - core 149+1, build-agent 27, pds 117, analytics 435, cli 317) · `pnpm lint` PASS (analytics emits nothing; the `no-shadow` warnings are pre-existing in `packages/cli/src/nodes.test.ts`, which this diff does not touch) · `pnpm exec oxfmt --check .` PASS (178 files) · `pnpm knip` PASS. Limits are named constants (`HASH_LENGTH`, `HASH_PATTERN`, `TRANSFORM_BUNDLE_DIR`, `TRANSFORM_BUNDLE_FILE`, `TRANSFORM_MANIFEST_FILE`, `TRANSFORM_LAMBDA_HANDLER`, `SALT_SECRET_REGION`, `EXPORT_CHECK_SECRET_NAME`); `transformZipKey`'s throw names the offending value and the remedy. The one new external interaction (Secrets Manager) is constructed only at the composition root, `transform/entry.ts`.
  - *No assertion changed in the delta.* The delta spans four files and 152 changed lines; **not one** contains `expect(`, `it(`, `it.each`, `describe(`, `toBe`, `toStrictEqual`, `toThrow`, `toHaveLength` or `toMatch`. `entry.test.ts`'s only hunk is `@@ -1,11 +1,19 @@` - the header comment. The analytics count is therefore still 435, measured, and it is 435 because no test was added or removed, not by coincidence.
  - *The three build-only modules are excluded from emit but still typechecked.* `tsconfig.typecheck.json` is `{"extends":"./tsconfig.json","compilerOptions":{"noEmit":true},"exclude":[]}`, and the gate is live: injecting `const gateProbe: number = "not a number";` into `write-manifest.ts` yields `src/transform/write-manifest.ts(129,7): error TS2322` and exit 2.
  - *Changeset: not required, and correctly omitted.* `packages/analytics/src/index.ts` re-exports only `./aws/*` and `ANALYTICS_NAMESPACE`; nothing added here reaches the package's `exports` surface, and no node deploys the function yet. This is the call tasks 39, 40, 41 and 42 each recorded for this package, with the analytics plugin's changeset coverage scheduled at task 58.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: two builds agree, a changed byte disagrees (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright-analytics build` twice from a clean checkout and observe an identical manifest hash, then change one byte in `packages/analytics/src/transform/map-record.ts`, rebuild, and observe both the hash and the derived zip key change.
  - *Evidence collected:* reproduced end to end this discharge, each of the four builds preceded by `rm -rf packages/analytics/dist` so every one is a genuine clean rebuild. Build 1 → `14b704813aea`; build 2 → `14b704813aea`, manifests **byte-identical** (`cmp` clean), and the bundle itself byte-identical too (`sha256 9521b7b30f4fdfe35c72ddf7b7cfd616d3fb953392c7228d6d076469412b2d95` both times). One byte into `map-record.ts:2` (`one` → `One`; `cmp -l` reports **exactly one** differing byte, offset 21, `0157` → `0117`) → build 3 → `d70b4ac2c0bc`, and the key moved with it to `analytics/transform/transform-d70b4ac2c0bc.zip`. File restored (`cmp` against a pre-gate copy clean; `jj status` no longer lists it) → build 4 → `14b704813aea` returns and the manifest is `cmp`-identical to build 1's.
  - *Status:* ☑ SATISFIED

## Falsifiability sweep (verifier-run, not accepted from the implementer)

The first discharge ran 24 mutations, 22 killed with 2 accounted survivors (M15 a dormant harness
guard, demonstrated by M16; **M14 the open defect**). This discharge re-ran the mutations the
delta could have affected and added seven new ones. Every restore is proved twice: by `cmp`
against a pre-gate snapshot of all twelve touched-or-adjacent files (all twelve `OK`), and by
`jj diff --git` over the whole workspace being **byte-identical** to the diff captured before the
first mutation.

| # | Mutation | Result |
|---|---|---|
| **M14** | **`format: 'esm'` → `'cjs'`** (the first discharge's survivor) | **NOW KILLED.** Build exits 1 at step 2 with a named cause; no manifest written. |
| M14b | valid-ESM bundle exporting nothing, substituted for the emitted `.mjs` | killed on the second branch: `exports []` - proves the try/catch covers the earlier gate's outcome as well as this Node's throw |
| M14c | emitted bundle deleted before the check | killed: `[cause]: ERR_MODULE_NOT_FOUND` |
| M7′ | export the **factory** (`createTransformHandler`) | killed at build time: "as an ordinary **Function**, not the async function Lambda awaits" - distinguishes `Function` from `AsyncFunction` as required |
| M8′ | rename the export binding | killed at build time naming the actual exports: `exports [transformHandler]`; also still killed in `entry.test.ts` |
| M24 | `input: 'src/transform/entry.ts'` → `'src/transform/handler.ts'` | killed: `exports [SALT_SECRET_NAME_ENV, createTransformHandler]` |
| M25 | `codeSplitting: false` → `true` | killed - but **at the rolldown step**, `[INVALID_OPTION] … "output.dir" must be used, not "output.file"`, not at `write-manifest.ts`. The build reddens, which is the load-bearing claim; see Residue. |
| M9′ | `TRANSFORM_LAMBDA_HANDLER` → `'index.transformHandler'` | killed **twice**: `entry.test.ts` (`expected [ 'handler' ] to strictly equal [ 'transformHandler' ]`) and the build |
| M10b′ | `node:fs` into `transform/write-manifest.ts` | `eslint(no-restricted-imports)`, oxlint exits 1 |
| M11′ | one unconsumed export added to `transform-hash.ts` | knip reports `Unused exports (1)` and exits 1 |
| M26 | type error injected into `write-manifest.ts` | `pnpm typecheck` exits 2 - the emit exclusion does not hide the build-only modules |
| M1-M6, M12, M13, M15-M23 | the hash-input, framing, sort, filter, guard and truncation mutations | **inherited.** The delta does not touch `transform-hash.ts`'s digest, its input list, or `transform-hash.test.ts` (its only edits to that module are three docstrings), so the first discharge's results stand: `Math.random()` in the digest kills **7** including *both* byte-stability tests; each of the seven hash inputs kills exactly its own case; the bundle-exclusion test is non-vacuous. |

### Negative controls (the checks must not be vacuous)

- `entry.test.ts` is **green with `dist/` deleted entirely** (2/2) and **green with a bundle that
  exports nothing** in place (2/2), while the build step on that same artifact exits 1. This is a
  direct proof of the corrected header: the test pins the source and says nothing about the
  artifact, and the build step is what covers the artifact.
- A control build preceded every mutation, and the control hash `14b704813aea` was recovered
  after each restore.

## Verification of the corrected docstrings

Each of the three was checked as a claim, not read as prose.

- **`entry.test.ts:2-19`** now opens "an *entry module* that does not export what the function's
  configured `Handler` string names" and adds a "Scope, precisely" paragraph stating it pins the
  **source**, says nothing about the emitted file, and therefore nothing about `format`, `input`
  or `codeSplitting`. **True**, and demonstrated by the two negative controls above. It mentions
  those three options only to disclaim them.
- **`rolldown.config.ts:18-24`** now says nothing in the config is asserted by a test and that
  the output is checked at build time by `write-manifest.ts`. **True**: no test in the package
  reads this config or the emitted file, and `format` (M14) and `input` (M24) both redden the
  build at `write-manifest.ts`. Its companion comment at `:48-53` no longer claims the zip stays
  one file *because* the writer is emitted elsewhere; it now states the directory's real
  contents.
- **`transform-hash.ts:119-126`** now says "Two checks pin this constant against a real export
  rather than a comment: `transform/entry.test.ts` against the entry *module*'s, and
  `transform/write-manifest.ts` against the emitted *bundle*'s, on every build." **True** - M9′
  reddens both.

## The zip-contents contradiction - resolved

The first discharge recorded two comments disagreeing about what the zip holds. Five sites now
agree, and they agree with what the code does:

| Site | Says |
|---|---|
| `rolldown.config.ts:6` | "A Lambda deployment package is a zip, and this one holds exactly one module" |
| `rolldown.config.ts:48-53` | the writer is emitted outside `TRANSFORM_BUNDLE_DIR` because it is a build tool; that directory holds "the bundle, which is the zip's one and only entry, and the manifest beside it, which task 50 reads for the hash and key and does not ship" |
| `transform-hash.ts:82-88` (`TRANSFORM_BUNDLE_DIR`) | "It holds two files, and they are not both deployment artifacts… Task 50 zips the bundle file alone… and never the directory wholesale" |
| `transform-hash.ts:97-99` (`TRANSFORM_BUNDLE_FILE`) | "this file, alone, is what that zip contains" |
| `transform-hash.ts:107-110` (`TRANSFORM_MANIFEST_FILE`) | "written beside the bundle in `TRANSFORM_BUNDLE_DIR` and read beside the zip - **never packed inside it**" |

The stale sentence the first discharge quoted ("the zip's contents are exactly what this
directory holds") is gone. The answer is unambiguous for task 50: **the zip contains exactly
`index.mjs`; the manifest is read from disk beside it, never packed inside.** That matches what
`write-manifest.ts:123-126` actually does - it writes
`dist/transform-bundle/transform-manifest.json`, beside the bundle in the same directory - and
nothing in this task zips anything.

## Regression check

- `.oxlintrc.json:71-84` (the `no-restricted-imports` override list) → **PRESERVED.** The file is **not edited by this diff at all** (step 5 deliberately not done, sanctioned by O2), so the four existing packages lint exactly as before - confirmed by a green root `pnpm lint`. M10b′ proves a deliberate filesystem import in the delta's own new module still errors. : ☑ PRESERVED
- `packages/analytics/package.json` `build` (rewritten here) invoked by root `pnpm -r build` → **PRESERVED.** `tsc -p tsconfig.json` still runs and still emits `dist/` for `src/` alongside the new bundle step; `tsc` runs last and does not clear the rolldown output. The three new build-only modules are excluded from *emit* but still typechecked, proved live by M26. : ☑ PRESERVED
- `packages/build-agent/src/agent-hash.ts` → **PRESERVED in behaviour; the stamped value moves, by design.** *Evidence step corrected (carried forward):* the authored expectation ("`dist/agent-manifest.json` carries the same hash as before this task") **cannot hold** for any task that adds a dependency to any workspace package, and is the wrong check. What holds instead: `agent-hash.ts` is byte-identical to the parent revision; `pnpm-lock.yaml`'s entire delta is **three lines** in the `packages/analytics` importer (`rolldown: ^1.1.4 → 1.1.5`); the move is caused solely by the lockfile input, which `agent-hash.ts:40-42` declares intentional. DEVELOPMENT.md §Repository hygiene forbids changing the hashing *inputs* casually; the inputs are untouched. Nothing in the repo pins either value - `grep -rn "14b704813aea\|733b2a4abb39"` outside `node_modules`/`dist`/`.jj` returns **nothing** - so the cost is one builder-image rebuild per consumer, once, with no stale reference left behind. **Ruling: acceptable, nothing owed beyond this record.** : ☑ PRESERVED (value moved, isolated and sanctioned)
- `handler.ts` and `map-record.ts` (task 42's landed files) → **BYTE-IDENTICAL.** `shasum -a 256` of each working-tree file equals `jj file show -r nmlnzqww` of the same path (`ca59c49a48a4…` and `766d161817e4…` respectively), `jj diff --summary` over both is empty, and neither appears in `jj status`. : ☑ PRESERVED

## Integration check

- **The bookmark advanced twice during this discharge**, to build 41 (task 18) and then, mid-run, to **build 42 - "land task 46 - the DuckDB query adapter"** (`lnmytknr aa5bfb6d`); the task-46 workspace was removed as it landed. The merge was therefore re-checked against the real new head, not a forecast.
- Task 43's ten paths versus everything the head added since this task's base (build 37, `nmlnzqww`): the only overlaps are `packages/analytics/package.json` and `pnpm-lock.yaml`. A three-way `git merge-file` on both (base = build 37, ours = task 43, theirs = build 42) returns **exit 0, zero conflict markers**. The merged `package.json` parses and carries both sides: `dependencies` `{"@duckdb/node-api":"1.5.5-r.4","blogwright-core":"workspace:*"}`, `devDependencies` including `"rolldown":"^1.1.4"`, and the rewritten `build` script intact. **A plain merge is clean.**
- Everything else is disjoint: tasks 18/19 touch only `packages/cli`; tasks 48/49 add `packages/analytics/src/nodes.ts`; task 46 adds `packages/analytics/src/adapters/duckdb-query.ts`. None restates a zip key or a handler string. All of them become hash inputs on merge, so the stamped hash will legitimately differ from `14b704813aea` afterwards; nothing in the repo pins it (grep above).
- Task 42's grep `grep -rn "@aws-sdk\|fetch(\|vi.mock" packages/analytics/src/transform/` still returns **nothing**, including over `entry.ts` and the delta's `write-manifest.ts`.

## Residue

- **`handler.ts:60-62` is stale, and deliberately not fixed here.** It states "the bundle task 43 produces carries no client, no signer and no transport". The bundle necessarily carries all three, because `entry.ts` composes them - which is what the routed finding required. The sentence's *premise* (handler.ts's own import is type-only) remains true. Task 42's landed file is byte-identical in this diff (see Regression check), and the one-phrase correction is **routed to task 58**. Not a defect of this diff.
- **`rolldown.config.ts:18-24` is one word imprecise about `codeSplitting`.** It says changing `format`, `input` or `codeSplitting` reddens the build "there", i.e. at `write-manifest.ts`. For `format` and `input` that is exact (M14, M24). For `codeSplitting: true` the build reddens one step earlier, at rolldown's own `[INVALID_OPTION]` check, never reaching `write-manifest.ts`. The load-bearing claim - the build reddens rather than the dashboard emptying - holds for all three. Prose nit, no action owed.
- **A failed rebuild over a non-wiped `dist/` leaves the previous good build's manifest beside the new broken bundle.** Characterised, not speculated: a good build, then `format: 'cjs'`, then `pnpm build` **without** `rm -rf dist` → exit 1, `index.mjs` replaced by the broken CJS output, `transform-manifest.json` still reading the *previous* hash. This is not exploitable in the deploy direction: no **new** key is minted (the stamp is gated), so task 50's skip-when-unchanged logic leaves the deployed function on its existing code, and the build's non-zero exit stops any pipeline first. Worth knowing when reading a `dist/` by hand.
- **The first discharge's workspace test total (896) was wrong.** The measured total on this tree is **1045 passing + 1 skipped** (149+1 / 27 / 117 / 435 / 317). The analytics figure it quoted, 435, was and is correct.
- The lockfile input is present and asserted live (M17), settling the certificate's open judgement call in favour of including it - matching `agent-hash.ts:47`.
- The published tarball carries an 806 kB bundle with the AWS credential chain inlined, plus the unreachable `dist/write-transform-manifest.mjs` (17 kB). Neither is on any import path a consumer can reach; noted for task 58's packaging review.
- The hash truncation stays at 12 hex characters, matching `agentSourceHash`.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: O1…O6 are all SATISFIED on evidence reproduced this discharge, and the first discharge's one open defect (M14) is closed in the strong form: the emitted `.mjs` is now loaded and checked against `TRANSFORM_LAMBDA_HANDLER` by `write-manifest.ts`, which **cannot be skipped** (an unconditional top-level `await`, step 2 of the package `build` script's `&&` chain) and **precedes the stamp** (proved at runtime - all three mutations left `dist/transform-bundle/` holding `index.mjs` and no manifest, so a failing bundle never acquires a key for task 50 to deploy). Mutating the output `format` to `'cjs'`, renaming the entry's export, and exporting the factory each now exit 1 with a message naming the actual cause, and the check covers both the throw-at-load and the import-to-`[]` outcomes; the check reads a real runtime import of the file on disk, verified in the emitted artifact, with no copy of `entry.ts` inlined; it derives every expectation from the three constants; and it invokes nothing - a build with `fetch` and `http(s).request` trapped completes and stamps, with no `GetSecretValue` and no dependence on AWS configuration. The three corrected docstrings are true as claims, tested rather than read; no assertion changed anywhere in the 152-line delta, so the analytics count is still 435, measured; the zip-contents contradiction is resolved consistently across five sites and matches what the code writes where; `handler.ts` and `map-record.ts` are byte-identical to task 42's landed versions with the stale phrase routed to task 58; all six root gates are green on a wiped tree; the `Reviewable:` line reproduces end to end across four clean builds; and a plain merge against the bookmark's new head (build 42, task 46) is clean with zero conflicts.
