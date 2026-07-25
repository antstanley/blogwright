---
"blogwright": patch
"blogwright-core": patch
"blogwright-pds": patch
---

Ship smaller packages. The published tarballs no longer carry `.js.map` sourcemaps (`sourceMap` was set repo-wide in `tsconfig.base.json` and every emitted map was landing in `dist`), and `test-support.ts` — scaffolding imported only by `*.test.ts` — is now excluded from the build configs of `blogwright` and `blogwright-pds` rather than compiled into `dist`. It is still fully typechecked, since the `tsconfig.typecheck.json` files override `exclude` to `[]`.

Unpacked sizes drop by a quarter overall: `blogwright` 540.4 kB → 437.9 kB, `blogwright-core` 205.1 kB → 127.8 kB, `blogwright-pds` 99.9 kB → 58.9 kB, and the three packages together go from 183 files to 121. No runtime code changed.
