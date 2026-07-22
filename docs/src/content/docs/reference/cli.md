---
title: CLI reference
description: Every blogwright command, positional, and flag — synopsis, behavior, output modes, and exit codes.
sidebar:
  order: 1
---

The CLI installs two identical binaries: `blogwright` and the short alias `bw`. Every invocation follows the same shape:

```sh
blogwright <command> [env] [options]
```

The environment defaults to `production`. Configuration is loaded from `config/<env>.jsonc` at the repo root, falling back to `ops.config.jsonc` — see the [configuration reference](/reference/configuration/) for every key, and [environments](/guides/environments/) for how envs map to AWS resources.

## Invocation

### Positional layout

Most commands take the environment as an optional first positional. Two commands take a build hash first, and the `preview` and `pds` groups shift the layout by one:

| Commands | Layout |
| --- | --- |
| `bootstrap`, `deploy`, `delete`, `destroy`, `history`, `status` | `blogwright <command> [env]` |
| `rollback`, `logs` | `blogwright <command> <hash> [env]` |
| `preview deploy`, `preview destroy` | `blogwright preview <action> <id>` |
| `pds keygen`, `pds login`, `pds init`, `pds sync` | `blogwright pds <action> [env]` |
| `pds secret status`, `pds secret delete` | `blogwright pds secret <action> [env]` |

Environment resolution is `--env` flag, then the positional, then `production`. The same precedence applies to `--hash` over the hash positional and `--id` over the preview id positional. Preview commands always run in the fixed `preview` environment — they take no env at all.

Unrecognized flags are an error. `--help` prints usage and exits 0; running with no command prints usage and exits 1.

## Site commands

### init

```sh
blogwright init
```

First-run wizard. Asks four questions — site name (a lowercase slug that names every AWS resource), AWS region (default `us-east-1`), optional custom domain, optional GitHub repo for CI deploys — and writes a commented `config/production.jsonc` at the repo root, then prints the next steps.

`init` runs before any config or AWS context exists, so it takes no environment or options. It refuses to run (exit 1) when:

- the terminal is not interactive — in CI or plain mode, write the config by hand instead; only `region` and `siteName` are required
- `config/production.jsonc` already exists — edit it directly

Each question allows three attempts before the wizard gives up.

### bootstrap

```sh
blogwright bootstrap [env]
```

Creates or reconciles the full infrastructure graph for the environment — safe to re-run. When a domain is configured (via `--domain` or the config), bootstrap requests the ACM certificate and prints the DNS validation CNAMEs, and the distribution gets the domain as an alias. On completion it prints the CloudFront domain the site is served from. See [deploying](/guides/deploying/) and [custom domains](/guides/custom-domains/).

### deploy

```sh
blogwright deploy [env] [--refresh]
```

Zips the repo (honoring `.gitignore` plus the `sourceIgnore`/`sourceInclude` config), names the zip by the jj/git revision hash, and uploads it to `build/<hash>.zip`. If the build-agent bundle changed, the builder MicroVM image is rebuilt first (a no-op otherwise). The MicroVM pulls the zip, runs `pnpm install && pnpm build`, and syncs the output to the live `site/` prefix; only files whose content changed are re-uploaded, and only the changed CloudFront paths are invalidated (past the configured `invalidationMaxPaths` cap, everything — `/*` — is invalidated instead). On a TTY the command ends with a summary card: revision, environment, source size, build duration, invalidation, and the site URL.

