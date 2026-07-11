import { defineConfig } from 'rolldown';

// Bundle the build-agent server into a single ESM file with no external deps: the
// MicroVM image (see Dockerfile) ships only server.js, so blogwright-core, fflate,
// and the AWS SDK/smithy packages it pulls in must all be inlined here.
//
// platform: 'node' keeps node: builtins external and auto-polyfills any require() the
// bundled CJS dependencies still use — the ESM-native replacement for the createRequire
// banner the previous esbuild build injected by hand.
export default defineConfig([
  {
    input: 'src/server.ts',
    platform: 'node',
    output: {
      file: 'dist/server.js',
      format: 'esm',
      // The AWS SDK pulls in dynamic import()s; inline them so the whole agent stays a
      // single self-contained file (the image copies only server.js — see Dockerfile).
      codeSplitting: false,
    },
  },
  // Build-time helper that stamps dist/agent-manifest.json with the source hash
  // (run by the package's build script after bundling).
  {
    input: 'src/write-manifest.ts',
    platform: 'node',
    output: { file: 'dist/write-manifest.js', format: 'esm', codeSplitting: false },
  },
]);
