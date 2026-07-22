import {
  AwsError,
  CACHING_DISABLED,
  CLOUDFRONT_ALIAS_ZONE_ID,
  pollUntil,
  textTag,
  type CreateImageInput,
  type DistributionListItem,
} from 'blogwright-core';

import { packageAndUploadAgent } from './agent-package.js';
import type { OpsContext } from './context.js';
import type { ResourceNode } from './graph.js';

/** Lambda-managed MicroVM base image (Amazon Linux 2023) for the primary region. */
function microvmBaseImageArn(region: string): string {
  return `arn:aws:lambda:${region}:aws:microvm-image:al2023-1`;
}

function output(ctx: OpsContext, id: string): Record<string, string | number | boolean | string[]> {
  return (ctx.state.resources[id] ??= {});
}

function logGroupArn(ctx: OpsContext, name: string, region = ctx.config.region): string {
  return `arn:aws:logs:${region}:${ctx.accountId}:log-group:${name}:*`;
}

/** S3 resource ARN the build writes the site into (per-PR prefix for preview stacks). */
function siteWriteResource(ctx: OpsContext): string {
  return ctx.preview
    ? `arn:aws:s3:::${ctx.names.bucket}/previews/*/site/*`
    : `arn:aws:s3:::${ctx.names.bucket}/site/*`;
}

/** Tagging + public-access block are idempotent PUTs, shared by create and update. */
async function applyBucketConfiguration(ctx: OpsContext): Promise<void> {
  await ctx.clients.s3.putBucketTagging(ctx.names.bucket, ctx.tags);
  await ctx.clients.s3.putPublicAccessBlock(ctx.names.bucket);
}

/** The S3 bucket holding build artifacts, the live site, and topology state. */
function bucketNode(): ResourceNode {
  return {
    id: 'bucket',
    dependsOn: [],
    title: 'S3 bucket',
    async read(ctx) {
      const exists = await ctx.clients.s3.bucketExists(ctx.names.bucket);
      if (exists) output(ctx, 'bucket').name = ctx.names.bucket;
      return exists;
    },
    async create(ctx) {
      await ctx.clients.s3.createBucket(ctx.names.bucket);
      // Identity output before the secondary mutations: a crash between CreateBucket
      // and tagging/PAB must still leave the bucket recorded in state.
      output(ctx, 'bucket').name = ctx.names.bucket;
      await applyBucketConfiguration(ctx);
    },
    async update(ctx) {
      // Reconcile on every apply: a bucket created by a crashed earlier run (before
      // its tagging/PAB calls) converges to the configured shape on the next run.
      await applyBucketConfiguration(ctx);
    },
    async delete(ctx) {
      // Empty every prefix (site/build/state) before removing the bucket.
      await ctx.clients.s3.deletePrefix(ctx.names.bucket, '');
      await ctx.clients.s3.deleteBucket(ctx.names.bucket);
    },
  };
}

function logGroupNode(
  id: string,
  title: string,
  name: (ctx: OpsContext) => string,
  days: (ctx: OpsContext) => number,
  // CloudFront vended log delivery exists only in us-east-1, so its log group
  // must live there too — regardless of the stack's primary region.
  usEast1 = false,
): ResourceNode {
  const logs = (ctx: OpsContext) => (usEast1 ? ctx.clients.logsUsEast1 : ctx.clients.logs);
  const region = (ctx: OpsContext) => (usEast1 ? 'us-east-1' : ctx.config.region);
  return {
    id,
    dependsOn: [],
    title,
    async read(ctx) {
      const exists = await logs(ctx).logGroupExists(name(ctx));
      if (exists) output(ctx, id).arn = logGroupArn(ctx, name(ctx), region(ctx));
      return exists;
    },
    async create(ctx) {
      await logs(ctx).ensureLogGroup(name(ctx), ctx.tags);
      await logs(ctx).putRetentionPolicy(name(ctx), days(ctx));
      output(ctx, id).arn = logGroupArn(ctx, name(ctx), region(ctx));
    },
    async update(ctx) {
      await logs(ctx).putRetentionPolicy(name(ctx), days(ctx));
    },
    async delete(ctx) {
      await logs(ctx).deleteLogGroup(name(ctx));
    },
  };
}

const LAMBDA_TRUST = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { Service: 'lambda.amazonaws.com' },
      Action: ['sts:AssumeRole', 'sts:TagSession'],
    },
  ],
};

/** IAM role Lambda assumes while building the MicroVM image. */
/** Apply the build role's inline policy (idempotent — used by create + update). */
async function applyBuildRolePolicy(ctx: OpsContext): Promise<void> {
  // The build role is BOTH the image-build role AND the MicroVM's ambient runtime
  // identity (via IMDS), so it needs the build's runtime S3 permissions: read the
  // source, list the bucket (to clear site/), and write the built site.
  await ctx.clients.iam.putRolePolicy(ctx.names.buildRole, 'build', {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['s3:GetObject'], Resource: `arn:aws:s3:::${ctx.names.bucket}/*` },
      { Effect: 'Allow', Action: ['s3:ListBucket'], Resource: `arn:aws:s3:::${ctx.names.bucket}` },
      {
        // s3:PutObjectTagging is required even though the tags ride on the PUT
        // itself (x-amz-tagging header) — AWS checks it as a distinct action, and
        // PutObject does not imply it. Without it every tagged upload 403s.
        Effect: 'Allow',
        Action: ['s3:PutObject', 's3:PutObjectTagging', 's3:DeleteObject'],
        Resource: siteWriteResource(ctx),
      },
      {
        // The agent writes the changed-paths manifest the CLI reads for targeted invalidation.
        Effect: 'Allow',
        Action: ['s3:PutObject'],
        Resource: `arn:aws:s3:::${ctx.names.bucket}/build/changed/*`,
      },
      {
        Effect: 'Allow',
        Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: logGroupArn(ctx, ctx.names.microvmLogGroup),
      },
    ],
  });
}

