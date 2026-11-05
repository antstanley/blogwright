# Change: Multiple domains per site

**Status:** Merged · **Merged:** 2026-11-05 · **Date:** 2026-11-05 · **Owner:** Ant Stanley · **Target:** site config, ACM certificate node, CloudFront alias reconcile, bootstrap DNS guidance · **Issue:** [#57](https://github.com/antstanley/blogwright/issues/57)

Let one site environment answer on several hostnames that need not share a
parent: an apex and its `www.` host, or unrelated domains. `domain` keeps its
meaning as the primary (canonical) hostname. A new `aliases` list names every
additional hostname. The environment gets one multi-name ACM certificate
covering all of them, the production distribution lists them all as CloudFront
aliases, and the bootstrap prints the validation and routing DNS records each
hostname still needs. Every hostname serves the same content unless
`redirectToPrimary` is set, which makes aliases `301` to the primary. A
reconcile never removes an attached alias on its own: an attached alias that
config does not name is reported as drift and kept until the operator prunes it
explicitly. Preview stacks are unaffected.

---

## Motivation

Today an environment has exactly one hostname. `OpsConfig.domain` is a single
string; the certificate node requests a certificate for that one name, and the
alias reconcile attaches `[domain]` to the distribution
(`packages/cli/src/nodes.ts:1466`, `:1582`). Serving an apex and its `www` is
the normal production setup, yet it can only be done by editing the
distribution by hand.

The hand-made workaround is also unsafe. `reconcileStaticAliases` overwrites
the distribution's alias list and viewer certificate on every run, so the next
`blogwright bootstrap` silently resets both to the apex only and `www` begins
failing with a TLS or 403 error, with no warning. The change must therefore
fix drift handling as well as add the config: it has to notice aliases it does
not own and refuse to drop them.

The CloudFront client already handles an alias list (`setDistributionAliases`,
`aliasesBlock` in `packages/core/src/aws/cloudfront.ts`), so the gap is in
config, the certificate request, validation-record handling, drift handling and
DNS guidance.

---

## Affected spec pages

| Canonical page | Nature of change |
|---|---|
| [`.specs/blogwright/specs/00-overview.md`](../blogwright/specs/00-overview.md) | Problem and goals: an environment may serve several hostnames |
| [`.specs/blogwright/specs/01-domain-model.md`](../blogwright/specs/01-domain-model.md) | New "Site domains" section; `acm-certificate` output gains `domains`; certificate, alias reconcile and DNS guidance rules |
| [`.specs/blogwright/specs/07-web-functions.md`](../blogwright/specs/07-web-functions.md) | The sentence "Aliases and the ACM certificate behave exactly as they do today" changes; redirect association in SSR mode |
| [`canonical-types.schema.json`](../blogwright/specs/canonical-types.schema.json) | `ResourceOutputs` documents `domains` on the certificate output (see Type changes) |

No new canonical page is added.

---

## Proposed changes

### `.specs/blogwright/specs/01-domain-model.md` → Site domains (Add)

> An environment's hostnames are `domain` (the **primary**) plus the optional
> `aliases` list. `domain` may still be supplied with `--domain`; `aliases` is
> config-file only. Existing configs without `aliases` behave exactly as before.
> The primary is the canonical origin: the host used for `robots.txt` and
> `sitemap.xml` URLs, PDS records and OAuth client metadata, and the redirect
> target when `redirectToPrimary` is set.
>
> Each alias is an independent fully-qualified hostname. It need not be a
> sub-domain of the primary and may live in a different DNS zone or at a
> different registrar.
>
> `aliases` is validated at config load. Every entry is a lowercase ASCII
> hostname with at least two labels, with no scheme, port, path or wildcard.
> Entries are unique and none equals `domain`. The primary and aliases together
> number at most 10, the default ACM per-certificate name quota. `aliases`
> without `domain` is rejected.
>
> `redirectToPrimary` is a boolean, default `false`. When `false`, every
> hostname serves the same content and the site's own canonical URLs identify
> the primary. When `true`, a viewer-request CloudFront Function answers any
> request whose `Host` is an alias with a `301` to the same path and query on
> `https://<domain>`. The status is `301`.
>
> `manageDns` is a boolean, default `false`. When `true`, the bootstrap creates
> the validation and routing records itself for every hostname whose hosted
> zone is in the account's Route 53, and prints guidance for the rest (see DNS
> guidance).
>
> In a preview environment, `aliases`, `redirectToPrimary` and `manageDns` are
> rejected at config load with a message that the preview stack serves one
> wildcard host.