After every successful **production** deploy, standard.site records are re-synced to the PDS when configured — non-fatally, so a PDS outage never fails a good deploy (see [`pds sync`](#pds-sync)).

`--refresh` re-uploads every file even if unchanged, so metadata fixes (content types, object tags) reach live objects the ETag comparison would otherwise skip. Pass it once after upgrading blogwright across a metadata change.

### rollback

```sh
blogwright rollback <hash> [env] [--refresh]
```

Re-deploys an existing build: verifies the source zip `build/<hash>.zip` still exists (errors if it does not), re-runs the builder against it, and invalidates the changed paths. Find hashes with [`history`](#history).

:::caution
Rollback does not sync the PDS — standard.site records mirror the current repo content, which a rollback does not restore. When production has a `pds` config, the command warns: check out the rolled-back revision and run `blogwright pds sync` if needed.
:::

### delete

```sh
blogwright delete [env]
```

Empties the live `site/` prefix and invalidates CloudFront. Infrastructure, build artifacts, and deployment history stay intact — a later `deploy` or `rollback` restores the site. Note it takes effect immediately, without a confirmation prompt.

### destroy

```sh
blogwright destroy [env] --yes
```

Tears down all infrastructure for the environment and deletes its state. Refuses to run without `--yes`. Running builder MicroVMs pin the builder image, so destroy lists them and asks to terminate them first (default yes; on a non-interactive terminal the default applies) — answer no to cancel and let in-flight builds finish.

### history

```sh
blogwright history [env]
```

Lists deployment history from the stored build manifests, newest first. On a TTY it renders a table; piped or `--plain` output is stable columns — `hash`, `status`, `finished`, `duration` — for CI logs and agents. A corrupt manifest is skipped with a warning rather than failing the listing.

### logs

```sh
blogwright logs <hash> [env]
```

Shows the CloudWatch build logs for a deployed hash, filtered to that build's time window (plus a minute either side) from its manifest. If the manifest is unreadable, the command warns and shows the unfiltered log window. Each line is prefixed with its ISO timestamp.

### status

```sh
blogwright status [env]
```

Shows the planned infrastructure graph against live state: each resource node is read from AWS and reported as present or missing, with its recorded outputs. On a TTY this renders as a drift tree; plain output is one stable line per resource. Read failures are reported per node without aborting the rest. See [operations](/guides/operations/).

## Preview commands

The `preview` group manages the shared PR-preview stack. All preview commands run in the fixed `preview` environment — there is no env positional or `--env`. See [PR previews](/guides/pr-previews/) for the architecture and CI wiring.

### preview bootstrap

```sh
blogwright preview bootstrap --domain preview.example.com
```

Provisions the shared preview stack — one CloudFront distribution with a host-routing function, plus the GitHub OIDC deploy role. A domain is required (flag or config); it must be a Route53 hosted zone so the wildcard certificate and DNS records can be created automatically.

### preview deploy

```sh
blogwright preview deploy <id> [--refresh]
```

Builds the current repo in a MicroVM and publishes it to `previews/<id>/site/`, then prints the preview URL `https://<id>.<domain>`. The id (positional or `--id`) must be lowercase alphanumeric with dashes, e.g. `pr-42`. Preview objects carry the id in their `environment` tag (`preview-pr-42`) so per-PR cost and cleanup queries work.

### preview destroy

```sh
blogwright preview destroy <id>
```

Removes one preview by deleting its `previews/<id>/` prefix and reports the object count. No cache invalidation is needed — the preview distribution does not cache.

### preview list

```sh
blogwright preview list
```

Lists the active preview ids with their URLs, or `no active previews`.

### preview teardown

```sh
blogwright preview teardown --yes
```

Tears down the whole shared preview stack and deletes its state. Refuses without `--yes`; like [`destroy`](#destroy), it clears running builder MicroVMs first.

## pds commands

The `pds` group manages [standard.site publishing](/guides/publishing-standard-site/) over AT Protocol. All of it requires a `pds` section in the config; `keygen`, `login`, `init`, and `sync` also require a configured domain. Run the setup commands in order — keygen, commit and release, login, init, sync.

### pds keygen

```sh
blogwright pds keygen [env]
```

Generates the OAuth confidential-client key (kid `<siteName>-oauth-<date>`): the private JWK goes into the Secrets Manager secret — clearing any existing session, since client auth is bound to the key — and the public half is written into two committed documents the site serves, `<publicDir>/oauth/client-metadata.json` and `<publicDir>/oauth/jwks.json`. Commit and release those before running `pds login`.

### pds login

```sh
blogwright pds login --identifier <handle-or-did>
```

Interactive OAuth bootstrap. `--identifier` is required. The command verifies the deployed client documents match the local ones, prints an authorize URL to approve in a browser, then expects the resulting `/oauth/callback` redirect URL pasted back. The session is stored in the Secrets Manager secret and refreshed automatically on every sync. Logging in with a bare DID skips handle resolution; `pds.handleResolver` in the config overrides the resolver used for handles.

### pds secret status

```sh
blogwright pds secret status [env]
```

Shows the secret's metadata — name, ARN, last-changed time — and which parts exist: client key (with its kid), DID, and session. It never prints values. If the secret does not exist, it points you at `pds keygen`.

### pds secret delete

```sh
blogwright pds secret delete --yes [env]
```

Deletes the secret — logging out and discarding the client key. Refuses without `--yes`. Deletion is immediate, with no recovery window.

### pds init

```sh
blogwright pds init [env]
```

One-time, idempotent publication setup: verifies the OAuth client documents are live on the site, then creates the `site.standard.publication` record — or updates it when the committed well-known file already names one — and writes the two files the site needs, the well-known publication file under the public dir and the atproto JSON data file. Commit both; they verify the publication and drive the post link tags. If the committed well-known points at a publication owned by a different account (a fork, or an account migration), init refuses rather than silently breaking verification.

### pds sync

```sh
blogwright pds sync
```

Reconciles the `site.standard.document` records on the PDS with the local content collection and reports a summary: documents created, updated, and unchanged. Records whose local post has been deleted are warned about, never deleted. Sync publishes canonical production URLs, so it refuses to run for any environment other than `production`. It also runs automatically — non-fatally — after every successful production deploy. Record keys are derived from each post's URL path; see the [rkey reference](/reference/rkey/).

## Global options

| Option | Applies to | Effect |
| --- | --- | --- |
| `--env <name>` | env-scoped commands | Select the environment (default `production`); wins over the positional. Ignored by `preview` commands, which always run in the `preview` environment. |
| `--domain <fqdn>` | all but `init` | Custom domain — ACM certificate and CloudFront alias. Overrides `domain` in the config. Required (flag or config) for `preview bootstrap`, `pds keygen`, `pds login`, `pds init`, and `pds sync`. |
| `--config <path>` | all but `init` | Explicit JSONC config file. When set it is the only file tried — the `config/<env>.jsonc` → `ops.config.jsonc` fallback chain is skipped. |
| `--endpoint <url>` | all but `init` | AWS endpoint override, e.g. `http://localhost:4566` for the floci emulator. |
| `--hash <hash>` | `rollback`, `logs` | The build hash; wins over the first positional. |
| `--id <preview>` | `preview deploy`, `preview destroy` | The preview id (e.g. `pr-42`); wins over the positional. |
| `--identifier <handle-or-did>` | `pds login` | The account to authorize as. Required. |
| `--plain` | all | Minimal machine-friendly output — no color, no live status, no prompts. Also automatic when output is piped. |
| `--refresh` | `deploy`, `rollback`, `preview deploy` | Re-upload every file, even unchanged ones, so metadata fixes (content types, object tags) reach live objects the ETag comparison would otherwise skip. |
| `--yes` | `destroy`, `preview teardown`, `pds secret delete` | Confirm the destructive operation; these commands refuse to run without it. |
| `--help` | all | Print usage and exit 0. |

## Output modes

Output has two presentations, chosen once at startup:

- **Interactive** — when both stdin and stdout are TTYs and `--plain` is not passed: color, a transient live-status line for build progress, confirmation prompts, the deploy summary card, the history table, and the status drift tree.
- **Plain** — with `--plain`, or automatically when stdin or stdout is not a TTY (piped output, CI): durable line-oriented text with color stripped, no status line, and no prompts — confirmations take their default, and `init` refuses to run. The plain forms of `history` and `status` are a compatibility contract for CI systems and agents.

`NO_COLOR` disables color only — interactive rendering is otherwise kept. Progress and results go to stdout; warnings and errors go to stderr.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The command completed. Also `--help`. |
| `1` | No command given (usage is printed); unknown command, `preview` action, or `pds` action; or any runtime failure — missing required positional, refused destructive operation, missing config, AWS error — with the message on stderr. |

See [troubleshooting](/guides/troubleshooting/) for what common failures mean and how to recover.
