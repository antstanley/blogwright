---
'blogwright-analytics': patch
'blogwright-core': minor
'blogwright': patch
---

Fix `bootstrap`, `deploy` and `analytics bootstrap` throwing `date not in range 1980-2099` outside UTC

Every zip this CLI builds stamped its entries with `new Date('1980-01-01T00:00:00Z')`. A zip's DOS timestamp is **local** time, so west of Greenwich that value is 1979 and `fflate` refuses it outright. `blogwright bootstrap`, `blogwright deploy` and `blogwright analytics bootstrap` therefore failed for operators across most of the Americas, on the first command a new user runs.

The crash was also hiding a second defect: in zones where it did not throw, the encoded timestamp still varied, so identical input produced different archive bytes — the exact opposite of the reproducibility the fixed timestamp exists to provide.

`blogwright-core` now exports `REPRODUCIBLE_ZIP_MTIME`, a locally-constructed 1980-01-02 that is in range and byte-identical in every zone, and the three sites that hand-rolled the old value use it: `packages/cli/src/repo.ts`, `packages/cli/src/agent-package.ts` and the analytics transform bundle.

Nothing about the archives changes for anyone already on UTC except the stamped date.

The coverage was never missing — seven analytics tests already drove the failing path. CI ran `TZ=UTC`, the one setting where the bug is invisible, so the test job now runs in a negative-offset zone instead.
