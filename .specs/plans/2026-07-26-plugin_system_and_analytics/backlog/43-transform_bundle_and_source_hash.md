# Task 43 - Bundle the transform with rolldown and stamp a reproducible source hash

**Plan:** [plan.md](../plan.md) · **Certificate:** [43-transform_bundle_and_source_hash-certificate.md](43-transform_bundle_and_source_hash-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics pipeline → Record transformation](../../../changes/2026-07-26-analytics_plugin.md) ("The function is bundled with rolldown into a single file, following the build-agent's precedent, and uploaded as a zip by its resource node"; §Implementation notes step 5 - "The hash keys the uploaded zip so identical source never redeploys the function") and [DEVELOPMENT.md §Repository hygiene](../../../../DEVELOPMENT.md) ("The build-agent manifest hashes the agent's *source*, not the built bundle, so image keys do not vary by platform")
**Depends on:** 42
**Produces:** a single-file ESM bundle of the transform produced by the package's `build` script, plus a build-time manifest carrying a source hash that is byte-stable across runs and changes on any source byte, and an exported zip key derived from it for task 50's function node
**Pointers:** `packages/build-agent/rolldown.config.ts` (the two-entry config to follow: `platform: 'node'` keeping `node:` builtins external, `format: 'esm'`, `codeSplitting: false`), `packages/build-agent/src/agent-hash.ts:32-59` (`agentSourceHash` - the collect/sort/digest shape, the non-test filter at `:12`, the codepoint sort at `:49`, and the config/manifest inputs at `:43-47`), `packages/build-agent/src/write-manifest.ts` (the build step that stamps `dist/agent-manifest.json` and the reason it exists), `packages/build-agent/package.json:6-12` (`"build": "rolldown -c && node dist/write-manifest.js"`), `packages/analytics/package.json:19-24` (the `build` script this task rewrites), `.oxlintrc.json:71-84` (the `no-restricted-imports` override list the manifest writer's `node:fs` use must join)

## Steps

- [ ] Add `rolldown` to `packages/analytics` devDependencies in the same commit that rewrites the build script to invoke it. Task 32 fixed devDependencies to the pds four (`@types/node`, `oxlint`, `typescript`, `vitest`), so without this `pnpm build` fails on a missing binary and `pnpm knip` flags the script's binary. `packages/build-agent/package.json` carries rolldown as a devDependency for exactly this reason.
- [ ] Write `packages/analytics/src/transform/rolldown.config.ts` following `packages/build-agent/rolldown.config.ts`: the handler as input, `platform: 'node'`, `format: 'esm'`, `codeSplitting: false`, output to a single file, plus a second entry for the manifest writer.
- [ ] Write `transformSourceHash(dir)` in `packages/analytics/src/transform-hash.ts` over the transform's *source* - the `transform/` and `src/` trees excluding `*.test.ts` - plus `rolldown.config.ts`, `tsconfig.json`, `package.json` and the workspace lockfile, sorted by label with a codepoint comparison, digested with the label/NUL framing `agentSourceHash` uses.
- [ ] Write `packages/analytics/src/transform/write-manifest.ts` stamping the hash into a manifest file beside the bundle at build time, following `packages/build-agent/src/write-manifest.ts`, so the plugin reads the hash at runtime without access to the source tree.
- [ ] Add the manifest writer's path to the `no-restricted-imports` override list at `.oxlintrc.json:71-84` with the same reason the build-agent entry carries - it is a build-time edge component that writes a file, not a domain module.
- [ ] Rewrite the package `build` script to `rolldown -c -f transform/rolldown.config.ts && node <bundled write-manifest> && tsc -p tsconfig.json` (or the equivalent ordering), so a clean checkout produces both the bundle and the manifest.
- [ ] Export the zip key derived from the hash from `packages/analytics/src/transform-hash.ts`, so task 50's function node consumes one derivation rather than restating the key format.
- [ ] Write `packages/analytics/src/transform-hash.test.ts`: hash the same source twice and assert byte equality; write one changed byte into a temporary copy of the source tree and assert the hash changes.

## Definition of done

- [ ] The transform bundles with rolldown to a single ESM file with `node:` builtins external, following `packages/build-agent/rolldown.config.ts`; the package's `build` script produces it and a clean-checkout rebuild yields the file.
- [ ] The hash is computed over the transform's source, not the built bundle (DEVELOPMENT.md §Repository hygiene - image keys must not vary by platform), its inputs include the rolldown config, `tsconfig.json` and `package.json` as `agentSourceHash` does at `packages/build-agent/src/agent-hash.ts:43-47`, and a test asserts it is byte-stable across two runs over identical source and changes when a single source byte changes.
- [ ] The hash is stamped into a manifest at build time (the `write-manifest.ts` precedent) so the plugin reads it at runtime without access to the source tree.
- [ ] The zip key derived from the hash is exported for the function node (task 50) to consume, so identical source provably maps to an identical key, and the key format is written in exactly one module.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright-analytics build` twice from a clean checkout; confirm the manifest hash is identical across both runs, then change one byte in `packages/analytics/src/transform/map-record.ts`, rebuild, and confirm the hash and the derived zip key both change.
