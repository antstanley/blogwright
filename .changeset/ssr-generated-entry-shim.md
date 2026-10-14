---
"blogwright": minor
"blogwright-core": minor
---

`ssr.shim` generates the SSR entry shim. Set `{ "host": "<VAR>", "port": "<VAR>" }` to the variables the framework's server reads its listen address from and point `ssr.entryPoint` at the framework's own server entry: the build adds `blogwright-entry.mjs` beside it, which copies the host and port from `AWS_LAMBDA_HTTP_ENDPOINT` into those variables before importing the entry, and the revision starts it. The build output is left untouched, and a hand-written shim keeps working without `shim`. The SSR examples now use it.
