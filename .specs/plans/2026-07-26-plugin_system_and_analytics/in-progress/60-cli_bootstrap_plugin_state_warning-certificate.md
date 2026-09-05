# Done Certificate — Task 60: Warn after site bootstrap while scoped plugin state exists

**Task:** [60-cli_bootstrap_plugin_state_warning.md](60-cli_bootstrap_plugin_state_warning.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-09-05

## Definition

DONE(Task 60) means every obligation O1–O6 is satisfied with recorded evidence.

## Premises

- P1: Successful site bootstrap warns once per discovered scoped state key with a command for the same environment, without loading plugins.
- P2: One obligation per DoD item, in order; O6 is Reviewable.
- P3: Preserve the downstream behavior listed under Regression check; use the current integrated base, never an old passing verdict.

## Obligations

### O1

- Claim: After successful reconcile, exactly one listObjects call on state/ yields one warning per unique scope of the current environment; no-key output is unchanged. Each remedy names that environment.
- Evidence to collect: Run recording S3/logger tests with production and staging state keys and duplicate scope keys. Trace ordering after applyGraph; temporarily remove listing/warning or env interpolation and observe named failure.
- Status: SATISFIED
- Collected evidence: Recording tests prove reconcile/save/list order, exactly one listing, duplicate removal, other-env exclusion, unchanged no-key output and bootstrap staging remedy. Independent warning-call removal causes5 failures; restored exact hash91c3e6a3dab2364c81c5d680296dffb76620dacbbe4d4792827e36b241c30e1f.

### O2

- Claim: The single existing matcher serves both bootstrap and destroy, with no object-content reads, plugin imports/discovery/config knowledge or prompts, including plain sessions and uninstalled plugins.
- Evidence to collect: Inspect imports and resolve the shared parser and listing definitions; run real discovery-laziness fixtures that contain discoverable manifests and plain/noninteractive tests.
- Status: SATISFIED
- Collected evidence: Shared listScopedStateScopes resolves existing scopedStateScopes unchanged; both bootstrap/destroy call it. No new plugin import/discovery/config/object-read/prompt path. Manifest-backed discovery laziness plus plain/uninstalled fixtures pass.

### O3

- Claim: A failed reconcile makes no added listing/warning. A failed post-reconcile listing warns with error context without failing bootstrap; destroy retains its existing error propagation and NoSuchBucket handling.
- Evidence to collect: Run failed-reconcile and failed-listing bootstrap cases plus all destroy guard errors. Trace each catch to ensure bootstrap-only warn-and-continue, destroy unchanged.
- Status: SATISFIED
- Collected evidence: Failed-reconcile test proves no added listing/warning; AccessDenied and NoSuchBucket post-reconcile diagnostics preserve successful result. Existing teardown AccessDenied/NoSuchKey propagation and NoSuchBucket recovery tests pass.

### O4

- Claim: Code and changeset state that a never-bootstrapped plugin has no scoped key and produces no per-plugin warning. The warning ships in the same release as task59 (never later); pending specs remain pending until task63.
- Evidence to collect: Read comment, changeset, task59 changeset, and both spec headers. Confirm release-order sentence rejects warning-after-removal, not removal-after-warning.
- Status: SATISFIED
- Collected evidence: Code comment and new changeset document never-bootstrapped absence. Both changesets explicitly require same release with59, never warning later. Both pending source headers remain Proposed; closure remains63.

### O5

- Claim: Meets the repo definition of done: `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip`; user-facing behavior has a changeset, and new assertions are demonstrated failing before the fix or under a reverted mutation.
- Evidence to collect: Run six gates and record exits/counts plus changeset and mutation evidence.
- Status: SATISFIED
- Collected evidence: Independently ran all six commands with pinned Node24.19/pnpm11.21: all exit0; NY suite1539 passed/1 skipped. Negative control5 failed/98 passed and exact restoration. Logs /tmp/verify60-{build,types,test,lint,format,knip,negative}.log.

### O6

- Claim: Reviewable: run `pnpm --filter blogwright exec vitest run commands cli plugin-commands --reporter=verbose`; observe current-environment warnings, unchanged empty-state output and unchanged destroy refusal/laziness behavior.
- Evidence to collect: Execute the named slice and record its concrete outputs/expectations, especially staging remedy and no-key comparison.
- Status: SATISFIED
- Collected evidence: Exact requested commands/cli/plugin-commands verbose slice:3 files/148 tests passed. Staging remedy, unchanged no-key output, destroy error/refusal and manifest-backed discovery laziness cases inspected. Log /tmp/verify60-focused.log.

## Regression check

- destroy and previewTeardown still refuse on scoped state and fail closed on ambiguous listing errors. — PRESERVED
- deploy/status/bootstrap remain lazy for plugin discovery; site reconcile errors still propagate. — PRESERVED

## Conclusion

NOT_DONE if any obligation is UNSATISFIED or a regression exists; PARTIAL if any is UNVERIFIED and none fails; DONE only if all are SATISFIED and regressions are PRESERVED.

VERDICT: DONE
CONFIDENCE: high
SUMMARY: O1–O6 independently satisfied on exact commit55c2f0f5 with all four live files equal; six gates and148 focused tests pass, negative control fails and restores byte-identically, regression surfaces preserved. Report /tmp/verify60-review.md.
