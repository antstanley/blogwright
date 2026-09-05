---
"blogwright": minor
---

The site's `<env>-deploy` inline policy no longer grants Secrets Manager access for standard.site publishing. The PDS plugin owns that grant in its separately named `blogwright-pds` inline policy on the same deploy role. S3, MicroVM, log-read, `iam:PassRole`, CloudFront invalidation, resource names, and preview permissions are unchanged.

**Release prerequisite and coupling:** the additive PDS migration must already have been independently published, including `blogwright pds bootstrap` and its migration notice. The v0.4.0-beta.0 release notice announced that migration, and the published blogwright-pds@0.4.0-beta.2 tarball contains the named policy; v0.4.0-beta.3 is the current published baseline. This removal ships in a later release, together with task 60 (warning after successful site bootstrap while scoped plugin state exists), never in the migration release itself. Both pending change specs remain pending at their existing paths; task 63 owns their final documentation and spec closure.

**Before the next site bootstrap, run `blogwright pds bootstrap <env>` for every configured non-preview environment**, for example `blogwright pds bootstrap production` before `blogwright bootstrap production`. Ensure `blogwright-pds` is installed in the site's own dependencies.

Every `blogwright bootstrap <env>` rewrites the entire `<env>-deploy` policy document on both create and update. After upgrading, the old secret statement therefore survives only until that environment's next site bootstrap. The separately named plugin policy survives this rewrite.

If you miss the migration step, the site still builds and deploys, but its post-deploy PDS sync cannot read the OAuth secret and warns `pds sync failed (deploy unaffected): <error>`. Repair the affected environment with `blogwright pds bootstrap <env>`; the next deploy can sync again. No secret is deleted and no credentials need rotating.

The plugin grants the same three actions — `secretsmanager:GetSecretValue`, `secretsmanager:PutSecretValue`, and `secretsmanager:CreateSecret` — on `arn:aws:secretsmanager:<region>:<account>:secret:<secretName>-*`, with `<siteName>/atproto` still the default secret name. Preview receives no secret grant because its OIDC subject accepts any ref and the secret is shared across environments.
