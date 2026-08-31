---
"blogwright-core": minor
"blogwright-pds": minor
---

`Names` gains `githubRole` (`<env>-<siteName>-gh`), so the GitHub Actions OIDC deploy role's name is derived in `deriveNames` alongside every other AWS name instead of privately inside the CLI's own role node. The derived value is byte-identical to what the CLI derived before, so no deployed role is renamed; a test pins it.

`blogwright-pds` gains a resource node that attaches its own `blogwright-pds`-named inline policy to that role, granting `secretsmanager:GetSecretValue`, `PutSecretValue` and `CreateSecret` scoped to the plugin's own secret ARN - byte for byte the statement the site's `<env>-deploy` policy carries on a non-preview stack today, now owned by the plugin that needs it. Because IAM inline policies are named, the two documents are independent objects on the same role: creating and deleting the plugin's grant never reads or writes the site's, and both are live at once. The site's own statement is unchanged and stays until a later release, so nothing is lost on upgrade. The node is not reachable from the CLI yet - the plugin export that returns it lands separately.

The node is skipped, not failed, for a site with no `pds` block, for a site with no `githubRepo` (which has no deploy role at all), and for the shared preview stack. The preview skip mirrors the site's own graph, which withholds this same statement there: the preview role's OIDC trust accepts any ref of the repo where production is release-gated, and the PDS secret is one credential shared by every environment. `staging` is unaffected and still gets the grant.