function buildRoleNode(): ResourceNode {
  return {
    id: 'iam-build-role',
    dependsOn: ['bucket', 'microvm-log-group'],
    title: 'IAM build role',
    async read(ctx) {
      const arn = await ctx.clients.iam.getRoleArn(ctx.names.buildRole);
      if (arn) output(ctx, 'iam-build-role').arn = arn;
      return Boolean(arn);
    },
    async create(ctx) {
      const arn = await ctx.clients.iam.ensureRole(
        ctx.names.buildRole,
        LAMBDA_TRUST,
        `Builds the ${ctx.config.siteName} MicroVM image`,
        ctx.tags,
      );
      await applyBuildRolePolicy(ctx);
      output(ctx, 'iam-build-role').arn = arn;
    },
    async update(ctx) {
      await applyBuildRolePolicy(ctx);
    },
    async delete(ctx) {
      await ctx.clients.iam.deleteRole(ctx.names.buildRole);
    },
  };
}

async function applyExecRolePolicy(ctx: OpsContext): Promise<void> {
  await ctx.clients.iam.putRolePolicy(ctx.names.execRole, 'exec', {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:GetObject'],
        Resource: `arn:aws:s3:::${ctx.names.bucket}/*`,
      },
      {
        // s3:PutObjectTagging: see the build role — a tagged PUT needs it explicitly.
        Effect: 'Allow',
        Action: ['s3:PutObject', 's3:PutObjectTagging', 's3:DeleteObject'],
        Resource: siteWriteResource(ctx),
      },
      {
        // Manifests + the changed-paths manifest the agent writes for invalidation.
        Effect: 'Allow',
        Action: ['s3:PutObject'],
        Resource: [
          `arn:aws:s3:::${ctx.names.bucket}/build/manifests/*`,
          `arn:aws:s3:::${ctx.names.bucket}/build/changed/*`,
        ],
      },
      {
        Effect: 'Allow',
        Action: ['s3:ListBucket'],
        Resource: `arn:aws:s3:::${ctx.names.bucket}`,
      },
      {
        Effect: 'Allow',
        Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: logGroupArn(ctx, ctx.names.microvmLogGroup),
      },
    ],
  });
}

/** IAM role the running builder MicroVM assumes to read source + write the site. */
function execRoleNode(): ResourceNode {
  return {
    id: 'iam-exec-role',
    dependsOn: ['bucket', 'microvm-log-group'],
    title: 'IAM exec role',
    async read(ctx) {
      const arn = await ctx.clients.iam.getRoleArn(ctx.names.execRole);
      if (arn) output(ctx, 'iam-exec-role').arn = arn;
      return Boolean(arn);
    },
    async create(ctx) {
      const arn = await ctx.clients.iam.ensureRole(
        ctx.names.execRole,
        LAMBDA_TRUST,
        `Runtime role for the ${ctx.config.siteName} builder MicroVM`,
        ctx.tags,
      );
      await applyExecRolePolicy(ctx);
      output(ctx, 'iam-exec-role').arn = arn;
    },
    async update(ctx) {
      await applyExecRolePolicy(ctx);
    },
    async delete(ctx) {
      await ctx.clients.iam.deleteRole(ctx.names.execRole);
    },
  };
}

/** The builder MicroVM image (snapshot of the build-agent server). */
async function imageInput(ctx: OpsContext): Promise<{ input: CreateImageInput; hash: string }> {
  const artifact = await packageAndUploadAgent(ctx);
  return {
    hash: artifact.hash,
    input: {
      name: ctx.names.microvmImage,
      codeArtifactUri: `s3://${ctx.names.bucket}/${artifact.key}`,
      baseImageArn: microvmBaseImageArn(ctx.config.region),
      buildRoleArn: String(output(ctx, 'iam-build-role').arn),
      memoryGb: ctx.config.microvm.memory,
      logGroupName: ctx.names.microvmLogGroup,
      // Bucket + region for the agent, which polls s3://<bucket>/build/pending.json and
      // resolves credentials from IMDS (→ the build role identity). Hookless: hooks are
      // delivered over TLS which the agent can't satisfy, and are unnecessary here.
      environmentVariables: { BUILD_BUCKET: ctx.names.bucket, BUILD_REGION: ctx.config.region },
      // Scoped by image name, not just agent hash: two environments in one account
      // share the hash, and reusing a clientToken with different parameters is a 400.
      clientToken: `img-${ctx.names.microvmImage}-${artifact.hash}`,
      description: `${ctx.config.siteName} ${ctx.env} builder`,
    },
  };
}

/**
 * Poll until the image reaches its expected terminal state, treating a timeout (still
 * CREATING/UPDATING) as failure — never success. For updates, require the version to
 * advance past `priorVersion` so a stale pre-update state can't be read as done.
 */
