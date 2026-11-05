---
'blogwright': minor
'blogwright-core': minor
---

feat: path-based redirects. A new `redirects` list in the environment config compiles into the CloudFront router function, answering real HTTP redirects (exact paths and trailing-wildcard prefixes with `:splat`). `bootstrap` and `deploy` republish the function when the set changes.
