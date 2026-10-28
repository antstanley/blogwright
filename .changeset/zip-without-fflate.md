---
'blogwright': patch
'blogwright-core': patch
'blogwright-pds': patch
'blogwright-analytics': patch
---

Build the source, build-agent and Lambda zips with Node's own `zlib` instead of the `fflate` package, which takes about 0.8 MB off the CLI and the analytics plugin. The archives stay deterministic, and identical input still produces identical bytes in every timezone. Node.js 22.2 or later is now required (it was 22.0), for `zlib.crc32`.