### `.specs/blogwright/specs/01-domain-model.md` → Certificate and validation (Add)

> The certificate is one DNS-validated ACM certificate. CloudFront accepts one
> certificate per distribution, so it covers every name: the primary is its
> `DomainName` and every other name is a subject alternative name. The
> **desired name set** is the primary, the configured aliases, and any
> attached alias that config does not name and the operator has not pruned.
>
> The `acm-certificate` output records `arn` and `domains`, the sorted desired
> name set the certificate was requested for. On every run the certificate node
> compares `domains` with the desired set. A mismatch requests a replacement
> certificate rather than editing the existing one, because ACM cannot change
> the names on an issued certificate. The idempotency token is derived from the
> site name, the environment and a short hash of the sorted name set, so a
> changed set requests a new certificate and an unchanged set reuses the
> existing one. The old certificate stays attached and serving until the
> replacement is `ISSUED` and the alias reconcile has attached it; only then
> is the old certificate deleted. A failed or interrupted replacement leaves
> the old certificate in place.
>
> ACM returns one validation record per name, and a record is per hostname,
> not per certificate. Records already satisfied for a name, such as an apex
> validated by an earlier certificate, are not reprinted. Production does not
> manage DNS: the bootstrap prints, grouped by hostname, each validation CNAME
> that is still missing and waits for `ISSUED`. Preview stacks keep creating
> their single validation record in Route 53.

### `.specs/blogwright/specs/01-domain-model.md` → CloudFront aliases (Modify)

> The production distribution's alias list is `[domain, ...aliases]` plus any
> retained undeclared alias, and its viewer certificate is the multi-name
> certificate. The reconcile reads the live alias list and compares it with the
> desired set order-insensitively, so a run with no drift changes nothing and
> re-running `bootstrap` never drops an alias.
>
> Drift is detected in both directions. A configured name missing from the
> distribution is attached. An attached alias that config does not name is
> reported with a warning that names it and says how to prune it, and it stays
> attached, with the certificate still covering it. As today, an absent
> `domain` never removes aliases from a live distribution.
>
> Removing an alias is explicit and is never a side effect of editing config.
> `blogwright bootstrap --prune-aliases` detaches every attached alias that
> config does not name, requests a certificate for the narrower set, and
> deletes the old certificate once the replacement is attached.

### `.specs/blogwright/specs/01-domain-model.md` → DNS guidance (Add)

> After the alias reconcile, the bootstrap prints the final routing record for
> every hostname, pointing at the distribution's CloudFront domain. A zone
> apex needs an ALIAS or ANAME record, or A and AAAA records at a DNS host that
> cannot flatten a CNAME at the apex. Any other host, such as `www`, can be a
> plain CNAME.
>
> The bootstrap decides which case applies by asking DNS. For each hostname it
> queries the SOA record at the host and then at each parent in turn, dropping
> the leading label each time. The first name that answers with an SOA starts
> a run; the run continues up through parents that answer with an identical
> record and ends at the first that does not, and the highest name in the run
> is the zone apex. The run matters because a resolver follows a CNAME when
> asked for SOA, so a `www` that is a CNAME to the apex answers with the
> apex's record and must not be taken for an apex itself. A host equal to the
> apex is an apex. Using DNS rather than a
> suffix list means a host under a multi-label public suffix such as
> `example.co.uk` is classified correctly. If no name answers, as for a domain
> not yet delegated, the bootstrap prints both the apex and the sub-domain
> form for that host and says why.
>
> The queries go to the system resolver first. If the system resolver fails to
> answer (a timeout, `SERVFAIL`, `REFUSED` or a connection error), the same
> query is retried once against public resolvers (`1.1.1.1`, then `8.8.8.8`).
> A definite negative answer (`NXDOMAIN` or no SOA at that name) is not a
> failure and does not trigger the fallback; the walk simply moves to the
> parent.
>
> By default the bootstrap creates none of these records, because the zone is
> often at a registrar blogwright cannot reach. With `manageDns: true`, the
> bootstrap looks for a Route 53 hosted zone that contains each hostname,
> trying the host and then each parent. For a host with a zone it upserts the
> A and AAAA alias records and any ACM validation CNAME there, as the preview
> stack does. A host with no zone in the account is not an error: it falls
> back to the printed guidance, so one site can mix Route 53 and registrar
> hosted names.

### `.specs/blogwright/specs/01-domain-model.md` → Alias redirect (Add)

