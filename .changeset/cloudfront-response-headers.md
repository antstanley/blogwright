---
'blogwright': minor
'blogwright-core': minor
---

Add a `headers` config key for CloudFront response headers - `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and custom headers such as `Permissions-Policy` or `Cross-Origin-Opener-Policy`. blogwright manages one response headers policy per environment (`<env>-<siteName>-headers`) and attaches it to every cache behavior of the existing distribution, so no new distribution is needed. `bootstrap` creates, updates, attaches and - when the key is removed - detaches and deletes it; `deploy` keeps the policy's headers in step with the config, and the GitHub OIDC deploy role may update that one policy. The SSR distribution reconcile now compares each behavior's response headers policy, so a policy is no longer silently dropped when another field forces the behavior to be rewritten.

Hand-attached policies:

- **SSR sites: upgrade note.** Each `bootstrap` now reconciles every cache behavior's response headers policy. A policy attached by hand in the CloudFront console is therefore removed on the first `bootstrap` after upgrading, even without `headers` set. Copy its headers into `headers` first.
- **Static sites:** while `headers` is set, `bootstrap` refuses to replace a policy attached by hand; the error names it.

Config checks:

- The adjustable CloudFront quotas, 10 custom headers and 1,783 characters of `Content-Security-Policy` by default, are left to CloudFront, with an error that names the quota.
- Custom header values may be empty.

Not yet verified against a live distribution: see "What has not been verified against AWS" in the configuration reference.
