---
title: standard.site
description: Mirror your blog posts to your own AT Protocol PDS as standard.site records, re-synced automatically after every production deploy.
sidebar:
  order: 3
---

Run `pnpm exec blogwright plugin add pds` and add `"pds": { "name": "My Blog" }` to `config/production.jsonc` to start. Setup is then five commands, about 10 minutes including one deploy; after that, every production deploy keeps your posts in sync.

The standard.site plugin mirrors your blog to your AT Protocol PDS (Personal Data Server) as [standard.site](https://standard.site) records:

- One `site.standard.publication` record for the site.
- One `site.standard.document` record per post.

Install it with `pnpm exec blogwright plugin add pds`, which pins `blogwright-pds` to the CLI's exact version. Its namespace is `pds`: every command is `blogwright pds <action>`. Without a `pds` block in the config, it does nothing.

:::note[Upgrading from 0.4]
The CLI no longer installs `blogwright-pds` for you. A site that publishes to standard.site must run `blogwright plugin add pds` once and commit the `package.json` and lockfile change. Until then `blogwright pds <action>` reports that no plugin claims `pds`, and production deploys stop syncing records without any warning.
:::

It suits a content site - a blog built from a content collection of Markdown posts. It needs a custom domain, because the site itself acts as the OAuth client.

## Configure it

A name and a domain are all you need:

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "domain": "example.com",
  "pds": {
    "name": "My Blog",
  },
}
```

| Key | Default | Purpose |
| --- | --- | --- |
| `pds.name` | (required) | Publication display name, and the OAuth client name on the consent screen. |
| `pds.description` | none | Optional publication description. |
| `pds.secretName` | `<siteName>/atproto` | Secrets Manager secret holding the OAuth client key and session. |
| `pds.handleResolver` | `https://public.api.bsky.app` | Resolver `pds login` uses to turn a handle into a DID. Must be `https`. Logging in with a bare DID skips it. |