> When `redirectToPrimary` is `true`, the alias redirect composes with the
> existing router function. A distribution allows one function per event type,
> so the redirect is not a second function: the router function's source gains
> a host check ahead of its directory-index rewrite, and the combined function
> stays the single viewer-request association. When `redirectToPrimary` is
> `false` the router function's source is unchanged.

### `.specs/blogwright/specs/07-web-functions.md` → Distribution reconcile (Modify)

> Aliases and the ACM certificate follow the multi-domain contract in the
> domain model. When `redirectToPrimary` is `true` and `aliases` is non-empty,
> the router function is a redirect-only viewer-request function (no
> directory-index rewrite, since the application owns routing) associated with
> the default behavior and every static-path behavior, so aliases redirect on
> all paths. Otherwise SSR keeps its current shape with no viewer-request
> association.

---

## Type changes

`OpsConfig` is TypeScript, not part of the canonical schema, as for `ssr`. The
one schema-visible change is the documented shape of the certificate output.

```json
{
  "$comment": "Fragment for 2026-11-05-multiple_domains_per_site. Folds into .specs/blogwright/specs/canonical-types.schema.json on merge.",
  "$defs": {
    "AcmCertificateOutput": {
      "type": "object",
      "required": ["arn", "domains"],
      "properties": {
        "arn": { "type": "string" },
        "domains": {
          "type": "array",
          "items": { "type": "string" },
          "uniqueItems": true,
          "minItems": 1,
          "maxItems": 10
        }
      }
    }
  }
}
```

TypeScript additions (informative, in `packages/core/src/config.ts`):

```ts
aliases: string[];            // default []
redirectToPrimary: boolean;   // default false
manageDns: boolean;           // default false
```

---

## Implementation notes

```
1. config.ts: add aliases / redirectToPrimary to OpsConfig and DEFAULT_CONFIG
   (domain at :259); validate in validateConfig (hostname shape, uniqueness,
   <=10 total, requires domain, rejected for preview). mergeConfig (:488)
   spreads scalars; copy the array defensively.
2. context.ts:283: expose ctx.domains = [domain, ...aliases]; keep ctx.domain
   as the primary so pds/*, serving.ts:15 and the preview verbs in
   commands.ts are untouched.
3. acm.ts:39: requestCertificate(domainName, token, tags, sans?) sends
   SubjectAlternativeNames. describeCertificate already returns every
   validation record; add the hostname each belongs to
   (DomainValidationOptions[].DomainName) and skip names already validated.
4. nodes.ts certificate node (:515-580): token = siteName+env+hash(set);
   store domains in output; on set mismatch request the new cert and defer
   deleting the old ARN until after reconcileStaticAliases. Print validation
   records grouped by host. Preview branch unchanged.
5. nodes.ts:1571 reconcileStaticAliases: read live aliases
   (cloudfront.ts:505 setDistributionAliases already parses them), warn on
   undeclared ones, keep them in the desired set unless --prune-aliases. Add
   the flag in cli.ts near :73 and thread it through the context.
6. nodes.ts:1670-1698: replace the single "point <domain> at" line with the
   per-host DNS guidance block. Add a DNS port to Ports (ports.ts) with
   soa(name) returning a fingerprint of the SOA answered (not a boolean: a
   resolver follows a CNAME, so www answers with the apex's record), backed by
   node:dns in the composition root (system
   resolver, then a dns.Resolver with setServers(['1.1.1.1', '8.8.8.8']) on a
   transport failure) and faked in tests, and a zone-apex helper that walks parents until an SOA answers.
   With manageDns, extend route53.hostedZoneId (route53.ts:25, currently an
   exact-name match) to try each parent, then reuse previewDnsNode's A/AAAA
   upsert for each aliased host and upsert validation CNAMEs per host.
7. nodes.ts: the router source is STATIC_ROUTER_CODE (:1374), published by
   routerFunctionNode (:1388) and associated at :1517. Generate the source
   from config instead of a constant: with redirectToPrimary it embeds the
   primary and the alias set. routerFunctionNode.update is a deliberate no-op
   today (:1405) because the code never varied; it must now call
   cloudfront.ensureFunction (cloudfront.ts:708, which already re-reads the
   ETag before publishing) whenever the generated source differs from what was
   last published, recording a hash of it in state. SSR-mode association as
   specified. distributionShapeMatches must compare the association it now
   owns.
8. Tests: config validation table; certificate set-change replace path (old
   cert survives a failed new issuance); alias reconcile idempotence and the
   no-drop-on-rebootstrap case; drift warning for a manual alias; prune;
   router-function snapshot for host redirects including query strings;
   preview rejection message; zone-apex detection against a faked SOA
   responder (apex, www, example.co.uk, unresolvable host); manageDns with a
   mix of Route 53 and non-Route 53 hosts.
9. cli.ts:73 help text and the init wizard (init.ts:490): optional alias prompt.
```

