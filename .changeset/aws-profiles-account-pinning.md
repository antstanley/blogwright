---
'blogwright': minor
'blogwright-core': minor
'blogwright-analytics': minor
---

Choose AWS credentials with `--profile`, `AWS_PROFILE` or a new `aws.profile` config key (exported environment credentials beat the config's profile, so CI is unaffected), and pin an environment to one account with `aws.accountId`. Every command now checks `sts:GetCallerIdentity` before loading state, prints one identity line, refuses credentials for any other pinned account, and offers `aws sso login` or `aws login` when a sign-in has expired. Adds `blogwright whoami`, and `blogwright init` now asks for a profile and offers to detect and pin the account. The analytics plugin's DuckDB credentials come from the same profile.