`domain` is required: the OAuth client identity and every published URL are built from it. See [Custom domains](/guides/custom-domains/) and the [configuration reference](/reference/configuration/#standardsite-publishing-pds).

## One-time setup

Run these in order. Each step checks the one before it and stops with a pointer if something is missing.

1. Generate the client key:

   ```sh
   blogwright pds keygen
   ```

   This stores a private ES256 key in Secrets Manager and writes two public documents: `public/oauth/client-metadata.json` and `public/oauth/jwks.json`.

2. Commit the documents and deploy, so they are live at `https://<domain>/oauth/`:

   ```sh
   git add public/oauth && git commit -m "Add OAuth client documents"
   blogwright deploy
   ```

3. Log in:

   ```sh
   blogwright pds login --identifier <handle-or-did>
   ```

   Open the printed URL, approve access on your PDS, and paste the full callback URL you land on - query string included - back into the terminal.

4. Create the publication, then commit the two files it writes:

   ```sh
   blogwright pds init
   git add public/.well-known src/data/atproto.json && git commit -m "Add standard.site publication"
   ```

5. Publish your posts:

   ```sh
   blogwright pds sync
   ```

From now on, publishing is automatic.

### What each step leaves behind

| Step | Files to commit | Stored in Secrets Manager |
| --- | --- | --- |
| `pds keygen` | `public/oauth/client-metadata.json`, `public/oauth/jwks.json` | Private client key. Clears any existing session. |
| `pds login` | none | Session and your DID |
| `pds init` | `public/.well-known/site.standard.publication` (the publication's AT-URI, which clients use to verify the site), `src/data/atproto.json` (`{ did, publicationUri }`, which the site imports to render its `<link>` tags) | none |

`login` and `init` both fetch the deployed `/oauth/` documents first and check them against the local key and config. That is why step 2 comes before step 3: a missing or stale deployment fails here, with a clear message, instead of deep inside OAuth.

`pds init` is idempotent: it updates the publication when one already exists. If the committed well-known file points at a publication another account owns (a fork, or a migrated account), it refuses rather than publishing against it. Delete the file to start fresh, or log in as the owning account.

## Steady state

Every successful **production** [deploy](/guides/deploying/) re-runs the sync. Nothing else to do.

- **It never fails a deploy.** A PDS outage logs a warning; the next deploy heals it.
- **Other environments skip it.** `pds sync` publishes canonical production URLs and refuses to run for any other environment.
- **Rollbacks do not sync.** A rollback restores the site, not your working tree. Check out the rolled-back revision and run `blogwright pds sync` to realign.
- **Deleted posts stay on the PDS.** Records with no matching post are reported as orphans, with their rkeys. Delete them by hand if you meant to.
- **A lapsed session warns and skips.** Sessions last as long as they refresh within 180 days. If one lapses, run `blogwright pds login` again - the key survives, so no keygen or redeploy.

Before writing anything, every sync checks that the well-known file matches `src/data/atproto.json`, that the logged-in DID matches the one recorded at init, and that no two posts derive the same rkey.

## Which posts are published

The sync reads the content collection - `src/content/blog` by default, or `paths.content`:

- Every `.md` and `.mdx` file, except drafts (`draft: true`).
- Each post must have `title`, `description` and `pubDate` frontmatter. A post missing one fails the sync rather than being skipped.
- A frontmatter `slug` wins. Otherwise the slug is the file path without its extension and any trailing `/index` - the same id Astro's glob loader produces.

The publication record carries the site URL (`https://<domain>`), `pds.name` and `pds.description`. It updates when the config changes. Preferences you set in a standard.site client, such as turning `showInDiscover` off, are kept.

## Paths it reads

Three `paths` settings tell the plugin where your files are. Their defaults match a stock Astro project, and nothing else reads them:

| Setting | Default | What it is |
| --- | --- | --- |
| `paths.publicDir` | `public` | Static files served at the site root. The OAuth documents and the well-known file are written under it. |
| `paths.content` | `src/content/blog` | The content collection the sync reads posts from. |
| `paths.atprotoJson` | `src/data/atproto.json` | The file `pds init` writes, which the site imports to render its `<link>` tags. |

Override them if your site keeps static files or posts elsewhere. The OAuth documents and the well-known file sit at fixed URL paths under `publicDir`, so only the directory changes.

## Record keys come from URLs

Each document's record key (rkey) is derived from the post's URL path, `/posts/<slug>/`. No lookup table, no PDS round-trip: the CLI and your site compute the same rkey from the path alone. Your site uses the `blogwright/rkey` export to build its `<link rel="site.standard.document">` tags. See the [rkey reference](/reference/rkey/).

:::caution
The rkey **is** the URL. Never change a post's slug after publishing - a new slug derives a new rkey, so the sync creates a new record and the old one becomes an orphan.
:::

## How authentication works

The site is a **confidential OAuth client** (atproto OAuth). It serves three fixed paths:

| Path | What it is |
| --- | --- |
| `/oauth/client-metadata.json` | Client metadata. Its URL is the client id. |
| `/oauth/jwks.json` | The public half of the client's ES256 key. |
| `/oauth/callback` | The redirect target. A static page is enough, because you paste the URL back into the terminal. |

The JSON documents are written under `paths.publicDir` (`public/` by default). The private key and session stay in Secrets Manager and are read only at keygen, login and sync. They never enter the build MicroVM.

Refresh tokens are single-use. Every sync refreshes the session and writes the new token back. Overlapping CI deploys are safe: when one sync rotates the session under another, the second re-reads the secret and adopts the new session.

## CI deploys

The plugin owns a separate IAM inline policy, `blogwright-pds`, that lets the site's GitHub OIDC deploy role read and rotate the secret.

1. Create the site role: `blogwright bootstrap <env>`
2. Attach the plugin's grant, once per stack: `blogwright pds bootstrap <env>`

Production and staging are eligible. Preview stacks never get access to the shared credential.

If you skip step 2, deploys still succeed but the post-deploy sync warns. Running `pds bootstrap` fixes it. Upgrading from the release that moved this grant? Run `pds bootstrap` before the next site `bootstrap`, which removes the old grant. See [CI with GitHub OIDC](/guides/ci-github-oidc/).

`blogwright pds status <env>` reports the plugin's resource. `blogwright pds destroy <env> --yes` removes its policy and state, but keeps the secret and the site role.

## Manage the secret

```sh
blogwright pds secret status        # name, ARN, last change, which parts exist - never values
blogwright pds secret delete --yes  # log out and discard the client key
```

`secret delete` takes effect immediately, with no recovery window. To publish again afterwards, start over from `pds keygen`.

## Related pages

- [Plugins overview](/plugins/overview/) - how plugins store state and tear down
- [CLI reference: pds commands](/reference/cli/#pds-commands) - every `pds` command and flag
- [rkey reference](/reference/rkey/) - the record-key derivation