async function awaitImageSettled(
  ctx: OpsContext,
  arn: string,
  expected: 'CREATED' | 'UPDATED',
  priorVersion?: string,
): Promise<void> {
  const ok = new RegExp(`^${expected}$`, 'i');
  const settled = await pollUntil(
    () => ctx.clients.microvms.getImage(arn),
    (img) => {
      if (!img) return false;
      if (/CREATE_FAILED|UPDATE_FAILED/i.test(img.state)) return true;
      return (
        ok.test(img.state) && (priorVersion === undefined || img.imageVersion !== priorVersion)
      );
    },
    { intervalMs: 5000, timeoutMs: 600_000 },
  );
  if (!settled || !ok.test(settled.state)) {
    throw new Error(`MicroVM image build did not succeed (state=${settled?.state ?? 'unknown'})`);
  }
  const out = output(ctx, 'microvm-image');
  out.arn = settled.imageArn;
  if (settled.imageVersion) out.version = settled.imageVersion;
}

export type BuilderImageAction = 'create' | 'update' | 'skip';

/**
 * Decide what a builder-image reconcile should do: create when the image is missing or
 * being deleted, skip when a healthy image already matches the current agent bundle and
 * log group, otherwise update (agent bundle changed, log group changed, or last build
 * unhealthy). Pure so the decision is unit-testable independent of the AWS calls.
 */
export function builderImageAction(
  image: { state: string } | undefined,
  recorded: { agentHash?: string | undefined; logGroup?: string | undefined },
  hash: string,
  logGroup: string,
): BuilderImageAction {
  if (!image || /DELET/i.test(image.state)) return 'create';
  const healthy = /CREATED|UPDATED/i.test(image.state);
  const unchanged = recorded.agentHash === hash && recorded.logGroup === logGroup;
  return healthy && unchanged ? 'skip' : 'update';
}

/**
 * Create, rebuild, or leave the MicroVM builder image, depending on what's deployed:
 * create it if missing, rebuild it if the agent bundle (or its log group) changed or the
 * last build is unhealthy, otherwise no-op. Idempotent and cheap in the common case (a
 * single GetMicrovmImage + hash compare), so it's safe to run before every deploy — which
 * is how build-agent changes propagate through CI without a separate `bootstrap`.
 */
export async function reconcileBuilderImage(ctx: OpsContext): Promise<void> {
  // GetMicrovmImage requires an ARN/ID (not the friendly name), looked up via the ARN
  // recorded in state on a prior create.
  const recordedArn = output(ctx, 'microvm-image').arn;
  const existing =
    typeof recordedArn === 'string' ? await ctx.clients.microvms.getImage(recordedArn) : undefined;
  const out = output(ctx, 'microvm-image');
  const { input, hash } = await imageInput(ctx);
  const action = builderImageAction(
    existing,
    {
      agentHash: out.agentHash as string | undefined,
      logGroup: out.logGroup as string | undefined,
    },
    hash,
    ctx.names.microvmLogGroup,
  );
  if (action === 'skip') return;

  if (action === 'create') {
    ctx.logger.step(`create MicroVM image (agent ${hash})`);
    const image = await ctx.clients.microvms.createImage(input);
    // Persist the ARN immediately so a later failure/retry finds the image (and updates it)
    // instead of re-issuing create() and hitting a 409 on the existing name.
    out.arn = image.imageArn;
    await ctx.save();
    await awaitImageSettled(ctx, image.imageArn, 'CREATED');
  } else {
    const arn = String(recordedArn);
    ctx.logger.step(`update MicroVM image (agent ${hash})`);
    await ctx.clients.microvms.updateImage(arn, input);
    await awaitImageSettled(ctx, arn, 'UPDATED', existing?.imageVersion);
  }

  out.agentHash = hash;
  out.logGroup = ctx.names.microvmLogGroup;
  await ctx.save();
}

function microvmImageNode(): ResourceNode {
  return {
    id: 'microvm-image',
    dependsOn: ['bucket', 'iam-build-role'],
    title: 'MicroVM builder image',
    async read(ctx) {
      const arn = output(ctx, 'microvm-image').arn;
      if (typeof arn !== 'string') return false;
      const image = await ctx.clients.microvms.getImage(arn);
      if (!image || /DELET/i.test(image.state)) return false;
      if (image.imageVersion) output(ctx, 'microvm-image').version = image.imageVersion;
      return true;
    },
    // Both paths reconcile: create-if-missing / rebuild-if-changed / else no-op.
    create: reconcileBuilderImage,
    update: reconcileBuilderImage,
    async delete(ctx) {
      const arn = output(ctx, 'microvm-image').arn;
      if (typeof arn === 'string') await ctx.clients.microvms.deleteImage(arn);
    },
  };
}

