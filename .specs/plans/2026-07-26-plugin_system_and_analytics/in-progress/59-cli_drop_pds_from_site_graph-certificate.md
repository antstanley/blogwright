# Done Certificate — Task 59: Remove the pds branch from the site OIDC policy

**Task:** [59-cli_drop_pds_from_site_graph.md](59-cli_drop_pds_from_site_graph.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-09-05

## Definition

DONE(Task 59) means every obligation O1–O6 is satisfied with recorded evidence.

## Premises

- P1: The site graph has no PDS-specific permission statement; the plugin retains its separately named grant.
- P2: One obligation per DoD item, in order; O6 is Reviewable.
- P3: Preserve the downstream behavior listed under Regression check; use the current integrated base, never an old passing verdict.

## Obligations

### O1

- Claim: The site nodes module contains no pds/atproto reference or plugin import; a configured PDS site produces exactly the same site-policy statements as one without PDS.
- Evidence to collect: Inspect the adapted nodes diff and run the configured-vs-unconfigured policy test. Reintroduce the removed branch temporarily and observe that test fail; restore byte-identically.
- Status: SATISFIED
- Collected evidence: Complete configured/unconfigured policy tests pass for preview and non-preview, explicit/default secret names. Exact parent branch reintroduction fails non-preview equality (1 failed/33 passed); restored byte-identically SHA256 02a0b006161bf7b6dcf6be6cdbd6862c1eaca5f33c73223a209583e709ba15b4. No pds/atproto in site nodes.

### O2

- Claim: PDS still owns the blogwright-pds inline policy with the same three secret actions and ARN; its no-config/no-githubRepo/preview skips remain intact, and unrelated site policies and names are unchanged.
- Evidence to collect: Run `pnpm --filter blogwright-pds exec vitest run nodes plugin --reporter=verbose`; compare named policy actions/ARN and preview skip before/after. Trace putRolePolicy by PolicyName and site role update.
- Status: SATISFIED
- Collected evidence: Independent PDS nodes/plugin slice:45 passed; unchanged plugin executable source retains named blogwright-pds policy, three actions, ARN resolution and all skip conditions. Site putRolePolicy names env-deploy; plugin names blogwright-pds.

### O3

- Claim: The published migration release is evidenced by registry metadata, the published PDS node and the release notice. The removal ships later, with task 60; the changeset explains the wholesale site-policy rewrite and environment-specific repair command.
- Evidence to collect: Read reviews/2026-09-05-plan-review.md publication evidence, compare public release notice and registry package presence; inspect changeset and diff versus base for separate release and task60 coupling.
- Status: SATISFIED
- Collected evidence: Independently fetched beta.0 GitHub release notice (published2026-08-31T14:25:20Z), beta.2 npm metadata/tarball, and package/dist/nodes.js with named policy and three actions. New removal changeset against beta.3 requires later release, coupling60 and per-env repair.

### O4

- Claim: The two pending change specs remain at their current paths with their pending status and closure explicitly assigned to task 63.
- Evidence to collect: Read both spec headers and .specs/README.md; assert no premature move, and task63 owns closure.
- Status: SATISFIED
- Collected evidence: Both pending specs remain Proposed in original paths; README and source closing decisions assign closure63; no premature spec move in seven-file diff.

### O5

- Claim: Meets the repo definition of done: `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip`; user-facing behavior has a changeset, and new assertions are demonstrated failing before the fix or under a reverted mutation.
- Evidence to collect: Run all six named commands and record exits/counts; inspect changeset and failing-test evidence.
- Status: SATISFIED
- Collected evidence: All six commands independently passed. NY full suite1533 passed/1 skipped; Svelte0 errors/0 warnings. Initial sandbox socket restriction resolved by approved unrestricted exact-command rerun. Build/types/lint/format/knip exit0. Negative control independently failed then restored. Logs /tmp/verify59-*.log.

### O6

- Claim: Reviewable: run `pnpm --filter blogwright exec vitest run nodes --reporter=verbose` and the PDS node tests; inspect the complete policy comparison, current release evidence, and `rg -n "pds|atproto" packages/cli/src/nodes.ts` returning no matches.
- Evidence to collect: Execute both named test slices, inspect entire resulting policy and run the absence search; record concrete output.
- Status: SATISFIED
- Collected evidence: Exact CLI nodes verbose slice34 passed and PDS nodes/plugin verbose slice45 passed. Complete policy/publication inspected; pds|atproto site-node search has zero matches.

## Regression check

- Site bootstrap updates its own policy while the separately named PDS policy persists. — PRESERVED
- PDS post-deploy sync and preview privilege boundary remain unchanged. — PRESERVED

## Conclusion

NOT_DONE if any obligation is UNSATISFIED or a regression exists; PARTIAL if any is UNVERIFIED and none fails; DONE only if all are SATISFIED and regressions are PRESERVED.

VERDICT: DONE
CONFIDENCE: high
SUMMARY: All six obligations independently satisfied on revision439f825b; named policy separation and preview/post-deploy behavior preserved. Correctness report and execution evidence: /tmp/verify59-report.md; persistent validation summary is recorded above.
