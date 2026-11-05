---
title: Custom domains
description: Serve the site from your own domain with a DNS-validated ACM certificate and a CloudFront alias - your DNS can stay wherever it is hosted.
sidebar:
  order: 4
---

Without a domain, the site is served from the distribution's `*.cloudfront.net` hostname. Configure a domain and `bootstrap` requests a TLS certificate, waits for you to validate it via DNS, and attaches the domain to the CloudFront distribution as its alias. Creating the DNS record that points your domain at the distribution is the one step left to you - blogwright never touches the main site's DNS, so the domain can be hosted at any registrar or DNS provider.

## Configure the domain

Set `domain` in the environment's config file:

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "domain": "example.com",
}
```

Or pass it on the command line at bootstrap:

```sh
blogwright bootstrap --domain example.com
```

`--domain` overrides the config value for that invocation only. Prefer the config file: the domain is read on every command, and `deploy` uses it to compute the [canonical site URL](#the-canonical-site-url) - a domain passed only as a one-off flag at bootstrap is not remembered by later deploys. The domain is per-environment, so `config/staging.jsonc` can carry a different one (or none).

:::note
The domain also serves as the fallback for the `app` resource tag when the `app` config option is unset. See [Configuration](/reference/configuration/).
:::

## What bootstrap does with a domain

A configured domain adds two things to the infrastructure graph:

- **An ACM certificate**, requested in `us-east-1` - CloudFront only accepts certificates from that region, regardless of your primary region - covering exactly the configured domain, validated via DNS.
- **A CloudFront alias**: the domain is attached to the distribution, with the certificate as its viewer certificate.

### Validate the certificate

ACM proves you control the domain through DNS records. Bootstrap prints the validation CNAMEs it needs:

```sh
Add these DNS records at your registrar to validate the certificate:
  CNAME  <name>  ->  <value>
```

Create those records at your DNS host, exactly as printed. Bootstrap then polls the certificate until it is issued, checking every 15 seconds for up to 30 minutes. You can Ctrl-C out of the wait - ACM keeps validating in the background - and re-run `bootstrap` later. If the wait expires before DNS propagates, bootstrap fails with a message telling you to re-run it once it has.

### Re-run bootstrap after validation

Bootstrap is a reconcile, and re-running it is always safe. The certificate's ARN is saved to state before the long issuance wait, so a re-run picks up the same pending certificate - re-printing the validation records if it is still not issued - rather than requesting a new one. Once the certificate is issued, subsequent runs see it and move on. A certificate deleted out-of-band (with a stale ARN left in state) is detected by the status check and treated as missing, not as an error.

### Point your domain at the distribution

Once the distribution carries the alias, bootstrap prints what each hostname should point at:

```sh
CloudFront domain: dxxxxxxxxxxxxx.cloudfront.net
Point these hostnames at dxxxxxxxxxxxxx.cloudfront.net:
  example.com  ALIAS/ANAME -> dxxxxxxxxxxxxx.cloudfront.net  (or A and AAAA alias records where the DNS host cannot flatten a CNAME at the apex)
  www.example.com  CNAME -> dxxxxxxxxxxxxx.cloudfront.net
```

Create those records at your DNS host. Whether a name is a zone apex is worked out by asking DNS - blogwright looks for the SOA record at the name and then at each parent, through your system resolver and falling back to public resolvers (`1.1.1.1`, then `8.8.8.8`) only if it cannot answer - so `example.co.uk` is treated as an apex without a built-in suffix list. If a name's zone cannot be looked up (a domain not yet delegated, say), both forms are printed. The list is printed when it changes, not on every run. This is the only DNS record each site hostname needs beyond the certificate validation records.

### Multiple domains

To serve more than one hostname - an apex and its `www.`, or unrelated domains - keep `domain` as the primary and list the rest as `aliases`:

```jsonc
{
  "domain": "example.com",
  "aliases": ["www.example.com"],
}
```

Bootstrap then:

- requests **one** ACM certificate with `domain` as the subject and the aliases as subject alternative names, because CloudFront takes a single certificate per distribution;
- prints one validation CNAME per hostname that still needs one. A name ACM has already validated needs no new record;
- attaches every hostname to the distribution, and prints the routing record each one needs.

By default every hostname serves the same content. Set [`redirectToPrimary`](/reference/configuration/#redirecttoprimary) to make the aliases answer `301` to the primary instead. Combined with [`redirects`](/reference/configuration/#redirects), a path redirect is evaluated first, so an alias request for a redirected path goes to its final URL on the primary in a single hop.

**Adding an alias** to a bootstrapped site requests a replacement certificate (ACM cannot add names to an issued one), prints the new validation CNAME, and attaches the new certificate and alias once it is issued. The old certificate keeps serving until then, and is deleted after the distribution has switched. If ACM refuses the delete because CloudFront has not finished updating, bootstrap keeps it and retries on the next run.

**Removing an alias is always explicit.** Deleting an entry from `aliases` does not detach it: a hostname that is attached to the distribution but not named in config is reported and left attached, with the certificate still covering it, so a config edit never takes down a live site. Re-running `bootstrap` also never drops an alias you added by hand in the console. To detach the unlisted ones, run:

```sh
blogwright bootstrap --prune-aliases
```

**Managing DNS with Route 53.** If some or all of your zones are in the account's Route 53, set [`manageDns`](/reference/configuration/#managedns) and bootstrap writes the validation and alias records for those hostnames itself, printing guidance only for the rest.

:::note
Route53 is **not** required for the main site's domain - you create the validation and alias records yourself, wherever your DNS lives. PR previews are the opposite: the preview domain **must** be a Route53 hosted zone, so blogwright can create the wildcard certificate's validation records and the wildcard alias automatically. See [PR previews](/guides/pr-previews/).
:::

## Adding a domain to an existing stack

A domain added (or changed) after the first bootstrap reaches the live distribution the same way: set `domain` in the config and re-run `blogwright bootstrap`. The certificate node requests and validates the new certificate, and the distribution reconcile attaches the alias and viewer certificate to the existing distribution - bootstrap reports `attached example.com to the distribution`, or `aliases up to date` when nothing changed.

:::caution
Removing the domain from the config (or omitting `--domain` on a later run) does **not** detach the alias. This is deliberate: dropping a flag must never detach a live site's hostname. Bootstrap reports `no domain configured - existing aliases left as-is` and moves on.
:::

## The canonical site URL

Every deploy computes the site's base URL: the custom domain if one is configured, otherwise the distribution's CloudFront hostname. That URL is passed into the build - it is where `robots.txt` and `sitemap.xml` URLs point - and it appears as the `site` row in the [deploy summary](/guides/deploying/).

This is why the domain belongs in the config file: with `domain` set, every deploy bakes `https://example.com` into the generated SEO files; without it, they fall back to the raw CloudFront URL. When bootstrap completes it prints the CloudFront hostname (`Site will be served at https://….cloudfront.net`) - that is the fallback origin, superseded for canonical URLs as soon as a domain is configured.
