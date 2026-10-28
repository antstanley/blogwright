---
title: Day-2 operations
description: Inspect drift, audit deploy history, read build logs, roll back, and tear the stack down.
sidebar:
  order: 10
---

Everything blogwright needs for day-2 work already lives in the environment's S3 bucket: the topology state, one manifest per build, and every source zip. The commands on this page read that record - check for drift, audit what deployed when, replay an earlier build, empty the site, or remove the stack entirely. Each command takes the environment positionally or via `--env`, defaulting to `production` (see [Environments](/guides/environments/)).

## Check for drift: `status`

`blogwright status [env]` walks the environment's resource graph - the same nodes `bootstrap` reconciles - and reads each one against the live AWS account.

```sh
bw status staging
```

On a TTY you get a drift tree: `✓` present, `◌` missing, `✗` read error, with each resource's recorded outputs dimmed alongside. When output is piped, in CI, or with `--plain`, each resource becomes one stable `present` / `missing` line instead, and read failures become warnings.

A `missing` resource means the account has drifted from the plan. `bootstrap` is a reconciler - re-run it to create what's missing and update what exists.

## Audit deployments: `history`

Every build the builder MicroVM runs for `site/` - deploy or rollback, success or failure - writes a manifest to `build/manifests/<hash>.json` recording the revision hash, source key, status, start and finish times, duration, and the MicroVM id. A build made by [`stage`](/guides/deploying/#release-gating-stage-verify-promote) writes the same record to `build/staged/<hash>.json` instead, so staging a revision - even a stage that fails - never changes the record of the deploy that made it live. `blogwright history` lists both, newest first.

```sh
bw history
```

A staged build is listed as `staged` (`◇` on a TTY) until it is promoted, then as `promoted`, at the time of its promotion; a stage whose build failed is listed as `failed`. A revision that was both deployed and staged has a row for each.

On a TTY the table shows a status mark, a relative time (`3h ago`), the build duration, and a `← live` marker on the newest build that reached `site/` - a successful deploy or rollback, or a promoted stage. The plain form prints fixed columns - `hash status time duration` - with ISO timestamps. The time is when the row last changed the site: a build's finish, or a promoted stage's promotion. In an [SSR environment](/guides/server-rendered-sites/) both forms add a `revision` column: the Web Function revision a hash was verified with, or `-` when it has none. Pick a hash with a revision to roll back without a rebuild.

One corrupt manifest never takes down the whole listing: it's skipped with a `skipping unreadable manifest` warning and the rest still render. An environment with no builds yet prints `no deployments yet`.

## Read build logs: `logs <hash>`

`blogwright logs <hash>` shows the CloudWatch logs for one build. It reads the hash's newest build record - its deployment manifest, or its staged build's record when that is newer - and filters the builder MicroVM log group to the build's time window - from a minute before it started to a minute after it finished - printing each event with an ISO timestamp. Get hashes from `history`.

```sh
bw logs 4f3a2b1c9d0e
```

If the manifest for that hash is unreadable, the command warns and shows the unfiltered log window instead. An empty result prints `no log events for <hash>` - which also happens once [log retention](#log-retention) has expired the events (the `history` listing is unaffected; manifests live in S3, not CloudWatch).

## Check what is live: `verify <hash>`

`blogwright verify <hash>` compares the objects under `site/` with the original [artifact manifest](/reference/artifact-manifest/) recorded for that hash - reading and hashing every object the release lists with its recorded size, and flagging, without reading them, objects whose size differs and objects the release does not contain. It answers "is what is live exactly what was built (and reviewed) for this hash?" after the fact, for instance from CI once a deploy finishes:

```sh
bw verify 4f3a2b1c9d0e
# ✓ s3://production-example-123456789012/site/ matches release 1.4.0+4f3a2b1c9d0e.9f86d081884c: 212 files, sha256 9f86d081…
```

To check a [staged release](/guides/deploying/#release-gating-stage-verify-promote) before promoting it, add `--staged`: that compares `releases/<hash>/` with the staged release's own record. A hand-edited object, a missing file or a stray extra file each print a line and fail the command with exit code 1. Run it once nothing is deploying: an object replaced mid-run fails the command rather than being compared. Edge caches are not part of the check: CloudFront may still serve a copy cached before the last invalidation completed.

## One command at a time: the environment lock

`deploy`, `rollback`, `stage`, `promote` and `delete` each take the environment's lock, `build/lock.json` in its bucket, before they change anything, and release it when they finish - whether they succeed or fail. A second of these commands started meanwhile refuses straight away, changing nothing, and names the holder: the command, the hash, the AWS identity that ran it and when it started.

```text
Error: "production" is locked by deploy 4f3a2b1c9d0e by arn:aws:sts::123456789012:assumed-role/production-example-github/GitHubActions, started 2026-10-28T09:00:00.000Z (4 min ago) (s3://production-example-123456789012/build/lock.json), so promote would interleave its writes with that command - nothing was changed. Wait for it to finish; if it is no longer running (a cancelled job, a killed process), re-run with `--force-unlock` to replace the lock.
```

Without it, two deploys - or a deploy and a promotion - could interleave their uploads, copies and deletes in `site/` and leave a mix of both releases while each reported success. The lock closes that race, which earlier versions had between any two deploys.

A command that dies without releasing the lock - a cancelled CI job, a killed terminal - leaves it behind, and nothing expires it on a timer, because a long build cannot be told apart from a dead one. Once you know its holder is no longer running, re-run your command with `--force-unlock`: it warns, naming the lock it replaces, and takes the lock itself. `destroy` refuses while the lock is held (or pass `--force-unlock`); `bootstrap`, `history`, `logs`, `status`, `verify` and PR previews do not take it.

Both the CI deploy role and an operator's credentials can create and delete `build/lock.json` with the object access they already hold; the builder's roles cannot.

## Roll back: `rollback <hash>`

`blogwright rollback <hash>` re-runs the builder MicroVM against the source zip already archived at `build/<hash>.zip` - the same build-and-sync pipeline as a [deploy](/guides/deploying/), but fed from the archive instead of your working tree. Your checkout is untouched. If the artifact is gone, the command fails immediately:

```sh
bw rollback 4f3a2b1c9d0e
# Error: no build artifact at build/4f3a2b1c9d0e.zip; cannot roll back to 4f3a2b1c9d0e
```

As with a deploy, only the CloudFront paths whose content actually changed are invalidated, and `--refresh` is accepted to force every file to re-upload.

A rebuild is not guaranteed to reproduce the original bytes - the builder image, dependency resolution and toolchain may all have moved since. So the rollback checks the rebuild against the hash's original [artifact manifest](/reference/artifact-manifest/) - the one its first deploy recorded - and prints both release hashes:

```text
  recorded release sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 (1.4.0+4f3a2b1c9d0e.9f86d081884c)
  rebuilt  release sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 (1.4.0+4f3a2b1c9d0e.9f86d081884c)
✓ the rebuild is byte-identical to the recorded artifact
```

When they differ it warns instead: the site now serves rebuilt bytes that no review covered. The rebuild's manifest is kept under its own key and never replaces the original, so the next rollback is still checked against the reviewed bytes. A rebuild that recorded no manifest of its own cannot be checked, and the rollback says so instead of reporting a match. A hash deployed before artifact manifests existed has nothing to compare against, and the rollback says so too.

:::caution
A production rollback does **not** sync the PDS. The [standard.site records](/plugins/standard-site/) mirror the current repo content, which a rollback does not restore - so the command only warns about the divergence. To realign the records, check out the rolled-back revision and run `blogwright pds sync`.
:::

## Empty the site: `delete`

`blogwright delete [env]` removes every object under the `site/` prefix - nothing else - and then requests a full `/*` CloudFront invalidation so cached copies fall out of the edge.

```sh
bw delete staging
```

Infrastructure, state, source zips, build manifests and staged releases all stay intact, so recovery is just `bw deploy`, `bw rollback <hash>`, or `bw promote <hash>` for a staged release.

## Tear everything down: `destroy --yes`

`blogwright destroy [env] --yes` destroys the environment's entire resource graph and deletes the recorded state. The bucket is emptied and removed too, which takes the build artifacts and deployment history with it. The command refuses to run without `--yes`.

The bucket is emptied version by version - every object version and delete marker, not just current objects - because an SSR environment's bucket is versioned and S3 refuses to delete a bucket that still holds any. The credentials running `destroy` therefore need `s3:ListBucketVersions` and `s3:DeleteObjectVersion` on the bucket, in static environments too. In an SSR environment, destroy also removes the Web Function, its role, log groups, origin access control and cache policy - but only while the `ssr` block is in the config; see [Switching modes](/guides/deploying/#switching-modes).

```sh
bw destroy staging --yes
```

A running builder MicroVM pins its image - the image delete fails while any are alive - so destroy first lists active MicroVMs launched from *this* environment's builder image (a sibling environment's VMs are never touched) and offers to terminate them, default yes. Declining leaves them running and cancels the destroy; non-interactive runs take the default so automation isn't blocked. After terminating, it waits up to three minutes for them to clear; if they don't, it errors and asks you to re-run once they have.

:::note
The shared preview stack is torn down separately with `blogwright preview teardown --yes` (and a single preview with `preview destroy <id>`) - see [PR previews](/guides/pr-previews/).
:::

## Cost visibility

Every AWS resource blogwright creates carries two tags:

- `environment` - the environment name.
- `app` - the explicit `"app"` config value, falling back to the domain, then the repo directory name - always something you can trace back to the project from a billing or resource listing.

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

Both values must be at least 1. To apply a change, re-run `bootstrap` - reconciling an existing log group re-applies its retention policy. See the [configuration reference](/reference/configuration/) for the full option list.

## Output modes

Output is pretty on a TTY (stdin and stdout must both be TTYs): live build progress, the deploy summary card, the status drift tree, spinners.

Everywhere else the CLI switches to stable, line-oriented text - and **the plain formats are a compatibility contract**, safe for scripts, CI logs, and agents to parse:

- **Piped output or CI** automatically gets the plain line-oriented format.
- **`--plain`** forces it explicitly, even when a TTY is attached.
- **`NO_COLOR`** disables colour only, per the [no-color.org](https://no-color.org) convention - the layout is unchanged.

However it's triggered, plain mode strips all colour codes and disables prompts - confirmations take their default (destructive commands still require `--yes`). For scripts that parse the output, pass `--plain` so the plain format is guaranteed regardless of how the command is invoked. The full flag list is in the [CLI reference](/reference/cli/).
