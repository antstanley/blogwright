---
'blogwright-analytics': patch
---

Retry `CreateFunction` while IAM has not finished propagating the transform role

`blogwright analytics bootstrap` failed on a fresh environment at the tenth of twelve nodes:

```
× lambda: Http400 - createFunction "<env>-<site>-analytics-transform":
  The role defined for the function cannot be assumed by Lambda. (HTTP 400)
```

IAM is eventually consistent, and this graph creates the transform role in the node immediately before the one that uses it — the tightest possible window. AWS refuses a `CreateFunction` naming a role it has not finished propagating, and the same request succeeds seconds later with nothing changed.

Both `CreateFunction` and `UpdateFunctionConfiguration` now retry with exponential backoff while that specific failure is what came back. `UpdateFunctionConfiguration` is included because it sends `roleArn` too, so an environment whose role was torn down and recreated hits the identical window on the update path.

The retry predicate is deliberately narrow — this message, at HTTP 400, on this service — rather than "retry 400s". Almost every other 400 Lambda returns is permanent (a malformed zip, a bad handler path, a role that genuinely lacks the trust policy), and retrying those would turn a clear failure into a slow one.

A bootstrap interrupted by this needed no cleanup: the graph persists state on the failure path, so re-running resumed at the Lambda and skipped the nine resources already created.
