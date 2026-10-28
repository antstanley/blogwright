---
'blogwright': minor
'blogwright-core': minor
---

Add a `headers` config key for CloudFront response headers - `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and custom headers such as `Permissions-Policy` or `Cross-Origin-Opener-Policy`. blogwright manages one response headers policy per environment (`<env>-<siteName>-headers`) and attaches it to every cache behavior of the existing distribution, so no new distribution is needed. `bootstrap` creates, updates, attaches and - when the key is removed - detaches and deletes it; `deploy` keeps the policy's headers in step with the config, and the GitHub OIDC deploy role may update that one policy. The SSR distribution reconcile now compares each behavior's response headers policy, so a policy is no longer silently dropped when another field forces the behavior to be rewritten.
