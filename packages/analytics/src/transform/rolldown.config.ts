import { defineConfig } from 'rolldown';

import { TRANSFORM_BUNDLE_DIR, TRANSFORM_BUNDLE_FILE } from '../transform-hash.js';

// Bundle the Firehose transform into a single ESM file. A Lambda deployment
// package is a zip, and this one holds exactly one module, so everything the
// function reaches for - the envelope, the record mapping, and the slice of
// blogwright-core the entry composes its Secrets Manager client from - must be
// inlined here.
//
// platform: 'node' keeps `node:` builtins external (the runtime provides them,
// and inlining them is impossible) and auto-polyfills any require() the bundled
// CJS dependencies still use - the ESM-native replacement for a createRequire
// banner. codeSplitting: false forces the one file the zip and the `Handler`
// string assume: the AWS credential chain pulls in dynamic import()s, and a
// second emitted chunk would be a module Lambda cannot resolve.
//
// Nothing in this config is asserted by a test: `entry.test.ts` runs under
// vitest, where `import('./entry.js')` resolves to `entry.ts`, so it pins the
// source module and never the emitted file. The output below is checked
// instead by `write-manifest.ts`, which loads the emitted `.mjs` and asserts it
// exports what `TRANSFORM_LAMBDA_HANDLER` names before it stamps the manifest.
// Change `format`, `input` or `codeSplitting` here and the build reddens
// there - not at invoke time, on an empty dashboard.
//
// This file follows packages/build-agent/rolldown.config.ts, which bundles the
// build-agent the same way for the same reason.
//
// All three modules rolldown reads here - this config, entry.ts and
// write-manifest.ts - are excluded from tsconfig.json's emit, never from
// `pnpm typecheck` (tsconfig.typecheck.json clears `exclude`). This config
// imports `rolldown`, a devDependency, so a compiled copy in `dist/` would ship
// in the published tarball with an import nothing can resolve; the other two do
// work at module load - constructing a signing client, writing a file - and the
// package declares `"sideEffects": false`, which an emitted copy of either would
// make untrue. The bundle is where they belong, and it is the only place they
// are reached from.
export default defineConfig([
  {
    input: 'src/transform/entry.ts',
    platform: 'node',
    output: {
      file: `${TRANSFORM_BUNDLE_DIR}/${TRANSFORM_BUNDLE_FILE}`,
      format: 'esm',
      codeSplitting: false,
    },
  },
  // Build-time helper that checks the bundle above and stamps the manifest with
  // the source hash (run by the package's build script after bundling).
  // Emitted into `dist/`, outside TRANSFORM_BUNDLE_DIR, because it is a build
  // tool and not a deployment artifact: that directory holds the bundle, which
  // is the zip's one and only entry, and the manifest beside it, which task 50
  // reads for the hash and key and does not ship.
  {
    input: 'src/transform/write-manifest.ts',
    platform: 'node',
    output: { file: 'dist/write-transform-manifest.mjs', format: 'esm', codeSplitting: false },
  },
]);
