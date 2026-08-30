# Task 49 - The account-scoped Glue catalog integration node

**Plan:** [plan.md](../plan.md) · **Certificate:** [49-nodes_catalog_integration-certificate.md](49-nodes_catalog_integration-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics pipeline → Resource nodes (Add)](../../../changes/2026-07-26-analytics_plugin.md) (the `analytics-catalog-integration` row, and the paragraph stating the integration is account-and-region scoped, that its `read()` treats an existing integration as satisfied and its `delete()` is a no-op)
**Depends on:** 48
**Produces:** `analytics-catalog-integration` in `packages/analytics/src/nodes.ts` - the one node in the graph that adopts shared account-scoped state rather than owning it, so a second environment never re-creates it and a teardown never removes it
**Pointers:** `packages/analytics/src/nodes.ts` (task 48 - the node module this appends to, and the `output` helper it reuses), `packages/analytics/src/nodes.test.ts` (task 48 - the transport-mocked suite this extends), `packages/analytics/src/aws/glue.ts` (task 35 - the catalog federation create and lookup), `packages/core/src/aws/iam.ts:112-125` (`ensureOidcProvider` - the existing "account-global; never deleted here" precedent, comment included), `packages/cli/src/nodes.ts:937` (its only call site, inside `githubOidcRoleNode`, whose `delete` likewise never removes the provider), `packages/cli/src/nodes.ts:809-812` (`bucketPolicyNode.delete` - the existing empty-delete-with-a-reason shape), `packages/cli/src/graph.ts:89-99` (`destroyGraph` - every node's `delete` runs on teardown, which is why this one must be inert), [the spec paragraph stating the scoping rule](../../../changes/2026-07-26-analytics_plugin.md) (§Analytics pipeline → Resource nodes, the `analytics-catalog-integration` paragraph)

> **ROUTED FINDING - added 2026-08-30 from task 35's verification gate.**
> `EntityNotFoundException` carries an unmodelled `FromFederationSource` flag,
> and the exception is documented on BOTH of that client's operations meaning
> different things. On `getCatalogFederation` it is "no such catalog"; but a
> **source-level** miss - the S3 Tables bucket the catalog would federate does
> not exist, typically a wrong ARN - also surfaces as `EntityNotFoundException`
> and so reads as "catalog absent". This node then calls create, which swallows
> `FederatedResourceAlreadyExistsException`, and the whole reconcile converges
> silently on a federation that was never actually wired to a bucket.
> Task 35 correctly did not handle this: its contract says narrow on
> `isNotFound`, and the flag is not in the service model. It lands here because
> this node is what decides "adopt or create". Decide explicitly: either verify
> the federation's `sourceIdentifier` matches the configured table bucket ARN
> after an adopt, or let a source-level miss fail loudly instead of converging.
> Note `CatalogFederation` already carries `sourceIdentifier` as a required key
> of type `string | undefined` precisely so a same-named but non-federated or
> wrongly-federated catalog is distinguishable - use it rather than treating a
> successful lookup as sufficient.

## Steps

- [ ] Write `analytics-catalog-integration` with `dependsOn: ['analytics-table']`, creating the Glue `s3tablescatalog` federation that Firehose reads the table through, via the plugin bundle's `glue` client.
- [ ] Implement `read` as adoption: an integration that already exists - created by this environment or another - satisfies the node and is recorded into the plugin's scoped state, so `create` never runs a second time.
- [ ] Implement `delete` as a no-op, with a comment stating why: the federation is account-and-region scoped shared state, and deleting it during one environment's teardown would break every other environment's pipeline.
- [ ] Write the node's `title` and its create log line to say the integration is account-and-region scoped, so an operator reading `analytics bootstrap` output can tell it is shared rather than per-environment.
- [ ] Extend `packages/analytics/src/nodes.test.ts`: an absent integration creates one; an existing integration is adopted with no create call; a second-environment context over the same account observes no create; and a destroy over the whole node set issues no Glue call at all.

## Definition of done

- [ ] `analytics-catalog-integration` depends on `analytics-table` and creates the Glue `s3tablescatalog` federation that Firehose reads the table through, reaching AWS only through the plugin bundle's `glue` client.
- [ ] `read()` treats an already-existing integration as satisfied (adopt, not create) and `delete()` is a no-op - both asserted directly, plus a test asserting a destroy over the node set issues no Glue call at all.
- [ ] A second-environment test asserts convergence: with the integration already present, `create` is never invoked, so two environments never fight over it and tearing one down never breaks the other.
- [ ] The node's `title` and its create log line state that the integration is account-and-region scoped, so `analytics bootstrap` output shows it is shared rather than per-environment, and a comment on the node explains why `delete` is a no-op (shared account-scoped state) rather than paraphrasing the code.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose` inside `packages/analytics`; confirm the destroy case asserts an empty Glue call log rather than an absent error, and read the node's `delete` body to confirm the comment states the consequence for the other environment.