/** ACM certificate (us-east-1) — only present when a custom domain is configured. */
function certificateNode(): ResourceNode {
  return {
    id: 'acm-certificate',
    // Depends on the bucket so state (with the cert ARN) can be saved before the long
    // ISSUED wait — the id sorts before 'bucket', so without this it would run first.
    dependsOn: ['bucket'],
    title: 'ACM certificate',
    async read(ctx) {
      const arn = output(ctx, 'acm-certificate').arn;
      if (typeof arn !== 'string') return false;
      try {
        const status = await ctx.clients.acm.describeCertificate(arn);
        return status.status === 'ISSUED';
      } catch (err) {
        // Cert deleted out-of-band with a stale ARN in state → recreate, don't throw.
        if (err instanceof AwsError && err.isNotFound) return false;
        throw err;
      }
    },
    async create(ctx) {
      const domain = ctx.domain;
      if (!domain) throw new Error('certificate node requires a domain');
      // Previews are served at <pr-id>.<domain>, so the cert must be wildcard.
      const certDomain = ctx.preview ? `*.${domain}` : domain;
      let arn = output(ctx, 'acm-certificate').arn as string | undefined;
      if (!arn) {
        // ACM idempotency token must match \w+ (no dashes).
        const token = `${ctx.config.siteName}${ctx.env}`.replace(/\W/g, '');
        arn = await ctx.clients.acm.requestCertificate(certDomain, token, ctx.tags);
        output(ctx, 'acm-certificate').arn = arn;
        await ctx.save();
      }
      let initial = await ctx.clients.acm.describeCertificate(arn);
      if (initial.status === 'PENDING_VALIDATION' && initial.validation.length === 0) {
        // ACM populates the validation ResourceRecords asynchronously after
        // RequestCertificate — an empty set here is that race, not "nothing to
        // validate". Acting on it would skip record creation entirely and the
        // issuance poll below could never succeed.
        initial = await pollUntil(
          () => ctx.clients.acm.describeCertificate(arn),
          (s) => s.status !== 'PENDING_VALIDATION' || s.validation.length > 0,
          { intervalMs: 5_000, timeoutMs: 5 * 60_000 },
        );
        if (initial.status === 'PENDING_VALIDATION' && initial.validation.length === 0) {
          throw new Error('ACM returned no validation records for the certificate; re-run bootstrap');
        }
      }
      if (initial.status !== 'ISSUED' && initial.validation.length > 0) {
        if (ctx.preview) {
          // Preview domain is a Route53 hosted zone — create the validation records for you.
          const zoneId = await ctx.clients.route53.hostedZoneId(domain);
          if (!zoneId) throw new Error(`no Route53 hosted zone found for ${domain}`);
          for (const r of initial.validation) {
            await ctx.clients.route53.upsertRecord(zoneId, {
              name: r.name,
              type: r.type,
              value: r.value,
            });
          }
          ctx.logger.step('created ACM validation records in Route53; waiting for ISSUED…');
        } else {
          ctx.logger.warn('Add these DNS records at your registrar to validate the certificate:');
          for (const r of initial.validation) {
            ctx.logger.info(`  ${r.type}  ${r.name}  ->  ${r.value}`);
          }
          ctx.logger.step('waiting for certificate to be ISSUED (Ctrl-C to background)…');
        }
      }
      const settled = await pollUntil(
        () => ctx.clients.acm.describeCertificate(arn),
        (s) => s.status === 'ISSUED' || s.status === 'FAILED',
        { intervalMs: 15_000, timeoutMs: 30 * 60_000 },
      );
      if (settled.status !== 'ISSUED') {
        throw new Error(
          `certificate not ISSUED (status=${settled.status}); re-run bootstrap once DNS propagates`,
        );
      }
    },
    async delete(ctx) {
      const arn = output(ctx, 'acm-certificate').arn;
      if (typeof arn === 'string') await ctx.clients.acm.deleteCertificate(arn);
    },
  };
}

/** CloudFront Origin Access Control granting the distribution private read on S3. */
function oacNode(): ResourceNode {
  return {
    id: 'oac',
    dependsOn: [],
    title: 'CloudFront OAC',
    async read(ctx) {
      return typeof output(ctx, 'oac').id === 'string';
    },
    async create(ctx) {
      const id = await ctx.clients.cloudfront.createOriginAccessControl(ctx.names.oac);
      output(ctx, 'oac').id = id;
    },
    async delete(ctx) {
      const id = output(ctx, 'oac').id;
      if (typeof id === 'string') await ctx.clients.cloudfront.deleteOriginAccessControl(id);
    },
  };
}

/**
 * CloudFront Function (viewer-request) that routes a preview subdomain to its S3 prefix:
 * `pr-42.preview.example.com/foo` → origin `previews/pr-42/site/foo`, with directory →
 * index.html resolution. Runs on every request (previews are not CDN-cached).
 */
const PREVIEW_FUNCTION_CODE = `function handler(event) {
  var request = event.request;
  var host = request.headers.host.value;
  var id = host.split('.')[0];
  var uri = request.uri;
  if (uri.endsWith('/')) { uri += 'index.html'; }
  else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) { uri += '/index.html'; }
  request.uri = '/previews/' + id + '/site' + uri;
  return request;
}`;

/**
 * CloudFront Function (viewer-request) for staging/production: resolve a directory URL
 * to its index document (`/projects/` → `/projects/index.html`). Required because the S3
 * origin is the private REST endpoint (via OAC), which — unlike an S3 website endpoint —
 * does no index-document resolution, so `DefaultRootObject` only covers the apex. The
 * `/site` origin path is applied by the distribution, so this function must not add it.
 */
