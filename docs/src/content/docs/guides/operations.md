---
title: Day-2 operations
description: Inspect drift, audit deploy history, read build logs, roll back, and tear the stack down.
sidebar:
  order: 8
---

Everything blogwright needs for day-2 work already lives in the environment's S3 bucket: the topology state, one manifest per build, and every source zip. The commands on this page read that record — check for drift, audit what deployed when, replay an earlier build, empty the site, or remove the stack entirely. Each command takes the environment positionally or via `--env`, defaulting to `production` (see [Environments](/guides/environments/)).

## Check for drift: `status`

`blogwright status [env]` walks the environment's resource graph — the same nodes `bootstrap` reconciles — and reads each one against the live AWS account.

```sh
bw status staging
```

On a TTY you get a drift tree: `✓` present, `◌` missing, `✗` read error, with each resource's recorded outputs dimmed alongside. When output is piped, in CI, or with `--plain`, each resource becomes one stable `present` / `missing` line instead, and read failures become warnings.

A `missing` resource means the account has drifted from the plan. `bootstrap` is a reconciler — re-run it to create what's missing and update what exists.

## Audit deployments: `history`

Every build the builder MicroVM runs — deploy or rollback, success or failure — writes a manifest to `build/manifests/<hash>.json` recording the revision hash, source key, status, start and finish times, duration, and the MicroVM id. `blogwright history` lists them, newest first.

```sh
bw history
```

On a TTY the table shows a status mark, a relative finish time (`3h ago`), the build duration, and a `← live` marker on the newest success. The plain form prints fixed columns — `hash status finished duration` — with ISO timestamps.

One corrupt manifest never takes down the whole listing: it's skipped with a `skipping unreadable manifest` warning and the rest still render. An environment with no builds yet prints `no deployments yet`.

## Read build logs: `logs <hash>`

`blogwright logs <hash>` shows the CloudWatch logs for one build. It reads that build's manifest and filters the builder MicroVM log group to the build's time window — from a minute before it started to a minute after it finished — printing each event with an ISO timestamp. Get hashes from `history`.

```sh
bw logs 4f3a2b1c9d0e
```

If the manifest for that hash is unreadable, the command warns and shows the unfiltered log window instead. An empty result prints `no log events for <hash>` — which also happens once [log retention](#log-retention) has expired the events (the `history` listing is unaffected; manifests live in S3, not CloudWatch).

## Roll back: `rollback <hash>`

`blogwright rollback <hash>` re-runs the builder MicroVM against the source zip already archived at `build/<hash>.zip` — the same build-and-sync pipeline as a [deploy](/guides/deploying/), but fed from the archive instead of your working tree. Your checkout is untouched. If the artifact is gone, the command fails immediately:

```sh
bw rollback 4f3a2b1c9d0e
# Error: no build artifact at build/4f3a2b1c9d0e.zip; cannot roll back to 4f3a2b1c9d0e
```

As with a deploy, only the CloudFront paths whose content actually changed are invalidated, and `--refresh` is accepted to force every file to re-upload.

:::caution
A production rollback does **not** sync the PDS. The [standard.site records](/guides/publishing-standard-site/) mirror the current repo content, which a rollback does not restore — so the command only warns about the divergence. To realign the records, check out the rolled-back revision and run `blogwright pds sync`.
:::

## Empty the site: `delete`

`blogwright delete [env]` removes every object under the `site/` prefix — nothing else — and then requests a full `/*` CloudFront invalidation so cached copies fall out of the edge.

```sh
bw delete staging
```

Infrastructure, state, source zips, and build manifests all stay intact, so recovery is just `bw deploy` or `bw rollback <hash>`.

## Tear everything down: `destroy --yes`

`blogwright destroy [env] --yes` destroys the environment's entire resource graph and deletes the recorded state. The bucket is emptied and removed too, which takes the build artifacts and deployment history with it. The command refuses to run without `--yes`.

```sh
bw destroy staging --yes
```

A running builder MicroVM pins its image — the image delete fails while any are alive — so destroy first lists active MicroVMs launched from *this* environment's builder image (a sibling environment's VMs are never touched) and offers to terminate them, default yes. Declining leaves them running and cancels the destroy; non-interactive runs take the default so automation isn't blocked. After terminating, it waits up to three minutes for them to clear; if they don't, it errors and asks you to re-run once they have.

:::note
The shared preview stack is torn down separately with `blogwright preview teardown --yes` (and a single preview with `preview destroy <id>`) — see [PR previews](/guides/pr-previews/).
:::

## Cost visibility

Every AWS resource blogwright creates carries two tags:

- `environment` — the environment name.
- `app` — the explicit `"app"` config value, falling back to the domain, then the repo directory name — always something you can trace back to the project from a billing or resource listing.

Site files get the same values as S3 *object* tags on upload, and preview deploys stamp the PR into them (`environment: preview-pr-42`), so per-PR cost and cleanup queries work.

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "app": "example-blog", // the app tag; defaults to the domain, then the repo dir name
}
```

:::tip
Object tags only reach S3 on a PUT. If an upgrade adds or changes tags, unchanged objects keep their old ones until you run `bw deploy --refresh` once to re-upload every file.
:::

## Log retention

Each environment gets two CloudWatch log groups at bootstrap, with independently configurable retention:

| Log group | Config key | Default |
| --- | --- | --- |
| MicroVM build logs | `retention.microvmDays` | 365 days |
| CloudFront access logs | `retention.cloudfrontDays` | 90 days |

The CloudFront log group always lives in `us-east-1`, regardless of the stack's primary region, because CloudFront's vended log delivery only exists there.

```jsonc
// config/production.jsonc
{
  "retention": { "microvmDays": 90, "cloudfrontDays": 30 },
}
```

Both values must be at least 1. To apply a change, re-run `bootstrap` — reconciling an existing log group re-applies its retention policy. See the [configuration reference](/reference/configuration/) for the full option list.

## Output modes

Output is pretty on a TTY (stdin and stdout must both be TTYs): live build progress, the deploy summary card, the status drift tree, spinners.

Everywhere else the CLI switches to stable, line-oriented text — and **the plain formats are a compatibility contract**, safe for scripts, CI logs, and agents to parse:

- **Piped output or CI** automatically gets the plain line-oriented format.
- **`--plain`** forces it explicitly, even when a TTY is attached.
- **`NO_COLOR`** disables colour only, per the [no-color.org](https://no-color.org) convention — the layout is unchanged.

However it's triggered, plain mode strips all colour codes and disables prompts — confirmations take their default (destructive commands still require `--yes`). For scripts that parse the output, pass `--plain` so the plain format is guaranteed regardless of how the command is invoked. The full flag list is in the [CLI reference](/reference/cli/).
