# Change: Persist node outputs when create() fails partway

**Status:** Merged · **Merged:** 2026-07-22 · **Date:** 2026-07-22 · **Owner:** Ant Stanley · **Target:** packages/cli (graph engine)

State is only persisted after a node's `create()` returns, so a failure between a
remote mutation and that save orphans the resource outside the state file. This
change persists whatever outputs a node has recorded even when its `create()`
throws, and requires nodes to record identity outputs immediately after the
remote call that creates a resource — before any secondary mutation.

---

## Motivation

During the 2026-07-22 bootstrap of the blogwright docs environments, the
CloudFront distribution node created its distribution, recorded `id`/`arn`/
`domainName` in the in-memory state, and then threw on the follow-up
`TagResource` call (a separate client bug, since fixed). `applyGraph` saves
state only after a node completes ([`graph.ts:73`](../../packages/cli/src/graph.ts)),
so the distribution existed in AWS but not in `state/<env>.json`.

The consequences compounded: `destroy` could not delete the ACM certificate
(still attached to a distribution the state did not know about), and re-running
`bootstrap` could not adopt the orphan (see the companion change spec
[`2026-07-22-adopt_orphaned_resources_on_bootstrap.md`](2026-07-22-adopt_orphaned_resources_on_bootstrap.md)).
Recovery required manually editing the state file in S3. Any node whose
`create()` performs more than one remote call has this window today: the bucket
node (`CreateBucket` → `PutBucketTagging` → `PutPublicAccessBlock`), the
distribution node (`CreateDistribution` → `TagResource`), and the log-delivery
node (source → destination → delivery) among them.

---

## Affected spec pages

No canonical spec page covers the graph engine yet — the nearest documentation
is DEVELOPMENT.md's architecture notes. This change spec stands alone; if a
canonical `graph-engine` page exists by merge time, the blocks below fold into
its Lifecycle section.

| Canonical page | Nature of change |
|---|---|
| *(none — no canonical page for the reconciler yet)* | Behavioral contract change to `applyGraph` and the node-authoring rules |

---

## Proposed changes

### Graph engine → Failure handling (Add)

> `applyGraph` persists state after every node attempt, successful or not. When
> a node's `create()` (or `update()`) throws, the outputs it recorded before
> failing are saved before the error propagates. The failure-path save is
> best-effort: a save error is logged as a warning and never masks the original
> failure (the state bucket itself may be the thing that failed to create).

### Node-authoring rules → Identity outputs (Add)

> A node's `create()` records identity outputs (`id`, `arn`, names) into
> `output(ctx, …)` immediately after the remote call that creates the resource,
> before any secondary mutation such as tagging, alias attachment, or DNS. A
> crash after resource creation therefore always leaves enough state behind for
> `destroy` to delete the resource and for a re-run to adopt it. The ACM
> certificate node's explicit save after `RequestCertificate` is the existing
> precedent for the most expensive resources.

---

## Implementation notes

```
1. packages/cli/src/graph.ts:58-75 — wrap the create/update dispatch in
   try/catch: on throw, await ctx.save().catch(warn) then rethrow. The
   post-success save at :73 stays.
2. Audit multi-call create() implementations so identity outputs are recorded
   before secondary mutations:
   - bucketNode (packages/cli/src/nodes.ts:34-56) — set output name after
     CreateBucket, before tagging/PAB.
   - distributionNode (packages/cli/src/nodes.ts:567-604) — already correct
     (outputs set at :593-596 before TagResource); keep as the pattern.
   - logDeliveryNode (packages/cli/src/nodes.ts:646+) — record source/dest
     ARNs as they are created.
3. Tests (packages/cli/src/graph.test.ts / nodes.test.ts): a node whose
   create() sets an output then throws → state store contains the output after
   applyGraph rejects; a failing save on the failure path does not replace the
   node's error.
```

---

## Merge plan

1. If a canonical graph-engine page exists, apply the two blocks to its
   Failure-handling and Node-contract sections; otherwise record the contract in
   whichever canonical page first documents the reconciler.
2. Flip this file's **Status:** to `Merged`, add **Merged:** date, move to
   `.specs/changes/merged/`.
3. Update `.specs/README.md` (remove from pending change specs).

---

## Assumptions and open questions

**Assumptions**

- The state store (`state/<env>.json` in the environment bucket) remains the
  single source of truth; no secondary journal is introduced.
- Saving state mid-failure is safe: the state schema is additive here (extra
  outputs for a resource that exists is strictly better than none).

**Decisions**

- *Save-on-failure is best-effort.* **A failed save logs a warning and rethrows
  the original error.** The bucket node's own failure would otherwise be masked
  by the (inevitable) save failure that follows it.
- *Outputs before secondary mutations.* **Node contract, not engine magic.**
  The engine cannot know which call inside `create()` produced identity; the
  rule lives with the node author, enforced by review and tests.

**Open questions**

- Should `destroy` warn when it finds resources in AWS that match derived names
  but are absent from state (drift detection), rather than silently skipping
  them? Related but out of scope here.