const STATIC_ROUTER_CODE = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) { uri += 'index.html'; }
  else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) { uri += '/index.html'; }
  request.uri = uri;
  return request;
}`;

/**
 * CloudFront viewer-request function. Preview stacks route a subdomain to its S3 prefix
 * (and resolve index documents); staging/production just resolve directory URLs to their
 * index document. Both are needed because the OAC/REST S3 origin does no index resolution.
 */
function routerFunctionNode(preview: boolean): ResourceNode {
  return {
    id: 'cloudfront-function',
    dependsOn: [],
    title: 'CloudFront routing function',
    async read(ctx) {
      return typeof output(ctx, 'cloudfront-function').arn === 'string';
    },
    async create(ctx) {
      const arn = await ctx.clients.cloudfront.ensureFunction(
        `${ctx.names.prefix}-router`,
        preview ? PREVIEW_FUNCTION_CODE : STATIC_ROUTER_CODE,
        `${ctx.config.siteName} ${ctx.env} ${preview ? 'preview host router' : 'directory-index router'}`,
      );
      output(ctx, 'cloudfront-function').arn = arn;
    },
    async update() {
      // The router code is static; leave the already-published function as-is (updating +
      // re-publishing hits CloudFront's ETag/stage preconditions). To change the router,
      // delete the function (teardown) and re-bootstrap.
    },
    async delete(ctx) {
      await ctx.clients.cloudfront.deleteFunction(`${ctx.names.prefix}-router`);
    },
  };
}

/**
 * Find the distribution a crashed earlier bootstrap created but never recorded in
 * state. The deterministic comment (`"<siteName> <env>"`) narrows candidates; identity
 * is confirmed by CallerReference — comments are editable in the console, while the
 * reference is immutable for the distribution's life and collision-free across
 * environments by construction.
 */
async function findAdoptableDistribution(
  ctx: OpsContext,
  comment: string,
  callerReference: string,
): Promise<DistributionListItem | undefined> {
  const candidates = (await ctx.clients.cloudfront.listDistributions()).filter(
    (d) => d.comment === comment,
  );
  for (const candidate of candidates) {
    const config = await ctx.clients.cloudfront.getDistributionConfig(candidate.id);
    if (config && textTag(config.config, 'CallerReference') === callerReference) {
      return candidate;
    }
  }
  return undefined;
}

/** The CloudFront distribution. Preview stacks use a host-routing function + no caching. */
function distributionNode(hasDomain: boolean, preview: boolean): ResourceNode {
  const dependsOn = [
    'bucket',
    'oac',
    'cloudfront-function',
    ...(hasDomain ? ['acm-certificate'] : []),
  ];
  return {
    id: 'cloudfront-distribution',
    dependsOn,
    title: 'CloudFront distribution',
    async read(ctx) {
      const id = output(ctx, 'cloudfront-distribution').id;
      if (typeof id !== 'string') return false;
      const dist = await ctx.clients.cloudfront.getDistribution(id);
      return Boolean(dist);
    },
    async create(ctx) {
      const callerReference = `${ctx.names.prefix}-${ctx.accountId}`;
      const comment = `${ctx.config.siteName} ${ctx.env}`;
      // What create and adopt agree on: enough identity to record outputs and tag.
      let dist: Pick<DistributionListItem, 'id' | 'arn' | 'domainName'>;
      try {
        dist = await ctx.clients.cloudfront.createDistribution({
          callerReference,
          comment,
          bucketDomainName: `${ctx.names.bucket}.s3.${ctx.config.region}.amazonaws.com`,
          // Preview: function rewrites the full path, so the origin path is the bucket root.
          originPath: preview ? '' : '/site',
          originAccessControlId: String(output(ctx, 'oac').id),
          defaultRootObject: ctx.config.defaultRootObject,
          aliases: ctx.domain ? [preview ? `*.${ctx.domain}` : ctx.domain] : [],
          acmCertificateArn: hasDomain ? String(output(ctx, 'acm-certificate').arn) : undefined,
          functionArn: String(output(ctx, 'cloudfront-function').arn),
          // Previews are served uncached (per-PR content, host-routed); staging/production
          // keep the default cache policy. Non-preview stacks map the S3 REST origin's
          // 403/404 (a missing key) to the site's 404 page — or, in SPA mode, to
          // /index.html with a 200 so client-side routes deep-link correctly.
          ...(preview
            ? { cachePolicyId: CACHING_DISABLED }
            : {
                customErrorResponses: [403, 404].map((errorCode) => ({
                  errorCode,
                  responsePagePath: ctx.config.spa ? '/index.html' : '/404.html',
                  responseCode: ctx.config.spa ? 200 : 404,
                })),
              }),
        });
      } catch (err) {
        // A crashed earlier bootstrap can leave a distribution in AWS that state never
        // recorded. Retrying then 409s on the duplicate alias — CloudFront's CNAME
        // conflict check fires before the CallerReference idempotency match — so adopt
        // the orphan instead. No verified match means the alias belongs to a foreign
        // distribution: that conflict is real and must surface.
        const conflict =
          err instanceof AwsError &&
          /^(?:CNAMEAlreadyExists|DistributionAlreadyExists)$/.test(err.code);
        if (!conflict) throw err;
        // Best-effort, like the failure-path state save: a broken lookup (e.g. missing
        // ListDistributions permission) must not displace the actionable conflict error.
        let adopted: DistributionListItem | undefined;
        try {
          adopted = await findAdoptableDistribution(ctx, comment, callerReference);
        } catch (lookupErr) {
          ctx.logger.warn(`adoption lookup failed (${(lookupErr as Error).message})`);
        }
        if (!adopted) throw err;
        ctx.logger.ok(`adopted existing distribution ${adopted.id} (created by an earlier run)`);
        dist = adopted;
      }
      const out = output(ctx, 'cloudfront-distribution');
      out.id = dist.id;
      out.arn = dist.arn;
      out.domainName = dist.domainName;
      await ctx.clients.cloudfront.tagResource(dist.arn, ctx.tags);
      ctx.logger.info(`  CloudFront domain: ${dist.domainName}`);
      if (ctx.domain && !preview) {
        // Preview stacks create the wildcard record themselves (preview-dns
        // node, next in the graph); only the main site may be DNS'd elsewhere.
        ctx.logger.info(`  point ${ctx.domain} (CNAME/ALIAS) at ${dist.domainName}`);
      }
    },
    async update(ctx) {
      // A domain added (or changed) after the first bootstrap must reach the
      // existing distribution — the certificate node validates the cert, but
      // only this reconcile attaches the alias + viewer certificate.
      const id = output(ctx, 'cloudfront-distribution').id;
      if (typeof id !== 'string') return;
      if (!ctx.domain) {
        // Deliberately no automatic alias removal: dropping --domain from a
        // later run must not detach a live site's hostname.
        ctx.logger.ok('no domain configured — existing aliases left as-is');
        return;
      }
      const alias = preview ? `*.${ctx.domain}` : ctx.domain;
      const certArn = String(output(ctx, 'acm-certificate').arn);
      const changed = await ctx.clients.cloudfront.setDistributionAliases(id, [alias], certArn);
      if (changed) {
        ctx.logger.ok(`attached ${alias} to the distribution`);
        const domainName = output(ctx, 'cloudfront-distribution').domainName;
        if (typeof domainName === 'string') {
          ctx.logger.info(`  point ${alias} (CNAME/ALIAS) at ${domainName}`);
        }
      } else {
        ctx.logger.ok('aliases up to date');
      }
    },
    async delete(ctx) {
      const id = output(ctx, 'cloudfront-distribution').id;
      if (typeof id !== 'string') return;
      ctx.logger.step('disabling distribution (this can take several minutes)…');
      await ctx.clients.cloudfront.disableDistribution(id);
      await pollUntil(
        () => ctx.clients.cloudfront.getDistribution(id),
        (d) => !d || d.status === 'Deployed',
        { intervalMs: 30_000, timeoutMs: 30 * 60_000 },
      );
      await ctx.clients.cloudfront.deleteDistribution(id);
    },
  };
}

/** Wire CloudFront access logs to the CloudWatch log group via vended log delivery. */
function logDeliveryNode(): ResourceNode {
  async function wire(ctx: OpsContext): Promise<void> {
    const distArn = String(output(ctx, 'cloudfront-distribution').arn);
    const groupArn = String(output(ctx, 'cloudfront-log-group').arn).replace(/:\*$/, '');
    // Record each ARN as it is created (not after the trio completes): a crash midway
    // still leaves the source/destination in state for destroy to clean up. read()
    // keys off `delivery`, which is only set once the wiring is complete.
    const out = output(ctx, 'cloudfront-log-delivery');
    out.source = await ctx.clients.logsUsEast1.putDeliverySource(
      ctx.names.deliverySource,
      distArn,
      'ACCESS_LOGS',
      ctx.tags,
    );
    const destArn = await ctx.clients.logsUsEast1.putDeliveryDestination(
      ctx.names.deliveryDestination,
      groupArn,
    );
    out.destination = destArn;
    await ctx.clients.logsUsEast1.createDelivery(ctx.names.deliverySource, destArn);
    out.delivery = 'configured';
  }

  return {
    id: 'cloudfront-log-delivery',
    dependsOn: ['cloudfront-distribution', 'cloudfront-log-group'],
    title: 'CloudFront log delivery',
    async read(ctx) {
      return typeof output(ctx, 'cloudfront-log-delivery').delivery === 'string';
    },
    async create(ctx) {
      try {
        await wire(ctx);
      } catch (err) {
        // delete() below leaves the delivery plumbing behind, and PutDeliverySource
        // refuses to repoint an existing source at a new distribution ARN — so a
        // destroy → bootstrap cycle hits ConflictException here. Remove the stale
        // delivery/source/destination trio and retry once.
        if (!(err instanceof AwsError && /Conflict/i.test(err.code))) throw err;
        ctx.logger.step('stale log delivery from a previous stack — removing and retrying');
        for (const id of await ctx.clients.logsUsEast1.deliveriesForSource(ctx.names.deliverySource)) {
          await ctx.clients.logsUsEast1.deleteDelivery(id);
        }
        await ctx.clients.logsUsEast1.deleteDeliverySource(ctx.names.deliverySource);
        await ctx.clients.logsUsEast1.deleteDeliveryDestination(ctx.names.deliveryDestination);
        await wire(ctx);
      }
    },
    async delete(ctx) {
      // Removing the distribution/log group does NOT clean up vended log delivery: the
      // delivery source/destination persist, and a later bootstrap against a new
      // distribution ARN fails with ConflictException ("Update to existing Delivery Source
      // with new ResourceId is not allowed"). Delete the delivery first (it references both),
      // then the source and destination. The id isn't in state, so look it up by source name.
      const deliveryId = await ctx.clients.logsUsEast1.findDeliveryIdBySource(ctx.names.deliverySource);
      if (deliveryId) await ctx.clients.logsUsEast1.deleteDelivery(deliveryId);
      await ctx.clients.logsUsEast1.deleteDeliverySource(ctx.names.deliverySource);
      await ctx.clients.logsUsEast1.deleteDeliveryDestination(ctx.names.deliveryDestination);
    },
  };
}

/** Bucket policy granting the distribution read on site/* (applied after the dist exists). */
function bucketPolicyNode(): ResourceNode {
  return {
    id: 'bucket-policy',
    dependsOn: ['bucket', 'cloudfront-distribution'],
    title: 'S3 bucket policy',
    async read() {
      // Always reconcile so the policy tracks the distribution ARN.
      return false;
    },
    async create(ctx) {
      const distArn = String(output(ctx, 'cloudfront-distribution').arn);
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowCloudFrontRead',
            Effect: 'Allow',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Action: ['s3:GetObject'],
            Resource: ctx.preview
              ? `arn:aws:s3:::${ctx.names.bucket}/previews/*`
              : `arn:aws:s3:::${ctx.names.bucket}/site/*`,
            Condition: { StringEquals: { 'AWS:SourceArn': distArn } },
          },
        ],
      };
      await ctx.clients.s3.putBucketPolicy(ctx.names.bucket, JSON.stringify(policy));
      output(ctx, 'bucket-policy').applied = true;
    },
    async delete() {
      // Removed together with the bucket during destroy.
    },
  };
}

const GITHUB_OIDC_URL = 'token.actions.githubusercontent.com';
// GitHub's OIDC thumbprint. AWS validates GitHub via its trust store and does not rely on
// this value, but the API requires one.
const GITHUB_OIDC_THUMBPRINT = '6938fd4d98bab03faadb97b34396831e3780aea1';

/**
 * IAM role a GitHub Actions workflow assumes via OIDC — to deploy/destroy previews
 * (preview stack, any ref) or to deploy production (main branch only, plus CloudFront
 * invalidation and read access to the PDS credentials secret).
 */