Prior art for the migrate-then-swap flow is the legacy-CNAME handling in the
preview DNS node (`previewDnsNode`, `nodes.ts:2168`).

---

## Merge plan

1. Apply each `Proposed changes` block to its canonical page; bump that page's
   `**Date:**` to the merge date.
2. Fold the `Type changes` `$defs` into
   `.specs/blogwright/specs/canonical-types.schema.json`.
3. Update `.specs/README.md`: move this file from the pending list to the
   merged list pointing at `changes/merged/`.
4. Flip this file's `**Status:**` to `Merged`, add `**Merged:** YYYY-MM-DD`,
   and move it to `.specs/changes/merged/`.

---

## Assumptions and open questions

**Assumptions**

- ACM issues one certificate with up to 10 names by default; the limit is an
  adjustable quota and the cap here is the default.
- A distribution accepts up to the account's alias quota, well above 10.
- Operators control DNS for every listed hostname, possibly at a registrar
  with no Route 53, and can add the printed records.
- The acceptance criteria in issue 57 are the acceptance criteria for this
  change: a config with `domain` plus `aliases` bootstraps to a distribution
  serving every name over TLS; a re-run changes nothing and drops no alias;
  adding an alias issues a new certificate, prints the new validation CNAME,
  then attaches the certificate and aliases once issued; removal is explicit.

**Decisions**

- *Primary plus alias list.* **`domain` stays the primary; `aliases` adds
  names.** Every existing config, the `--domain` flag, PDS records and sitemap
  URLs keep working, and a single canonical host stays well defined.
- *One certificate.* **A single multi-name certificate, not one per host.**
  CloudFront accepts one viewer certificate per distribution.
- *Replace, then swap.* **A changed name set requests a replacement certificate
  and deletes the old one only after it is attached.** ACM cannot edit names on
  an issued certificate, and a failed issuance must leave the live site
  serving.
- *Never remove implicitly.* **An attached alias missing from config is a
  warning, kept attached, and pruned only by `--prune-aliases`.** This is the
  rule `reconcileStaticAliases` already applies to an absent `domain`, and it
  fixes the silent reset a hand-added `www` suffers today. The certificate
  covers retained aliases so a TLS error cannot be introduced by a config edit.
- *Serve by default, redirect on request.* **`redirectToPrimary` defaults to
  `false`.** Serving every name matches the issue's stated default, existing
  configs gain no new behavior, and the site's canonical URLs already identify
  the primary.
- *One viewer-request function.* **The redirect is folded into the router
  function.** A distribution allows one function per event type and the router
  already holds the static-mode association.
- *Prune on bootstrap.* **Explicit removal is `bootstrap --prune-aliases`, not
  a subcommand.** Pruning is a reconcile action over the same state bootstrap
  already reads, and a flag keeps it off the default path.
- *301 for the redirect.* **The redirect status is `301`.** The redirect is
  opt-in, so permanence is what an operator choosing it wants.
- *Fixed cap.* **The name cap is 10, the default ACM quota.** A larger limit
  would need a quota lookup at config load for a case no site has asked for.
- *DNS manual by default, Route 53 opt-in.* **Production prints validation and
  routing records unless `manageDns` is set, and `manageDns` falls back to
  printing per host.** The zone is often at a registrar blogwright cannot
  reach, so managing DNS cannot be the default or all-or-nothing.
- *Apex found by asking DNS.* **A host is an apex when it is the first name in
  its parent chain to answer an SOA query.** This needs no embedded public
  suffix list and handles `example.co.uk`; an unresolvable host prints both
  record forms instead of guessing.
- *System resolver, public fallback.* **SOA queries use the system resolver
  and retry against `1.1.1.1` then `8.8.8.8` only when it fails to answer.**
  The system resolver sees the operator's own DNS, including split-horizon
  zones; the fallback keeps a broken local resolver from blocking a bootstrap.
- *Previews reject the new settings.* **`aliases`, `redirectToPrimary` and
  `manageDns` fail config load in a preview environment.** A clear error beats
  silently ignoring a setting the operator expects to take effect.
- *SSR redirects at the edge too.* **`redirectToPrimary` attaches a
  redirect-only viewer-request function to every SSR behavior.** The same
  setting behaves the same in both modes, and the application needs no host
  logic of its own.

**Open questions**

- Should the `init` wizard ask for aliases? The config keys are documented but
  the wizard does not prompt for them.
