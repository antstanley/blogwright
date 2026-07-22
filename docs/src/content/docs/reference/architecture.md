---
title: Architecture
description: How blogwright models, provisions, and operates your AWS infrastructure under the hood.
sidebar:
  order: 3
---

blogwright manages a small, fixed set of AWS resources — an S3 bucket, a CloudFront distribution, two IAM roles, a builder MicroVM image, log groups, and a few pieces of glue — modeled as a reconcilable dependency graph. There is no CloudFormation stack, no Terraform state file on your machine, and no CDK synthesis step: the CLI talks to AWS directly by SigV4-signing raw HTTP requests, and the record of what exists lives in the bucket itself. This page explains each layer, for operators who want to know exactly what is in their account.

## The resource graph

Every piece of infrastructure is a `ResourceNode` — an object with an id, its dependencies, and four operations:

```ts
interface ResourceNode {
  id: string;
  dependsOn: string[];
  title: string;
  read(ctx): Promise<boolean>; // exists? also hydrates outputs into state
  create(ctx): Promise<void>;
  update?(ctx): Promise<void>; // optional reconcile of an existing resource
  delete(ctx): Promise<void>;
}
```

`bootstrap` applies the graph: nodes are topologically sorted (Kahn's algorithm), then visited in dependency order. For each node the CLI calls `read` — if the resource exists it is reconciled via `update` (or left as-is when there is nothing to reconcile); if not, it is created. State is persisted after **every** node, so an interrupted bootstrap resumes where it left off instead of re-creating resources. `destroy` walks the same graph in reverse dependency order.

The node set for a standard (non-preview) environment:

| Node id | Resource |
| --- | --- |
| `bucket` | The S3 bucket (`<env>-<siteName>-<accountId>`) with public access blocked and bucket tags applied. Holds artifacts, the site, and state. |
| `microvm-log-group` | CloudWatch log group for builder MicroVM output (`/aws/lambda/microvms/<env>-<siteName>-builder`), retention from `retention.microvmDays`. |
| `cloudfront-log-group` | CloudWatch log group for CloudFront access logs (`/<siteName>/<env>/cloudfront`), retention from `retention.cloudfrontDays`. Always created in us-east-1 — CloudFront vended log delivery exists only there. |
| `iam-build-role` | IAM role Lambda assumes to build the MicroVM image. It is also the running MicroVM's ambient identity (via IMDS), so its policy covers reading source zips, writing `site/`, and writing build logs. |
| `iam-exec-role` | IAM role passed to each builder MicroVM at launch: read the bucket, write `site/` and the build manifests, write logs. |
| `microvm-image` | The builder MicroVM image, baked from the packaged build-agent bundle. Both `create` and `update` run the same reconcile: create if missing, rebuild if the agent bundle or log group changed, otherwise no-op. |
| `oac` | CloudFront Origin Access Control, so the distribution reads S3 privately. |
| `cloudfront-function` | A viewer-request CloudFront Function (`<env>-<siteName>-router`) that resolves directory URLs to `index.html` — required because the private S3 REST origin, unlike a website endpoint, does no index-document resolution. Preview stacks use a variant that also routes the request's Host to its `previews/<id>/site/` prefix. |
| `cloudfront-distribution` | The distribution: OAC-secured S3 origin with origin path `/site`, the router function attached, 403/404 mapped to the site's 404 page (or to `/index.html` with a 200 in `spa` mode). Preview stacks disable caching instead. |
| `cloudfront-log-delivery` | Vended log delivery wiring (delivery source, destination, and delivery in us-east-1) from the distribution to the CloudFront log group. |
| `bucket-policy` | Bucket policy allowing `cloudfront.amazonaws.com` to `s3:GetObject` on `site/*`, conditioned on the distribution's ARN. Its `read` always returns false, so the policy is re-applied on every apply and tracks the distribution ARN. |

Three nodes are conditional:

- `acm-certificate` — only when a domain is configured. Requested in us-east-1 (CloudFront requires it), validated via DNS; the CLI prints the validation records and polls until `ISSUED`. Preview stacks request a wildcard cert and create the validation records in Route53 automatically.
- `gh-oidc-role` — only when `githubRepo` is set (always present on preview stacks). Creates the account's GitHub OIDC provider if needed and a repo-scoped deploy role (`<env>-<siteName>-gh`). See [CI deploys](/guides/ci-github-oidc/).
- `preview-dns` — preview stacks only: a Route53 wildcard `*.<domain>` A/AAAA alias record pointing at the distribution. See [PR previews](/guides/pr-previews/).

### State

The graph's record of what exists lives at `state/<env>.json` **in the bucket** — one JSON document per environment, shared across machines and CI, and the single source of truth:

```json
{
  "version": 1,
  "env": "production",
  "updatedAt": "…",
  "resources": { "<nodeId>": { "arn": "…", "id": "…" } }
}
```

Each node records its outputs (ARNs, ids, domain names) under its id; later nodes and commands read them from there. The bucket name is derived deterministically from env, site name, and account id, which resolves the bootstrap chicken-and-egg: the CLI always knows where state lives before anything exists. A missing state object means a fresh environment; a present-but-corrupt one is a hard error — blogwright refuses to proceed with empty state rather than risk creating duplicate resources. During `destroy`, state-save failures are tolerated once the bucket itself is gone.

`blogwright status` diffs this planned graph against what `read` finds live — see [Operations](/guides/operations/).

## The bucket layout

One bucket per environment holds everything:

```txt
<env>-<siteName>-<accountId>/
├── build/
│   ├── <hash>.zip               # source zips, named by the jj/git revision hash
│   ├── agent/agent-<hash>.zip   # build-agent bundle the builder image is baked from
│   ├── manifests/<hash>.json    # one deployment manifest per build (history/rollback)
│   ├── pending/<target>.json    # queued build job (present only mid-deploy)
│   └── changed/<hash>.json      # changed-paths manifest, consumed for invalidation
├── site/                        # the live site — CloudFront origin, private via OAC
├── previews/<id>/site/          # per-PR preview sites (preview stack only)
└── state/<env>.json             # topology state — source of truth
```

`site/` is never public: public access is blocked on the bucket, and CloudFront reads it through the Origin Access Control under the bucket policy. Deployment manifests record each build's hash, source key, status, timing, and MicroVM id — they are what `blogwright history` lists. `blogwright rollback <hash>` re-runs the build from the retained source zip at `build/<hash>.zip`. `blogwright delete` empties `site/` only; `destroy` empties every prefix and removes the bucket.

## The builder MicroVM

Sites are built in a **Lambda MicroVM**, not on your machine. At bootstrap, the `microvm-image` node bakes a stable builder image: the build-agent bundle shipped inside the CLI package is zipped, uploaded to `build/agent/agent-<hash>.zip`, and snapshotted onto the Amazon Linux 2023 MicroVM base image (`arn:aws:lambda:<region>:aws:microvm-image:al2023-1`). The image reconcile also runs before every deploy — a cheap hash compare in the common case — so build-agent fixes in a blogwright upgrade propagate through CI without a separate `bootstrap`.

Each `blogwright deploy`:

1. Zips the repo (honoring `.gitignore`, plus `sourceInclude`), names the zip by the jj/git revision hash, and uploads it to `build/<hash>.zip`.
2. Launches a MicroVM from the builder image with the exec role, retrying transient gateway errors — the control plane can briefly 502 right after an image update, and the launch's client token makes retries idempotent.
3. Writes the job document to `build/pending/<target>.json` (`site.json` for a normal deploy). The agent inside the VM polls the `build/pending/` prefix, resolves credentials from IMDS, pulls the zip, and runs `pnpm install && pnpm build` in `paths.app`.
4. Syncs `paths.dist` to `site/`, comparing each file's MD5 to the live object's S3 ETag so only changed files are uploaded, and writes the changed-paths manifest to `build/changed/<hash>.json`.
5. Streams the build's CloudWatch logs, watching for hash-scoped markers (`##build:done:<hash>` / `##build:failed:<hash>`) so an orphaned VM from another deploy can never be mistaken for this build's result. The changed-paths manifest doubles as a completion signal if log delivery lags.
6. Terminates the VM, clears the pending job, writes the deployment manifest, and invalidates only the changed CloudFront paths — falling back to `/*` past `invalidationMaxPaths`, and skipping invalidation entirely when nothing changed.

The VM self-terminates at `microvm.maxDurationSeconds` even if the CLI dies mid-deploy, and a failed terminate is only a warning — never something that masks the build outcome. `blogwright logs <hash>` replays a build's CloudWatch logs later; see [Deploying](/guides/deploying/) for the operator-facing flow.

:::note
`destroy` guards against running builder MicroVMs: the image cannot be deleted while any VM launched from it is alive, so the CLI lists them, offers to terminate (the default, so automation is not blocked), and waits for them to clear.
:::

## The transport

blogwright uses **no AWS SDK clients**. `blogwright-core` contains one `SigningClient` that SigV4-signs raw HTTP requests with `@smithy/signature-v4` and sends them over `fetch`, plus a thin hand-written client per service: S3, STS, IAM, CloudWatch Logs, ACM, CloudFront, Route53, Lambda MicroVMs (served off the standard Lambda endpoint), and Secrets Manager. Every AWS call in the system goes through this single seam.

A few consequences of that design:

- **Nothing to drift from.** There is no CloudFormation/Terraform intermediary whose model of the world can diverge from reality. `read` asks AWS directly, and `status` compares that answer to the planned graph.
- **Global-service quirks are handled in the client bundle.** IAM, CloudFront, and Route53 sign as us-east-1; the ACM, CloudFront, and Route53 clients are pinned to us-east-1 (CloudFront certificates must live there), and a second Logs client is pinned there for vended log delivery.
- **One endpoint override redirects everything.** `--endpoint <url>` (or `AWS_ENDPOINT_URL`) routes every service to a single origin — how the integration tests run against the floci emulator on `http://localhost:4566`.
- **Retries are safe by construction.** Idempotent methods (GET/HEAD/PUT/DELETE) retry on network errors, 5xx, and 429; non-idempotent POSTs retry only on network errors, where the request never reached the server — a 5xx on a POST might mean the mutation applied, and retrying could, for example, launch a second MicroVM.
- **The transport is injectable**, so the entire test suite runs against transport-level mocks with no cloud account.

## Tagging and naming

Every AWS resource blogwright creates that supports tagging — the bucket, log groups, IAM roles, certificate, distribution, and log-delivery source — carries two tags:

- `environment` — the environment name (`production`, `staging`, `preview`, …).
- `app` — the explicit `app` config option, falling back to the site's domain, then the repo directory name. Always something a human can trace back to the project from a billing or resource listing.

Site files get the same pair as **S3 object tags**, written on the PUT itself (the `x-amz-tagging` header — which is why the build roles grant `s3:PutObjectTagging` explicitly; `s3:PutObject` does not imply it). Preview deploys stamp the PR into the object tags (`environment: preview-pr-42`), so per-PR cost and cleanup queries work. Because object tags ride on the upload, a tag-only change never reaches unchanged objects — `deploy --refresh` re-uploads everything once to land it.

Resource names are derived deterministically from the environment, `siteName`, and account id — no random suffixes, so `read` can always find what a previous run created:

| Resource | Name |
| --- | --- |
| S3 bucket | `<env>-<siteName>-<accountId>` (must fit S3's 63-character limit) |
| Build role | `<env>-<siteName>-build-role` |
| Exec role | `<env>-<siteName>-exec-role` |
| MicroVM image | `<env>-<siteName>-builder` |
| MicroVM log group | `/aws/lambda/microvms/<env>-<siteName>-builder` |
| CloudFront log group | `/<siteName>/<env>/cloudfront` |
| Origin Access Control | `<env>-<siteName>-oac` |
| Router function | `<env>-<siteName>-router` |
| Log delivery source / destination | `<env>-<siteName>-cf-source` / `<env>-<siteName>-cf-dest` |
| GitHub OIDC role | `<env>-<siteName>-gh` |

`siteName` is the stable slug in every name — see [Configuration](/reference/configuration/) — and the `<env>-` prefix is what keeps environments fully isolated stacks in the same account; see [Environments](/guides/environments/).