function githubOidcRoleNode(preview: boolean): ResourceNode {
  const roleName = (ctx: OpsContext) => `${ctx.names.prefix}-gh`;
  return {
    id: 'gh-oidc-role',
    // Production deploys invalidate the distribution, so its ARN must be in state.
    dependsOn: preview ? ['iam-exec-role'] : ['iam-exec-role', 'cloudfront-distribution'],
    title: 'GitHub OIDC deploy role',
    async read(ctx) {
      const arn = await ctx.clients.iam.getRoleArn(roleName(ctx));
      if (arn) output(ctx, 'gh-oidc-role').arn = arn;
      return Boolean(arn);
    },
    async create(ctx) {
      await applyOidcRole(ctx, roleName(ctx));
    },
    async update(ctx) {
      await applyOidcRole(ctx, roleName(ctx));
    },
    async delete(ctx) {
      // Leave the account-global OIDC provider; only remove the repo-scoped role.
      await ctx.clients.iam.deleteRole(roleName(ctx));
    },
  };
}

/**
 * The workflow's OIDC subject claim, scoped per environment to match how each one
 * deploys: previews from any PR ref; staging from pushes to main; production from the
 * `production` GitHub Environment (release-gated — see production.yml), which lets
 * deploys be gated behind environment protection rules.
 */
