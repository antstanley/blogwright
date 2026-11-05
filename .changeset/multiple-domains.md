---
'blogwright': minor
'blogwright-core': minor
---

Serve a site on several hostnames. `domain` stays the primary; the new `aliases` list adds more (an apex plus `www.`, or unrelated domains). Bootstrap requests one ACM certificate covering every name, attaches each to the distribution, and prints the validation and routing record each hostname needs, working out whether a name is a zone apex by asking DNS. A hostname attached to the distribution but missing from config is reported and left attached; `bootstrap --prune-aliases` detaches it. `redirectToPrimary` makes aliases `301` to the primary (static and SSR sites), and `manageDns` creates the records in Route 53 for zones in the account.
