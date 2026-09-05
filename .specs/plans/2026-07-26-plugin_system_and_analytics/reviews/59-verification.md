# Task 59 combined verification — 2026-09-05

Reviewed revision 439f825bd596ec4b628fe581e45234cb177c3a9f against parent 437dcb18 in /private/tmp/blogwright-complete-59. The generated .orig file is absent on disk and absent from the final seven-file snapshot. Reviewer did not implement this task.

## Correctness premises
P1: The change modifies oidcRolePolicyStatements and the githubOidcRoleNode comment in cli/nodes.ts, the complete-policy tests in cli/nodes.test.ts, comments in core/config.ts and pds/nodes.ts, historical-grant comments/test title in pds/nodes.test.ts, the OIDC guide, and the removal changeset.
P2: Remove only the site's PDS permission statement while retaining the plugin's separately named grant and actionable migration instructions.
P3: Preserve unrelated site permissions, production/staging resource naming, preview exclusion, and post-deploy sync behavior.

## Function resolution
Production changed executable lines are deletion-only: removed statements.push resolves local statements (step1), the Array push builtin method; no new production calls exist. Remaining oidcRolePolicyStatements calls resolve logGroupArn/output at module scope (step3) and String at builtin scope (step5). applyOidcRole invokes that module-local function (step3), then ctx.clients.iam.putRolePolicy through the local ctx parameter (step1), whose real implementation core/aws/iam.ts:84 sends RoleName and PolicyName unchanged. Its PolicyName remains env-deploy. PDS applyPolicy resolves requireRoleName/policyDocument module-local (step3), recordGrant enclosing-function local (step1), and ctx.clients.iam.putRolePolicy through the local parameter (step1); POLICY_NAME remains blogwright-pds. Test it.each/expect resolve imported vitest (step4); oidcRolePolicyStatements resolves imported nodes.ts (step4), ctx and actionsOf resolve module definitions (step3); filter and startsWith resolve array/string builtin methods through local callback values (step1). No unresolved calls or behavior-changing shadowing.

## Execution trace and root cause
Configured production example with secret spelled-out/pds-key: before, site policy appended three Secrets Manager actions scoped to that name; after, configured and unconfigured inputs produce identical seven site statements, with no Secrets Manager actions. Site bootstrap updates production-deploy by name. The plugin's blogwright-pds policy remains a different named object on production-example-gh, retaining GetSecretValue/PutSecretValue/CreateSecret and the same secret ARN. Removing the branch addresses the ownership dependency itself.

## Regression traces
Site bootstrap -> applyGraph -> gh-oidc-role create/update -> applyOidcRole -> putRolePolicy(production-example-gh, production-deploy, site document): PRESERVED except intended removed grant. PDS bootstrap -> buildPdsNodes -> oidcPolicyNode create/update -> putRolePolicy(same role, blogwright-pds, secret document): PRESERVED. Config absent/githubRepo absent/preview env still return no PDS node. Staging retains a node and correct role name. PDS sync implementation is unchanged. Other touched units are documentation/test commentary with no production downstream behavior change.

## Edge cases
Never-migrated stacks lose PDS sync permission after their next site bootstrap: intended migration consequence, documented with environment-specific repair. Preview never gains the plugin grant. Explicit and derived secret names are tested. No unhandled edge cases identified within this task.

CORRECTNESS: CORRECT; confidence high.

## Independently collected completeness evidence
O1: nodes.ts contains no pds/atproto reference and imports only core plus CLI-local modules. Configured versus unconfigured complete policies compare equal for both preview flags and explicit/default secret names. Negative control restored exactly the removed branch from parent437dcb18: one failure (non-preview equality), 33 passes. Restored source byte-identically; SHA256 02a0b006161bf7b6dcf6be6cdbd6862c1eaca5f33c73223a209583e709ba15b4.
O2: CLI node slice34 passed; PDS nodes/plugin slice45 passed. PDS source changes are comments only; independent action/resource literal and preview/no-config/no-repo/staging cases passed. Named policy trace above establishes site updates cannot overwrite the plugin's policy.
O3: Re-read main review evidence, then independently fetched GitHub API beta.0 release (published2026-08-31T14:25:20Z), observed required pds bootstrap migration notice; fetched npm blogwright-pds0.4.0-beta.2 metadata and tarball, inspected package/dist/nodes.js: exact POLICY_NAME blogwright-pds and all three actions present. Current parent is beta.3 and removal changeset is new; it explicitly requires later publication and same-release coupling with60. Changeset explains complete site-policy rewrite and bootstrap <env> repair. No release performed.
O4: Both specs remain Proposed at original pending paths. Workspace .specs/README.md lines47/59 and source closing decisions assign merge to63. No spec files moved in diff.
O5: Independent pnpm build0; pnpm typecheck0 (Svelte0 errors/0 warnings); TZ=America/New_York pnpm test0 (1533 passed,1 opt-in skipped); pnpm lint0; pnpm exec oxfmt --check .0; pnpm knip0. First sandboxed test attempt failed solely on localhost socket restrictions; approved unrestricted exact-command rerun passed. Negative control above independently executed and restored. Logs /tmp/verify59-{build,types,test-unrestricted,lint,format,knip,negative}.log.
O6: Independently ran exact CLI nodes verbose and PDS nodes/plugin verbose slices (34+45 passed); read complete site policy and publication evidence; pds|atproto absence search returned no matches. Logs /tmp/verify59-{cli-nodes,pds-nodes}.log.

COMPLETENESS: DONE; confidence high. All six obligations satisfied and both regression surfaces preserved. This is static/test proof plus published prerequisite verification, not a live AWS execution.