export function oidcSubClaim(repo: string, env: string, preview: boolean): string {
  if (preview) return `repo:${repo}:*`;
  if (env === 'production') return `repo:${repo}:environment:production`;
  return `repo:${repo}:ref:refs/heads/main`;
}

/** The deploy role's inline policy statements (exported for tests). */
export function oidcRolePolicyStatements(ctx: OpsContext): object[] {
  const statements: object[] = [
    { Effect: 'Allow', Action: ['sts:GetCallerIdentity'], Resource: '*' },
    {
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      Resource: `arn:aws:s3:::${ctx.names.bucket}/*`,
    },
    { Effect: 'Allow', Action: ['s3:ListBucket'], Resource: `arn:aws:s3:::${ctx.names.bucket}` },
    {
      Effect: 'Allow',
      Action: [
        'lambda:RunMicrovm',
        'lambda:GetMicrovm',
        'lambda:ListMicrovms',
        'lambda:TerminateMicrovm',
        'lambda:CreateMicrovmAuthToken',
        'lambda:GetMicrovmImage',
        // Rebuild the builder image in-deploy when the agent bundle changed, so
        // build-agent fixes propagate through CI without a separate `bootstrap`.
        'lambda:CreateMicrovmImage',
        'lambda:UpdateMicrovmImage',
        // RunMicrovm attaches the managed ingress/egress network connectors.
        'lambda:PassNetworkConnector',
      ],
      Resource: '*',
    },
    {
      Effect: 'Allow',
      Action: ['logs:FilterLogEvents', 'logs:GetLogEvents'],
      Resource: logGroupArn(ctx, ctx.names.microvmLogGroup),
    },
    {
      // RunMicrovm passes the exec role to the MicroVM; rebuilding the builder image
      // passes the build role.
      Effect: 'Allow',
      Action: ['iam:PassRole'],
      Resource: [
        String(output(ctx, 'iam-exec-role').arn),
        String(output(ctx, 'iam-build-role').arn),
      ],
    },
  ];
  if (!ctx.preview) {
    // Production deploys invalidate changed paths; previews are never cached.
    statements.push({
      Effect: 'Allow',
      Action: ['cloudfront:CreateInvalidation'],
      Resource: String(output(ctx, 'cloudfront-distribution').arn),
    });
    if (ctx.config.pds) {
      // The post-deploy PDS sync reads the OAuth secret and writes it back:
      // refresh tokens are single-use, so every sync persists the rotated
      // session (PutSecretValue via the upsert helper, which tries CreateSecret
      // first when the secret is missing).
      statements.push({
        Effect: 'Allow',
        Action: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:PutSecretValue',
          'secretsmanager:CreateSecret',
        ],
        Resource: `arn:aws:secretsmanager:${ctx.config.region}:${ctx.accountId}:secret:${ctx.config.pds.secretName}-*`,
      });
    }
  }
  return statements;
}

