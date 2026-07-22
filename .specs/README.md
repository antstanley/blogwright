# Specs

The spec home for blogwright. Development guidelines currently live at the repo root
in [DEVELOPMENT.md](../DEVELOPMENT.md) (see its Decisions block for why); if a full
spec set is created here later, that page moves to `development-guidelines.md`.

## Plans

- [Hexagonal ports adoption](plans/2026-07-11-hexagonal_ports_adoption/plan.md) —
  move the remaining direct side effects (fs, child_process, fetch, terminal) behind
  ports per DEVELOPMENT.md §Hexagonal architecture, then extract the standard.site
  integration into a `blogwright-pds` feature package; eight tasks, four milestones.

## Change specs

Pending proposals live under [`changes/`](changes/); merged history under
[`changes/merged/`](changes/merged/). None pending. Merged:

- [Persist node outputs when create() fails partway](changes/merged/2026-07-22-persist_partial_bootstrap_state.md)
  (merged 2026-07-22) — state saves on the failure path; identity outputs are
  recorded before secondary mutations.
- [Adopt orphaned resources when re-bootstrapping a partial environment](changes/merged/2026-07-22-adopt_orphaned_resources_on_bootstrap.md)
  (merged 2026-07-22) — distribution adoption on `CNAMEAlreadyExists` (verified by
  CallerReference) and bucket config reconcile on every apply.
