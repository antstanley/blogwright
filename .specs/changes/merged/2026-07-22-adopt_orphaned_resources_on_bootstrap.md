# Change: Adopt orphaned resources when re-bootstrapping a partial environment

**Status:** Merged · **Merged:** 2026-07-22 · **Date:** 2026-07-22 · **Owner:** Ant Stanley · **Target:** packages/cli (resource nodes) + packages/core (CloudFront client)

Re-running `bootstrap` against a partially bootstrapped environment dead-ends
when a resource exists in AWS but not in state: `CreateDistribution` fails with
`CNAMEAlreadyExists` before CloudFront's `CallerReference` idempotency applies,
and multi-step nodes skip their configuration steps entirely once the primary
resource exists. This change makes every node's create path either adopt the
existing resource or fail with an actionable pointer — never a dead end that
requires manual state surgery.

---

## Motivation

During the 2026-07-22 bootstrap of the blogwright docs environments, a client
bug failed the distribution node after `CreateDistribution` succeeded, leaving
distributions in AWS that the state file did not record. Re-running `bootstrap`
could not recover: the distribution node's `read()` keys off the state output,
found nothing, called `CreateDistribution` again, and CloudFront rejected the
duplicate alias with `CNAMEAlreadyExists` (HTTP 409) — its alias-conflict check
fires before the `CallerReference` idempotency match that would otherwise have
returned the existing distribution. The only way forward was hand-editing
`state/<env>.json` in S3.

A second, quieter variant hit the bucket node: the first (failed) run created
the raw bucket but died before `PutBucketTagging`/`PutPublicAccessBlock`; every
later run's `read()` saw the bucket exists and skipped `create()` entirely, so
the bucket stayed untagged until patched by hand. The companion change spec
[`2026-07-22-persist_partial_bootstrap_state.md`](2026-07-22-persist_partial_bootstrap_state.md)
narrows the window that creates these orphans; this change makes recovery
automatic when they exist anyway.

---

## Affected spec pages

No canonical spec page covers the resource nodes yet — the nearest
documentation is DEVELOPMENT.md's architecture notes. This change spec stands
alone; if a canonical node-catalogue page exists by merge time, the blocks below
fold into the relevant node sections.

| Canonical page | Nature of change |
|---|---|
| *(none — no canonical page for the resource nodes yet)* | Behavioral change to the distribution and bucket nodes; new `listDistributions` client method in blogwright-core |

---

## Proposed changes

### Resource nodes → CloudFront distribution (Add)

> When `CreateDistribution` fails with `CNAMEAlreadyExists` or
> `DistributionAlreadyExists`, the node adopts the existing distribution instead
> of failing: it lists distributions, selects candidates whose comment equals
> the deterministic `"<siteName> <env>"`, and confirms identity by fetching each
> candidate's config and comparing `CallerReference` against the node's own
> deterministic reference (`<env>-<siteName>-<accountId>`). On a match it
> records `id`/`arn`/`domainName`, applies tags, and continues; with no match
> the original error propagates — an alias conflict with a foreign distribution
> is real and must surface.

### Resource nodes → S3 bucket (Add)

> The bucket node reconciles configuration on every apply, not only at
> creation: an `update()` re-applies bucket tagging and the public-access block
> (both idempotent PUTs) whenever the bucket already exists. A bucket created by
> a crashed earlier run therefore converges to the configured shape on the next
> bootstrap instead of silently keeping whatever the crash left behind.

### Node-authoring rules → Adopt-or-fail (Add)

> A node's `create()` never dead-ends on a resource that already exists with
> this environment's derived identity. For name-keyed resources (roles, log
> groups, images, functions) the existing already-exists tolerance plus
> reconcile-on-update satisfies this; for resources with service-generated ids
> (the distribution) the node carries an explicit adoption path. Where adoption
> is impossible, the error message names the conflicting resource and the
> manual step required.

---

## Type changes

None — no state-file or config entities change shape. Adoption writes the same
`id`/`arn`/`domainName` outputs the create path writes.

---

## Implementation notes

```
1. packages/core/src/aws/cloudfront.ts — add listDistributions(): GET
   /2020-05-31/distribution (paginated, Marker/NextMarker), returning
   {id, arn, domainName, comment} per item. getDistributionConfig (:134)
   already returns the raw XML; CallerReference is extractable with textTag.
2. packages/cli/src/nodes.ts:567-604 (distributionNode.create) — catch
   AwsError codes CNAMEAlreadyExists / DistributionAlreadyExists, run the
   adoption lookup, verify CallerReference === `${ctx.names.prefix}-${ctx.accountId}`
   (the value passed at :569), then fall through to the existing
   output-recording + tagResource path.
3. packages/cli/src/nodes.ts:34-56 (bucketNode) — add update() applying
   putBucketTagging + putPublicAccessBlock; create() keeps its current calls.
4. Tests (packages/cli/src/nodes.test.ts): CNAMEAlreadyExists with a matching
   CallerReference → adopted, outputs recorded, tags applied; with a
   non-matching CallerReference → original error rethrown; bucket update()
   re-applies tagging + PAB.
```

---

## Merge plan

1. If a canonical node-catalogue page exists, apply the three blocks to the
   distribution, bucket, and node-contract sections; otherwise record them in
   whichever canonical page first documents the resource nodes.
2. Flip this file's **Status:** to `Merged`, add **Merged:** date, move to
   `.specs/changes/merged/`.
3. Update `.specs/README.md` (remove from pending change specs).

---

## Assumptions and open questions

**Assumptions**

- The distribution comment (`"<siteName> <env>"`) and `CallerReference`
  (`<env>-<siteName>-<accountId>`) remain deterministic — they are the adoption
  identity. Changing either derivation invalidates adoption of resources
  created before the change.
- `ListDistributions` visibility is immediate enough after a crashed run;
  CloudFront list consistency has not been a problem in practice.

**Decisions**

- *Verify by CallerReference, not comment alone.* **Comment narrows, reference
  confirms.** Comments are human-editable in the console; CallerReference is
  immutable for the life of the distribution and collision-free across
  environments by construction.
- *No blanket adopt-by-name for every node type.* **Only the distribution gets
  an explicit adoption path now.** Name-keyed resources already tolerate
  already-exists and reconcile via update(); adding speculative adoption
  everywhere adds surface without a demonstrated failure.

**Open questions**

- Should `preview bootstrap`/`bootstrap` end with a drift summary (resources
  matching derived names but absent from state) so operators see orphans even
  when adoption is impossible?
- The MicroVM image node keys its idempotency clientToken by image name + agent
  hash (fixed 2026-07-22); does the microvms service expose enough listing to
  adopt an image created by a crashed run before its state save? (Today the
  name-keyed getImage reconcile covers it.)