async function applyOidcRole(ctx: OpsContext, roleName: string): Promise<void> {
  const repo = ctx.config.githubRepo;
  if (!repo) throw new Error('config.githubRepo is required for the GitHub OIDC role');
  // CreateOpenIDConnectProvider needs the https:// scheme; the ARN + condition keys use
  // the bare host.
  await ctx.clients.iam.ensureOidcProvider(
    `https://${GITHUB_OIDC_URL}`,
    'sts.amazonaws.com',
    GITHUB_OIDC_THUMBPRINT,
  );
  const providerArn = `arn:aws:iam::${ctx.accountId}:oidc-provider/${GITHUB_OIDC_URL}`;
  const arn = await ctx.clients.iam.ensureRole(
    roleName,
    {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Federated: providerArn },
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: { [`${GITHUB_OIDC_URL}:aud`]: 'sts.amazonaws.com' },
            StringLike: { [`${GITHUB_OIDC_URL}:sub`]: oidcSubClaim(repo, ctx.env, ctx.preview) },
          },
        },
      ],
    },
    `GitHub Actions ${ctx.env} deploy role`,
    ctx.tags,
  );
  await ctx.clients.iam.putRolePolicy(roleName, `${ctx.env}-deploy`, {
    Version: '2012-10-17',
    Statement: oidcRolePolicyStatements(ctx),
  });
  output(ctx, 'gh-oidc-role').arn = arn;
}

/**
 * Route53 wildcard record pointing *.<domain> at the preview CloudFront
 * distribution — A/AAAA alias records (free queries, apex-safe), not a CNAME.
 */
function previewDnsNode(): ResourceNode {
  async function upsertAliases(ctx: OpsContext): Promise<void> {
    const domain = ctx.domain;
    if (!domain) throw new Error('preview DNS requires a domain');
    const zoneId = await ctx.clients.route53.hostedZoneId(domain);
    if (!zoneId) throw new Error(`no Route53 hosted zone found for ${domain}`);
    const cf = String(output(ctx, 'cloudfront-distribution').domainName);
    const out = output(ctx, 'preview-dns');
    // Route53 refuses A/AAAA alongside a CNAME at the same name, so clear any
    // CNAME first — a pre-0.2.1 bootstrap's (recorded in state) or an
    // operator's manual workaround (pointing at the distribution). Deleting a
    // record that is not there is a no-op.
    if (out.type !== 'ALIAS') {
      const staleValues = new Set([cf, ...(typeof out.value === 'string' ? [out.value] : [])]);
      for (const value of staleValues) {
        await ctx.clients.route53.deleteRecord(zoneId, {
          name: `*.${domain}`,
          type: 'CNAME',
          value,
        });
      }
    }
    for (const type of ['A', 'AAAA'] as const) {
      await ctx.clients.route53.upsertRecord(zoneId, {
        name: `*.${domain}`,
        type,
        value: cf,
        aliasZoneId: CLOUDFRONT_ALIAS_ZONE_ID,
      });
    }
    out.record = `*.${domain}`;
    out.zoneId = zoneId;
    out.value = cf;
    out.type = 'ALIAS';
    ctx.logger.info(`  *.${domain} -> ${cf} (alias)`);
  }

  return {
    id: 'preview-dns',
    dependsOn: ['cloudfront-distribution'],
    title: 'Route53 wildcard record',
    async read(ctx) {
      return typeof output(ctx, 'preview-dns').record === 'string';
    },
    create: upsertAliases,
    async update(ctx) {
      // Reconcile: migrates a legacy CNAME to aliases and repoints a drifted
      // target; a no-drift run is two idempotent UPSERTs.
      await upsertAliases(ctx);
    },
    async delete(ctx) {
      const out = output(ctx, 'preview-dns');
      if (
        typeof out.zoneId !== 'string' ||
        typeof out.record !== 'string' ||
        typeof out.value !== 'string'
      ) {
        return;
      }
      if (out.type === 'ALIAS') {
        for (const type of ['A', 'AAAA'] as const) {
          await ctx.clients.route53.deleteRecord(out.zoneId, {
            name: out.record,
            type,
            value: out.value,
            aliasZoneId: CLOUDFRONT_ALIAS_ZONE_ID,
          });
        }
      } else {
        await ctx.clients.route53.deleteRecord(out.zoneId, {
          name: out.record,
          type: 'CNAME',
          value: out.value,
        });
      }
    },
  };
}

/** Build the full node set for the current context (production or preview stack). */
export function buildNodes(ctx: OpsContext): ResourceNode[] {
  const hasDomain = Boolean(ctx.domain);
  const nodes: ResourceNode[] = [
    bucketNode(),
    logGroupNode(
      'microvm-log-group',
      'MicroVM log group',
      (c) => c.names.microvmLogGroup,
      (c) => c.config.retention.microvmDays,
    ),
    logGroupNode(
      'cloudfront-log-group',
      'CloudFront log group',
      (c) => c.names.cloudfrontLogGroup,
      (c) => c.config.retention.cloudfrontDays,
      true, // us-east-1: vended CloudFront delivery only exists there (#3)
    ),
    buildRoleNode(),
    execRoleNode(),
    microvmImageNode(),
    oacNode(),
    routerFunctionNode(ctx.preview),
    distributionNode(hasDomain, ctx.preview),
    logDeliveryNode(),
    bucketPolicyNode(),
  ];
  if (hasDomain) nodes.push(certificateNode());
  if (ctx.preview) {
    nodes.push(previewDnsNode(), githubOidcRoleNode(true));
  } else if (ctx.config.githubRepo) {
    // staging deploys on push to main; production on release (see the deploy workflows).
    nodes.push(githubOidcRoleNode(false));
  }
  return nodes;
}
