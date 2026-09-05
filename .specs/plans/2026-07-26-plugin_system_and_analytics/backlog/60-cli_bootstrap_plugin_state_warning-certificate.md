# Done Certificate — Task 60: Warn after site bootstrap while scoped plugin state exists

**Task:** [60-cli_bootstrap_plugin_state_warning.md](60-cli_bootstrap_plugin_state_warning.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-09-05 — unverified

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
- Status: ☐ unverified

### O2

- Claim: The single existing matcher serves both bootstrap and destroy, with no object-content reads, plugin imports/discovery/config knowledge or prompts, including plain sessions and uninstalled plugins.
- Evidence to collect: Inspect imports and resolve the shared parser and listing definitions; run real discovery-laziness fixtures that contain discoverable manifests and plain/noninteractive tests.
- Status: ☐ unverified

### O3

- Claim: A failed reconcile makes no added listing/warning. A failed post-reconcile listing warns with error context without failing bootstrap; destroy retains its existing error propagation and NoSuchBucket handling.
- Evidence to collect: Run failed-reconcile and failed-listing bootstrap cases plus all destroy guard errors. Trace each catch to ensure bootstrap-only warn-and-continue, destroy unchanged.
- Status: ☐ unverified

### O4

- Claim: Code and changeset state that a never-bootstrapped plugin has no scoped key and produces no per-plugin warning. The warning ships in the same release as task59 (never later); pending specs remain pending until task63.
- Evidence to collect: Read comment, changeset, task59 changeset, and both spec headers. Confirm release-order sentence rejects warning-after-removal, not removal-after-warning.
- Status: ☐ unverified

### O5

- Claim: Meets the repo definition of done: `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip`; user-facing behavior has a changeset, and new assertions are demonstrated failing before the fix or under a reverted mutation.
- Evidence to collect: Run six gates and record exits/counts plus changeset and mutation evidence.
- Status: ☐ unverified

### O6

- Claim: Reviewable: run `pnpm --filter blogwright exec vitest run commands cli plugin-commands --reporter=verbose`; observe current-environment warnings, unchanged empty-state output and unchanged destroy refusal/laziness behavior.
- Evidence to collect: Execute the named slice and record its concrete outputs/expectations, especially staging remedy and no-key comparison.
- Status: ☐ unverified

## Regression check

- destroy and previewTeardown still refuse on scoped state and fail closed on ambiguous listing errors. — ☐ (PRESERVED / REGRESSION)
- deploy/status/bootstrap remain lazy for plugin discovery; site reconcile errors still propagate. — ☐ (PRESERVED / REGRESSION)

## Conclusion

NOT_DONE if any obligation is UNSATISFIED or a regression exists; PARTIAL if any is UNVERIFIED and none fails; DONE only if all are SATISFIED and regressions are PRESERVED.

VERDICT: ☐
CONFIDENCE: ☐
SUMMARY: ☐
