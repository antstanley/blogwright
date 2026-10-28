import {
  ALL_VIEWER_EXCEPT_HOST_HEADER,
  AwsError,
  CACHING_DISABLED,
  CACHING_OPTIMIZED,
  CLOUDFRONT_ALIAS_ZONE_ID,
  CONTENT_SECURITY_POLICY_DEFAULT_QUOTA,
  CUSTOM_RESPONSE_HEADERS_DEFAULT_QUOTA,
  MICROVM_CPU_ARCHITECTURE,
  pollUntil,
  REPRODUCIBLE_ZIP_MTIME,
  createZip,
  textTag,
  WEB_FUNCTION_RUNTIME,
  withRetry,
  type CreateImageInput,
  type DeliverySummary,
  type DistributionConfigInput,
  type DistributionListItem,
  type DistributionOriginInput,
  type ResourceNode as CoreResourceNode,
  type ResponseHeadersConfig,
  type ResponseHeadersPolicyConfigInput,
  type SsrConfig,
  type WebFunctionEndpoint,
} from 'blogwright-core';

import { packageAndUploadAgent } from './agent-package.js';
import type { OpsContext } from './context.js';

type ResourceNode = CoreResourceNode<OpsContext>;

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

/**
 * Enable versioning when (and only when) the environment is in SSR mode. Once
 * enabled it is never suspended - suspending would not remove the versions
 * already retained and would break the artifact pins a revision depends on -
 * so a config that drops `ssr` keeps versioning and only stops relying on it.
 */
async function ensureBucketVersioning(ctx: OpsContext): Promise<void> {
  if (!ctx.config.ssr) return;
  const out = output(ctx, 'bucket');
  if (out.versioned === true) return;
  const status = await ctx.clients.s3.getBucketVersioning(ctx.names.bucket);
  if (status !== 'Enabled') await ctx.clients.s3.putBucketVersioning(ctx.names.bucket, 'Enabled');
  out.versioned = true;
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
      await ensureBucketVersioning(ctx);
    },
    async update(ctx) {
      // Reconcile on every apply: a bucket created by a crashed earlier run (before
      // its tagging/PAB calls) converges to the configured shape on the next run.
      await applyBucketConfiguration(ctx);
      // Versioning is only ever turned ON here, so a stack that gained `ssr` after
      // bootstrapping converges and one that lost it is left alone.
      await ensureBucketVersioning(ctx);
    },
    async delete(ctx) {
      // Version-aware removal is the ONLY way to empty a versioned bucket: a plain
      // delete leaves delete markers and noncurrent versions behind, and the
      // bucket then cannot be deleted. `deletePrefix` keeps its plain-delete
      // behaviour for every other caller (`blogwright delete`, preview destroy).
      await ctx.clients.s3.deleteAllVersions(ctx.names.bucket, '');
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
  // must live there too - regardless of the stack's primary region.
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
/**
 * S3 write grants the agent needs in SSR mode: the artifact zip and its
 * `web/results/<hash>.json` sidecar. Static mode's roles can write only
 * `site/*` and their `build/` prefixes, so without these the agent's upload
 * would be denied.
 */
function webArtifactWriteStatements(ctx: OpsContext): object[] {
  if (!ctx.config.ssr) return [];
  return [
    {
      Effect: 'Allow',
      Action: ['s3:PutObject'],
      Resource: [
        `arn:aws:s3:::${ctx.names.bucket}/web/artifacts/*`,
        `arn:aws:s3:::${ctx.names.bucket}/web/results/*`,
      ],
    },
  ];
}

/**
 * The agent records each static build's artifact manifest at its own
 * `build/artifacts/<hash>/<buildId>.json`. The grant stops at that depth on
 * purpose: a revision's original record, `build/artifacts/<hash>.json`, is
 * written once by the CLI and is out of the builder's reach. The shared
 * preview stack and SSR environments record none.
 */
function artifactManifestWriteStatements(ctx: OpsContext): object[] {
  if (ctx.preview || ctx.config.ssr) return [];
  return [
    {
      Effect: 'Allow',
      Action: ['s3:PutObject'],
      Resource: `arn:aws:s3:::${ctx.names.bucket}/build/artifacts/*/*`,
    },
  ];
}

/** Apply the build role's inline policy (idempotent - used by create + update). */
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
        // itself (x-amz-tagging header) - AWS checks it as a distinct action, and
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
      ...webArtifactWriteStatements(ctx),
      ...artifactManifestWriteStatements(ctx),
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
        // s3:PutObjectTagging: see the build role - a tagged PUT needs it explicitly.
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
      ...webArtifactWriteStatements(ctx),
      ...artifactManifestWriteStatements(ctx),
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
      // Arm64 in every environment, so what the build compiles or installs matches
      // the Web Function runtime (and `ARM_64` is the API's only value). Sent on
      // create AND update, because `imageBody` emits it either way.
      cpuConfigurations: [{ architecture: MICROVM_CPU_ARCHITECTURE }],
      // Scoped by image name, not just agent hash: two environments in one account
      // share the hash, and reusing a clientToken with different parameters is a 400.
      // The architecture is part of the token because adding it to a request that
      // reused an older token's parameters would be exactly that 400.
      clientToken: `img-${ctx.names.microvmImage}-arm64-${artifact.hash}`,
      description: `${ctx.config.siteName} ${ctx.env} builder`,
    },
  };
}

/**
 * Poll until the image reaches its expected terminal state, treating a timeout (still
 * CREATING/UPDATING) as failure - never success. For updates, require the version to
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
 * single GetMicrovmImage + hash compare), so it's safe to run before every deploy - which
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
  // Record the architecture the request stated. Deliberately not a rebuild
  // reason when a legacy state record lacks it: `ARM_64` is the API's only
  // value, so an image created before this field existed already runs it.
  out.cpuArchitecture = MICROVM_CPU_ARCHITECTURE;
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

/** ACM certificate (us-east-1) - only present when a custom domain is configured. */
function certificateNode(): ResourceNode {
  return {
    id: 'acm-certificate',
    // Depends on the bucket so state (with the cert ARN) can be saved before the long
    // ISSUED wait - the id sorts before 'bucket', so without this it would run first.
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
        // RequestCertificate - an empty set here is that race, not "nothing to
        // validate". Acting on it would skip record creation entirely and the
        // issuance poll below could never succeed.
        initial = await pollUntil(
          () => ctx.clients.acm.describeCertificate(arn),
          (s) => s.status !== 'PENDING_VALIDATION' || s.validation.length > 0,
          { intervalMs: 5_000, timeoutMs: 5 * 60_000 },
        );
        if (initial.status === 'PENDING_VALIDATION' && initial.validation.length === 0) {
          throw new Error(
            'ACM returned no validation records for the certificate; re-run bootstrap',
          );
        }
      }
      if (initial.status !== 'ISSUED' && initial.validation.length > 0) {
        if (ctx.preview) {
          // Preview domain is a Route53 hosted zone - create the validation records for you.
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
      const id = await ctx.clients.cloudfront.createOriginAccessControl({
        name: ctx.names.oac,
        originType: 's3',
      });
      output(ctx, 'oac').id = id;
    },
    async delete(ctx) {
      const id = output(ctx, 'oac').id;
      if (typeof id === 'string') await ctx.clients.cloudfront.deleteOriginAccessControl(id);
    },
  };
}

/**
 * CloudFront Origin Access Control for the Web Function origin: `lambda` origin
 * type, `always-amz-auth` signing, so every distribution request to the
 * endpoint is SigV4-signed and the endpoint's resource policy can admit exactly
 * this distribution.
 */
function webOacNode(): ResourceNode {
  return {
    id: 'web-oac',
    dependsOn: [],
    title: 'CloudFront Web Function OAC',
    async read(ctx) {
      return typeof output(ctx, 'web-oac').id === 'string';
    },
    async create(ctx) {
      const id = await ctx.clients.cloudfront.createOriginAccessControl({
        name: ctx.names.webOac,
        originType: 'lambda',
        signingBehavior: 'always-amz-auth',
      });
      output(ctx, 'web-oac').id = id;
    },
    async delete(ctx) {
      const id = output(ctx, 'web-oac').id;
      if (typeof id === 'string') await ctx.clients.cloudfront.deleteOriginAccessControl(id);
    },
  };
}

/** The environment's SSR config. Web nodes only exist when it is set. */
function ssrConfig(ctx: OpsContext): SsrConfig {
  const config = ctx.config.ssr;
  if (!config) throw new Error('SSR node built for an environment without config.ssr');
  return config;
}

/** The name of the Web Function's single endpoint (route to its newest revision). */
const WEB_FUNCTION_ENDPOINT_NAME = 'site';
/** Where the CLI-owned placeholder package lives, inside the Lambda-read prefix. */
export const PLACEHOLDER_ARTIFACT_KEY = 'web/artifacts/placeholder.zip';

/**
 * The placeholder the Web Function serves until the first deploy: a tiny
 * CLI-owned server that listens on `AWS_LAMBDA_HTTP_ENDPOINT` and answers 503.
 * Zipped with a fixed timestamp so identical bytes never churn.
 */
export function placeholderPackageZip(): Uint8Array {
  const code =
    `import { createServer } from 'node:http';\n` +
    `const address = process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? '0.0.0.0:8080';\n` +
    `const index = address.lastIndexOf(':');\n` +
    `const host = address.slice(0, index);\n` +
    `const port = Number(address.slice(index + 1));\n` +
    `createServer((_req, res) => {\n` +
    `  res.writeHead(503, { 'content-type': 'text/plain' });\n` +
    `  res.end('blogwright: waiting for the first SSR deploy\\n');\n` +
    `}).listen(port, host);\n`;
  return createZip(
    { 'index.js': new TextEncoder().encode(code) },
    { mtime: REPRODUCIBLE_ZIP_MTIME },
  );
}

/**
 * The SSR cache policy's desired shape: cache only what the application marks
 * cacheable, key on every query string and exactly the operator-declared
 * headers, forward cookies without keying on them, and compress.
 */
function ssrCachePolicyInput(ctx: OpsContext) {
  return {
    name: ctx.names.ssrCachePolicy,
    comment: `${ctx.config.siteName} ${ctx.env} SSR responses`,
    minTtl: 0,
    defaultTtl: 0,
    maxTtl: 31_536_000,
    headerNames: ssrConfig(ctx).cacheKeyHeaders,
    queryStrings: 'all' as const,
    cookies: 'none' as const,
    gzip: true,
    brotli: true,
  };
}

/** Blogwright-managed CloudFront cache policy for the SSR default behavior. */
function webCachePolicyNode(): ResourceNode {
  return {
    id: 'web-cache-policy',
    dependsOn: [],
    title: 'CloudFront SSR cache policy',
    async read(ctx) {
      const id = output(ctx, 'web-cache-policy').id;
      if (typeof id !== 'string') return false;
      // Existence only: a policy that drifted from the config (a changed
      // `cacheKeyHeaders`) is `update`'s to converge. Reporting it absent would
      // send the graph to `create`, which CloudFront refuses for a taken name.
      return Boolean(await ctx.clients.cloudfront.getCachePolicy(id));
    },
    async create(ctx) {
      const { id } = await ctx.clients.cloudfront.createCachePolicy(ssrCachePolicyInput(ctx));
      output(ctx, 'web-cache-policy').id = id;
    },
    async update(ctx) {
      const id = output(ctx, 'web-cache-policy').id;
      if (typeof id !== 'string') return;
      const policy = await ctx.clients.cloudfront.getCachePolicy(id);
      if (!policy) return;
      if (ctx.clients.cloudfront.cachePolicyMatches(policy.config, ssrCachePolicyInput(ctx)))
        return;
      await ctx.clients.cloudfront.updateCachePolicy(id, ssrCachePolicyInput(ctx), policy.etag);
    },
    async delete(ctx) {
      const id = output(ctx, 'web-cache-policy').id;
      if (typeof id === 'string') await ctx.clients.cloudfront.deleteCachePolicy(id);
    },
  };
}

/** The `headers` config as the Blogwright-owned policy document. */
function responseHeadersPolicyInput(
  ctx: OpsContext,
  headers: ResponseHeadersConfig,
): ResponseHeadersPolicyConfigInput {
  return {
    name: ctx.names.responseHeadersPolicy,
    comment: `${ctx.config.siteName} ${ctx.env} response headers`,
    headers,
  };
}

const RESPONSE_HEADERS_POLICY = 'response-headers-policy';

/**
 * What state records about the policy: its id, the distribution a bootstrap
 * last attached it to, and whether it is detached with only its deletion left.
 */
interface ResponseHeadersPolicyRecord {
  id: string;
  attachedTo: string | undefined;
  pendingDelete: boolean;
}

/** Read without `output()`, which would record an empty entry for a policy that never existed. */
function responseHeadersPolicyRecord(ctx: OpsContext): ResponseHeadersPolicyRecord | undefined {
  const record = ctx.state.resources[RESPONSE_HEADERS_POLICY];
  if (typeof record?.id !== 'string') return undefined;
  return {
    id: record.id,
    attachedTo: typeof record.attachedTo === 'string' ? record.attachedTo : undefined,
    pendingDelete: record.pendingDelete === true,
  };
}

function recordedResponseHeadersPolicyId(ctx: OpsContext): string | undefined {
  return responseHeadersPolicyRecord(ctx)?.id;
}

/** Replace the record whole, so a new state never inherits an earlier flag. */
function recordResponseHeadersPolicy(
  ctx: OpsContext,
  record: Record<string, string | boolean>,
): void {
  ctx.state.resources[RESPONSE_HEADERS_POLICY] = record;
}

function forgetResponseHeadersPolicy(ctx: OpsContext): void {
  delete ctx.state.resources[RESPONSE_HEADERS_POLICY];
}

/** The policy every cache behavior should carry: the configured, created one - or none. */
function desiredResponseHeadersPolicyId(ctx: OpsContext): string | undefined {
  return ctx.config.headers ? recordedResponseHeadersPolicyId(ctx) : undefined;
}

/**
 * Record that the configured policy is on the distribution's behaviors, which
 * is what lets `deploy` tell an attached policy from one an interrupted
 * bootstrap created but never attached - without any distribution read.
 */
function recordResponseHeadersPolicyAttached(ctx: OpsContext, distributionId: string): void {
  const policyId = desiredResponseHeadersPolicyId(ctx);
  if (policyId !== undefined) {
    recordResponseHeadersPolicy(ctx, { id: policyId, attachedTo: distributionId });
  }
}

/**
 * Send a create or update, translating CloudFront's refusal of an adjustable
 * quota - which config load leaves alone, since an account may have raised it
 * - into what to change.
 */
async function withResponseHeadersQuotas<T>(
  headers: ResponseHeadersConfig,
  send: () => Promise<T>,
): Promise<T> {
  try {
    return await send();
  } catch (cause) {
    const code = cause instanceof AwsError ? cause.code : '';
    if (code === 'TooManyCustomHeadersInResponseHeadersPolicy') {
      throw new Error(
        `config.headers.custom lists ${headers.custom.length} headers, more than this account's ` +
          `CloudFront quota of custom headers per response headers policy ` +
          `(${CUSTOM_RESPONSE_HEADERS_DEFAULT_QUOTA} by default): list fewer, or request a ` +
          'higher quota in Service Quotas',
        { cause },
      );
    }
    if (code === 'TooLongCSPInResponseHeadersPolicy') {
      const length = headers.security.contentSecurityPolicy?.length ?? 0;
      throw new Error(
        `config.headers.security.contentSecurityPolicy is ${length} characters, over this ` +
          `account's CloudFront quota for its length (${CONTENT_SECURITY_POLICY_DEFAULT_QUOTA} ` +
          'by default): shorten it, or request a higher quota in Service Quotas',
        { cause },
      );
    }
    throw cause;
  }
}

/**
 * Bring a live policy's headers in line with the config, in place: the policy
 * id - and with it every behavior's association - is unchanged, so this needs
 * no distribution update. `missing` means the recorded policy is gone.
 */
async function convergeResponseHeadersPolicy(
  ctx: OpsContext,
  id: string,
  headers: ResponseHeadersConfig,
): Promise<'updated' | 'current' | 'missing'> {
  const desired = responseHeadersPolicyInput(ctx, headers);
  const policy = await ctx.clients.cloudfront.getResponseHeadersPolicy(id);
  if (!policy) return 'missing';
  if (ctx.clients.cloudfront.responseHeadersPolicyMatches(policy.config, desired)) {
    ctx.logger.ok('response headers up to date');
    return 'current';
  }
  await withResponseHeadersQuotas(headers, () =>
    ctx.clients.cloudfront.updateResponseHeadersPolicy(id, desired, policy.etag),
  );
  ctx.logger.ok('updated the response headers policy');
  return 'updated';
}

/**
 * Create the policy, or adopt the one an interrupted run created under the
 * same derived name but never recorded: CloudFront refuses a second policy of
 * that name, and policy names are unique per account.
 */
async function createOrAdoptResponseHeadersPolicy(
  ctx: OpsContext,
  headers: ResponseHeadersConfig,
): Promise<void> {
  const input = responseHeadersPolicyInput(ctx, headers);
  let id: string;
  try {
    id = await withResponseHeadersQuotas(headers, () =>
      ctx.clients.cloudfront.createResponseHeadersPolicy(input),
    );
  } catch (err) {
    if (!(err instanceof AwsError && err.code === 'ResponseHeadersPolicyAlreadyExists')) throw err;
    const existing = await ctx.clients.cloudfront.findResponseHeadersPolicyId(input.name);
    if (existing === undefined) throw err;
    recordResponseHeadersPolicy(ctx, { id: existing });
    ctx.logger.ok(
      `adopted response headers policy ${input.name} (${existing}), left by an earlier run`,
    );
    await convergeResponseHeadersPolicy(ctx, existing, headers);
    return;
  }
  recordResponseHeadersPolicy(ctx, { id });
}

/**
 * CloudFront refused to delete a policy just detached from this site's
 * distribution. Either it has not caught up with the detach - the next
 * bootstrap deletes it - or another distribution uses the policy, which no
 * bootstrap of this site can change: that is said once, and the policy is
 * left to its other user rather than retried forever.
 */
async function reportResponseHeadersPolicyInUse(
  ctx: OpsContext,
  policyId: string,
  distributionId: string | undefined,
): Promise<void> {
  const others = (
    await ctx.clients.cloudfront.listDistributionIdsUsingResponseHeadersPolicy(policyId)
  ).filter((id) => id !== distributionId);
  if (others.length > 0) {
    forgetResponseHeadersPolicy(ctx);
    ctx.logger.warn(
      `response headers policy ${policyId} is detached from this site's distribution but is ` +
        `also attached to ${others.join(', ')}, so it was not deleted. Blogwright no longer ` +
        'manages it: if those distributions do not need it, detach it from them and delete it ' +
        'in the CloudFront console',
    );
    return;
  }
  recordResponseHeadersPolicy(ctx, { id: policyId, pendingDelete: true });
  ctx.logger.warn(
    `response headers policy ${policyId} is detached from the distribution, but CloudFront has ` +
      'not released it yet, so it was not deleted; the next bootstrap deletes it',
  );
}

/**
 * `headers` was removed: detach the policy from the distribution, then delete
 * it. A policy already gone from AWS only leaves its record to clear.
 */
async function retireResponseHeadersPolicy(ctx: OpsContext, policyId: string): Promise<void> {
  if (!(await ctx.clients.cloudfront.getResponseHeadersPolicy(policyId))) {
    forgetResponseHeadersPolicy(ctx);
    ctx.logger.ok(`response headers policy ${policyId} no longer exists; cleared its record`);
    return;
  }
  const distributionId = ctx.state.resources['cloudfront-distribution']?.id;
  const ownDistribution = typeof distributionId === 'string' ? distributionId : undefined;
  if (ownDistribution !== undefined) {
    const detached = await ctx.clients.cloudfront.detachResponseHeadersPolicy(
      ownDistribution,
      policyId,
    );
    if (detached) ctx.logger.ok('detached the response headers policy from the distribution');
  }
  try {
    await ctx.clients.cloudfront.deleteResponseHeadersPolicy(policyId);
  } catch (err) {
    if (err instanceof AwsError && err.code === 'ResponseHeadersPolicyInUse') {
      await reportResponseHeadersPolicyInUse(ctx, policyId, ownDistribution);
      return;
    }
    throw err;
  }
  forgetResponseHeadersPolicy(ctx);
  ctx.logger.ok('deleted the response headers policy (config.headers was removed)');
}

/**
 * The Blogwright-owned response headers policy (`<prefix>-headers`) carrying
 * the `headers` config. Created before the distribution so a new distribution
 * is born with it attached; a later config change updates it in place.
 * In the graph whenever `headers` is configured or a policy is recorded, so
 * removing the key retires the policy and `destroy` deletes it.
 */
function responseHeadersPolicyNode(): ResourceNode {
  return {
    id: RESPONSE_HEADERS_POLICY,
    dependsOn: [],
    title: 'CloudFront response headers policy',
    async read(ctx) {
      const id = recordedResponseHeadersPolicyId(ctx);
      if (id === undefined) return false;
      // Unconfigured, there is nothing to create: `update` retires the record,
      // whether or not the policy is still in AWS.
      if (!ctx.config.headers) return true;
      // Existence only: changed headers are `update`'s to converge. Reporting
      // the policy absent would send the graph to `create`, which CloudFront
      // refuses for a taken name.
      return Boolean(await ctx.clients.cloudfront.getResponseHeadersPolicy(id));
    },
    async create(ctx) {
      const headers = ctx.config.headers;
      // `read` reports a recorded policy present whenever `headers` is unset,
      // and the node is only in the graph when one of the two holds.
      if (!headers)
        throw new Error('the response headers policy is created only from config.headers');
      await createOrAdoptResponseHeadersPolicy(ctx, headers);
    },
    async update(ctx) {
      const id = recordedResponseHeadersPolicyId(ctx);
      if (id === undefined) return;
      const headers = ctx.config.headers;
      if (headers) await convergeResponseHeadersPolicy(ctx, id, headers);
      else await retireResponseHeadersPolicy(ctx, id);
    },
    async delete(ctx) {
      const id = recordedResponseHeadersPolicyId(ctx);
      if (id !== undefined) await ctx.clients.cloudfront.deleteResponseHeadersPolicy(id);
    },
  };
}

/** What `deploy` says about a policy whose `headers` key was removed. */
function retiredHeadersWarning(record: ResponseHeadersPolicyRecord, bootstrap: string): string {
  if (record.pendingDelete) {
    return (
      `config.headers was removed and response headers policy ${record.id} is already ` +
      `detached from the distribution; run \`${bootstrap}\` to delete it`
    );
  }
  if (record.attachedTo !== undefined) {
    return (
      `config.headers was removed but response headers policy ${record.id} is still attached ` +
      `to the distribution; run \`${bootstrap}\` to detach and delete it`
    );
  }
  return `config.headers was removed; run \`${bootstrap}\` to delete response headers policy ${record.id}`;
}

/**
 * The deploy-time half of the `headers` reconcile: converge the recorded
 * policy's headers in place. Attaching, detaching, creating and deleting the
 * policy change the distribution, which stays a `bootstrap` action (the CI
 * deploy role cannot update the distribution), so those cases warn with the
 * command that applies them instead. Whether the policy is attached comes from
 * the record bootstrap keeps, so the deploy role needs no distribution read.
 */
export async function reconcileResponseHeadersOnDeploy(ctx: OpsContext): Promise<void> {
  const headers = ctx.config.headers;
  const record = responseHeadersPolicyRecord(ctx);
  const bootstrap = `blogwright bootstrap ${ctx.env}`;
  if (!headers) {
    if (record) ctx.logger.warn(retiredHeadersWarning(record, bootstrap));
    return;
  }
  if (!record) {
    ctx.logger.warn(
      `config.headers is set but no response headers policy exists yet; ` +
        `run \`${bootstrap}\` to create it and attach it to the distribution`,
    );
    return;
  }
  const distributionId = ctx.state.resources['cloudfront-distribution']?.id;
  if (record.attachedTo === undefined || record.attachedTo !== distributionId) {
    ctx.logger.warn(
      `response headers policy ${record.id} is not attached to the distribution, so no ` +
        `response carries its headers yet; run \`${bootstrap}\` to attach it`,
    );
    return;
  }
  if ((await convergeResponseHeadersPolicy(ctx, record.id, headers)) === 'missing') {
    ctx.logger.warn(
      `response headers policy ${record.id} no longer exists; run \`${bootstrap}\` to recreate it`,
    );
  }
}

/**
 * Merge one named statement into the bucket's policy, preserving every other
 * statement - so `bucket-policy`'s `AllowCloudFrontRead` and
 * `web-code-bucket-policy`'s `AllowLambdaWebFunctionCodeAccess` are separate
 * Sids, each re-applied by its own node without disturbing the other.
 */
async function mergeBucketPolicyStatement(
  ctx: OpsContext,
  sid: string,
  statement: object,
): Promise<void> {
  const current = await ctx.clients.s3.getBucketPolicy(ctx.names.bucket);
  let statements: object[] = [];
  if (current) {
    try {
      const parsed = JSON.parse(current) as { Statement?: object[] };
      if (Array.isArray(parsed.Statement)) statements = parsed.Statement;
    } catch {
      // A corrupt policy is rewritten from the statements this stack owns.
    }
  }
  const kept = statements.filter((s) => (s as { Sid?: string }).Sid !== sid);
  await ctx.clients.s3.putBucketPolicy(
    ctx.names.bucket,
    JSON.stringify({ Version: '2012-10-17', Statement: [...kept, statement] }),
  );
}

/** The Lambda-read statement: this function's revisions may read the artifact prefix. */
function webCodeBucketPolicyStatement(ctx: OpsContext): object {
  return {
    Sid: 'AllowLambdaWebFunctionCodeAccess',
    Effect: 'Allow',
    Principal: { Service: 'lambda.amazonaws.com' },
    Action: ['s3:GetObject', 's3:GetObjectVersion'],
    Resource: `arn:aws:s3:::${ctx.names.bucket}/web/artifacts/*`,
    Condition: {
      ArnLike: {
        // Scoped to THIS function's revisions, so no other account's function can
        // have Lambda read this bucket on its behalf. The ARN is derivable from
        // the function name, so the statement can be written before it exists.
        'AWS:SourceArn': `arn:aws:lambda:${ctx.config.region}:${ctx.accountId}:web-function/${ctx.names.webFunction}/revision/*`,
      },
    },
  };
}

/** Bucket statement granting Lambda read on the revision artifact prefix. */
function webCodeBucketPolicyNode(): ResourceNode {
  return {
    id: 'web-code-bucket-policy',
    dependsOn: ['bucket'],
    title: 'S3 bucket policy (Web Function code)',
    async read() {
      // Always reconcile: tracks the function's derived revision ARN.
      return false;
    },
    async create(ctx) {
      await mergeBucketPolicyStatement(
        ctx,
        'AllowLambdaWebFunctionCodeAccess',
        webCodeBucketPolicyStatement(ctx),
      );
      output(ctx, 'web-code-bucket-policy').applied = true;
    },
    async delete() {
      // Removed together with the bucket during destroy.
    },
  };
}

/**
 * Retry bound for the two things that lag a just-created resource: IAM has not
 * finished making the execution role assumable, and the bucket policy has not
 * propagated so Lambda cannot read the placeholder artifact. Both surface as a
 * 400/403 naming the role or the S3 action; anything else is thrown at once.
 */
const WEB_FUNCTION_PROPAGATION_ERROR =
  /cannot be assumed by|unable to assume role|not authorized to perform: s3:GetObject/i;

function whileWebFunctionPropagating<T>(call: () => Promise<T>): Promise<T> {
  return withRetry(call, {
    attempts: 15,
    baseDelayMs: 1_000,
    maxDelayMs: 5_000,
    retryable: (err) =>
      err instanceof AwsError &&
      (err.statusCode === 400 || err.statusCode === 403) &&
      WEB_FUNCTION_PROPAGATION_ERROR.test(err.message),
  });
}

/** True for the conflict a same-named function already existing produces. */
function isFunctionConflict(err: unknown): boolean {
  return err instanceof AwsError && /Conflict|AlreadyExists|ResourceInUse/i.test(err.code);
}

/** Record an endpoint's identity in the function node's outputs. */
function recordEndpoint(ctx: OpsContext, endpoint: WebFunctionEndpoint): void {
  const out = output(ctx, 'web-function');
  out.endpointName = endpoint.endpointName;
  if (endpoint.endpointArn) out.endpointArn = endpoint.endpointArn;
  if (endpoint.domainName) out.endpointDomainName = endpoint.domainName;
}

/** Ensure the function's `site` endpoint exists, and record its identity. */
async function ensureWebFunctionEndpoint(ctx: OpsContext): Promise<void> {
  const name = ctx.names.webFunction;
  const existing = await ctx.clients.lambdaWeb.getWebFunctionEndpoint(
    name,
    WEB_FUNCTION_ENDPOINT_NAME,
  );
  const endpoint =
    existing ??
    (await ctx.clients.lambdaWeb.createWebFunctionEndpoint({
      functionName: name,
      endpointName: WEB_FUNCTION_ENDPOINT_NAME,
      endpointType: 'HomeRegion',
      authType: 'IamAuth',
      autoDeploymentMode: 'LatestRevision',
    }));
  recordEndpoint(ctx, endpoint);
  if (!existing && endpoint.domainName) {
    ctx.logger.info(`  endpoint: https://${endpoint.domainName}`);
  }
}

/**
 * The Web Function itself, with its placeholder revision and `site` endpoint.
 * Bootstrap never cuts a real revision: the endpoint converges to whatever the
 * first deploy creates.
 */
function webFunctionNode(): ResourceNode {
  return {
    id: 'web-function',
    dependsOn: ['bucket', 'iam-web-role', 'web-code-bucket-policy'],
    title: 'Lambda Web Function',
    async read(ctx) {
      const name = ctx.names.webFunction;
      const fn = await ctx.clients.lambdaWeb.getWebFunction(name);
      if (!fn) return false;
      const out = output(ctx, 'web-function');
      out.name = name;
      if (fn.functionArn) out.arn = fn.functionArn;
      const endpoint = await ctx.clients.lambdaWeb.getWebFunctionEndpoint(
        name,
        WEB_FUNCTION_ENDPOINT_NAME,
      );
      if (endpoint) recordEndpoint(ctx, endpoint);
      return true;
    },
    async create(ctx) {
      const name = ctx.names.webFunction;
      const config = ssrConfig(ctx);
      const out = output(ctx, 'web-function');
      // The placeholder must be in the prefix the Lambda-read bucket statement
      // covers BEFORE the function is created: Lambda checks its own read access
      // when it creates the initial revision and rejects the request otherwise.
      const version = await ctx.clients.s3.putObject(
        ctx.names.bucket,
        PLACEHOLDER_ARTIFACT_KEY,
        placeholderPackageZip(),
        'application/zip',
      );
      const s3Object = {
        bucket: ctx.names.bucket,
        key: PLACEHOLDER_ARTIFACT_KEY,
        ...(version ? { versionId: version } : {}),
      };
      let fn;
      try {
        fn = await whileWebFunctionPropagating(() =>
          ctx.clients.lambdaWeb.createWebFunction({
            functionName: name,
            revisionConfig: {
              // Never `blogwright:<fingerprint>`: a deploy must not mistake the
              // placeholder for a revision it already published.
              description: 'blogwright:placeholder',
              buildConfig: {
                codeConfig: { s3Object },
                runtimeConfig: { runtime: WEB_FUNCTION_RUNTIME },
              },
              serviceConfig: {
                executionRoleArn: String(output(ctx, 'iam-web-role').arn),
                timeoutSeconds: config.timeoutSeconds,
                maxConcurrencyPerEnvironment: config.maxConcurrencyPerEnvironment,
                environmentVariables: { NODE_ENV: 'production', ...config.env },
                telemetryConfig: { loggingConfig: { logGroup: ctx.names.webLogGroup } },
              },
            },
            endpointConfig: {
              endpointName: WEB_FUNCTION_ENDPOINT_NAME,
              endpointType: 'HomeRegion',
              authType: 'IamAuth',
              autoDeploymentMode: 'LatestRevision',
            },
            tags: ctx.tags,
          }),
        );
      } catch (err) {
        // A crashed earlier bootstrap can leave a function AWS has and state does
        // not. When the name is taken by this site's function, adopt it instead of
        // failing the whole bootstrap; a foreign function's conflict still surfaces.
        if (!isFunctionConflict(err)) throw err;
        fn = await ctx.clients.lambdaWeb.getWebFunction(name);
        if (!fn) throw err;
        ctx.logger.ok(`adopted existing web function ${name} (created by an earlier run)`);
      }
      // Record the ARN before the endpoint: a crash in between still leaves the
      // function destroyable.
      out.name = name;
      if (fn.functionArn) out.arn = fn.functionArn;
      if (fn.revision?.revisionId) out.placeholderRevisionId = fn.revision.revisionId;
      if (fn.endpoint) {
        // Create returns the initial endpoint, so a fresh bootstrap needs no
        // second round trip to learn the domain it just made.
        recordEndpoint(ctx, fn.endpoint);
        await ctx.save();
      } else {
        await ctx.save();
        await ensureWebFunctionEndpoint(ctx);
      }
    },
    async update(ctx) {
      await ensureWebFunctionEndpoint(ctx);
    },
    async delete(ctx) {
      // Deleting the function removes its revisions and endpoints with it.
      await ctx.clients.lambdaWeb.deleteWebFunction(ctx.names.webFunction);
    },
  };
}

/** The resource-policy statement admitting exactly this distribution. */
function webFunctionPolicyStatement(ctx: OpsContext): object {
  return {
    Sid: 'AllowCloudFrontOACAccess',
    Effect: 'Allow',
    Principal: { Service: 'cloudfront.amazonaws.com' },
    Action: 'lambda:InvokeWebFunctionEndpoint',
    Resource: String(output(ctx, 'web-function').endpointArn),
    Condition: { ArnLike: { 'AWS:SourceArn': String(output(ctx, 'cloudfront-distribution').arn) } },
  };
}

function webFunctionPolicyNode(): ResourceNode {
  return {
    id: 'web-function-policy',
    dependsOn: ['web-function', 'cloudfront-distribution'],
    title: 'Web Function resource policy',
    async read(ctx) {
      const functionArn = String(output(ctx, 'web-function').arn);
      const current = await ctx.clients.lambdaWeb.getResourcePolicy(functionArn);
      if (!current?.policy) return false;
      try {
        const parsed = JSON.parse(current.policy) as { Statement?: object[] };
        const existing = (parsed.Statement ?? []).find(
          (s) => (s as { Sid?: string }).Sid === 'AllowCloudFrontOACAccess',
        );
        return JSON.stringify(existing) === JSON.stringify(webFunctionPolicyStatement(ctx));
      } catch {
        return false;
      }
    },
    async create(ctx) {
      const functionArn = String(output(ctx, 'web-function').arn);
      const current = await ctx.clients.lambdaWeb.getResourcePolicy(functionArn);
      let statements: object[] = [];
      if (current?.policy) {
        try {
          const parsed = JSON.parse(current.policy) as { Statement?: object[] };
          if (Array.isArray(parsed.Statement)) statements = parsed.Statement;
        } catch {
          // Rewrite from the statement this stack owns.
        }
      }
      const kept = statements.filter(
        (s) => (s as { Sid?: string }).Sid !== 'AllowCloudFrontOACAccess',
      );
      const result = await ctx.clients.lambdaWeb.putResourcePolicy(
        functionArn,
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [...kept, webFunctionPolicyStatement(ctx)],
        }),
      );
      const out = output(ctx, 'web-function-policy');
      out.applied = true;
      if (result.revisionId) out.revisionId = result.revisionId;
    },
    async delete() {
      // Deleting the function removes its resource policy with it.
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
 * origin is the private REST endpoint (via OAC), which - unlike an S3 website endpoint -
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
 * is confirmed by CallerReference - comments are editable in the console, while the
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

/** `static` unless the environment's config carries an `ssr` block. */
function servingMode(ctx: OpsContext): 'static' | 'ssr' {
  return ctx.config.ssr ? 'ssr' : 'static';
}

/**
 * The distribution shape Blogwright owns for a mode. Static mode renders
 * exactly the single-origin, single-behavior document the builder has always
 * produced; SSR mode adds the Web Function origin and the per-behavior
 * policies the serving contract specifies.
 */
function distributionShape(
  ctx: OpsContext,
  mode: 'static' | 'ssr',
  preview: boolean,
): DistributionConfigInput {
  const s3Origin: DistributionOriginInput = {
    id: 's3-site',
    domainName: `${ctx.names.bucket}.s3.${ctx.config.region}.amazonaws.com`,
    // Preview: function rewrites the full path, so the origin path is the bucket root.
    originPath: preview ? '' : '/site',
    kind: 's3',
    originAccessControlId: String(output(ctx, 'oac').id),
  };
  const shared = {
    callerReference: `${ctx.names.prefix}-${ctx.accountId}`,
    comment: `${ctx.config.siteName} ${ctx.env}`,
    aliases: ctx.domain ? [preview ? `*.${ctx.domain}` : ctx.domain] : [],
    acmCertificateArn: ctx.domain ? String(output(ctx, 'acm-certificate').arn) : undefined,
  };
  const responseHeadersPolicyId = desiredResponseHeadersPolicyId(ctx);

  if (mode === 'ssr') {
    const config = ssrConfig(ctx);
    return {
      ...shared,
      // The app answers `/`; a root object would only intercept it.
      defaultRootObject: '',
      origins: [
        s3Origin,
        {
          id: 'web-function',
          domainName: String(output(ctx, 'web-function').endpointDomainName),
          originPath: '',
          kind: 'web-function',
          originAccessControlId: String(output(ctx, 'web-oac').id),
          // Streamed responses must not be cut at CloudFront's 30-second default.
          originReadTimeoutSeconds: 60,
        },
      ],
      defaultBehavior: {
        targetOriginId: 'web-function',
        cachePolicyId: String(output(ctx, 'web-cache-policy').id),
        originRequestPolicyId: ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
        responseHeadersPolicyId,
      },
      // The static paths carry the headers too: they are the same site's responses.
      orderedBehaviors: config.staticPaths.map((pathPattern) => ({
        pathPattern,
        targetOriginId: 's3-site',
        cachePolicyId: CACHING_OPTIMIZED,
        responseHeadersPolicyId,
      })),
      // No custom error responses: the application owns 404s, and error
      // responses are distribution-wide, so the static behaviors have none either.
    };
  }

  return {
    ...shared,
    defaultRootObject: ctx.config.defaultRootObject,
    origins: [s3Origin],
    defaultBehavior: {
      targetOriginId: 's3-site',
      // Previews are served uncached (per-PR content, host-routed); staging/production
      // keep the default cache policy.
      cachePolicyId: preview ? CACHING_DISABLED : CACHING_OPTIMIZED,
      functionArn: String(output(ctx, 'cloudfront-function').arn),
      responseHeadersPolicyId,
    },
    // Non-preview stacks map the S3 REST origin's 403/404 (a missing key) to the
    // site's 404 page - or, in SPA mode, to /index.html with a 200 so
    // client-side routes deep-link correctly.
    ...(preview
      ? {}
      : {
          customErrorResponses: [403, 404].map((errorCode) => ({
            errorCode,
            responsePagePath: ctx.config.spa ? '/index.html' : '/404.html',
            responseCode: ctx.config.spa ? 200 : 404,
          })),
        }),
  };
}

/** Which optional resources the distribution's graph node depends on. */
interface DistributionNodeOptions {
  hasDomain: boolean;
  preview: boolean;
  ssr: boolean;
  /** The response headers policy node is in the graph. */
  responseHeaders: boolean;
}

/**
 * Attach the configured response headers policy on a static stack, whose
 * other distribution settings stay creation-time. With no policy to attach
 * the distribution is left alone, so a policy attached by hand survives; with
 * one, a behavior carrying a hand-attached policy is refused, not overwritten
 * (`attachResponseHeadersPolicy` in core says how to resolve it).
 */
async function attachResponseHeadersPolicy(ctx: OpsContext, distributionId: string): Promise<void> {
  const policyId = desiredResponseHeadersPolicyId(ctx);
  if (policyId === undefined) return;
  const attached = await ctx.clients.cloudfront.attachResponseHeadersPolicy(
    distributionId,
    policyId,
  );
  recordResponseHeadersPolicyAttached(ctx, distributionId);
  ctx.logger.ok(
    attached
      ? 'attached the response headers policy to the distribution'
      : 'response headers policy already attached',
  );
}

/**
 * A domain added (or changed) after the first bootstrap must reach the
 * existing distribution - the certificate node validates the cert, but only
 * this reconcile attaches the alias + viewer certificate.
 */
async function reconcileStaticAliases(
  ctx: OpsContext,
  distributionId: string,
  preview: boolean,
): Promise<void> {
  if (!ctx.domain) {
    // Deliberately no automatic alias removal: dropping --domain from a
    // later run must not detach a live site's hostname.
    ctx.logger.ok('no domain configured - existing aliases left as-is');
    return;
  }
  const alias = preview ? `*.${ctx.domain}` : ctx.domain;
  const certArn = String(output(ctx, 'acm-certificate').arn);
  const changed = await ctx.clients.cloudfront.setDistributionAliases(
    distributionId,
    [alias],
    certArn,
  );
  if (changed) {
    ctx.logger.ok(`attached ${alias} to the distribution`);
    const domainName = output(ctx, 'cloudfront-distribution').domainName;
    if (typeof domainName === 'string') {
      ctx.logger.info(`  point ${alias} (CNAME/ALIAS) at ${domainName}`);
    }
  } else {
    ctx.logger.ok('aliases up to date');
  }
}

/** The CloudFront distribution. Preview stacks use a host-routing function + no caching. */
function distributionNode(options: DistributionNodeOptions): ResourceNode {
  const { hasDomain, preview, ssr, responseHeaders } = options;
  const dependsOn = [
    'bucket',
    'oac',
    'cloudfront-function',
    ...(hasDomain ? ['acm-certificate'] : []),
    // The SSR shapes read the function's endpoint domain, the `lambda` OAC and
    // the cache policy, so all three must exist first.
    ...(ssr ? ['web-function', 'web-oac', 'web-cache-policy'] : []),
    // Every shape carries the policy's id, and a removed `headers` key must
    // detach the policy before the shape stops naming it.
    ...(responseHeaders ? ['response-headers-policy'] : []),
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
      // An adopted orphan carries whatever shape its own run gave it, so only a
      // distribution created here is known to carry the response headers policy.
      let createdFromShape = true;
      try {
        dist = await ctx.clients.cloudfront.createDistribution(
          distributionShape(ctx, servingMode(ctx), preview),
        );
      } catch (err) {
        // A crashed earlier bootstrap can leave a distribution in AWS that state never
        // recorded. Retrying then 409s on the duplicate alias - CloudFront's CNAME
        // conflict check fires before the CallerReference idempotency match - so adopt
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
        createdFromShape = false;
      }
      if (createdFromShape) recordResponseHeadersPolicyAttached(ctx, dist.id);
      const out = output(ctx, 'cloudfront-distribution');
      out.id = dist.id;
      out.arn = dist.arn;
      out.domainName = dist.domainName;
      // The mode the live distribution was left serving, so a later bootstrap can
      // tell a routine re-run from a serving cutover.
      out.mode = servingMode(ctx);
      await ctx.clients.cloudfront.tagResource(dist.arn, ctx.tags);
      ctx.logger.info(`  CloudFront domain: ${dist.domainName}`);
      if (ctx.domain && !preview) {
        // Preview stacks create the wildcard record themselves (preview-dns
        // node, next in the graph); only the main site may be DNS'd elsewhere.
        ctx.logger.info(`  point ${ctx.domain} (CNAME/ALIAS) at ${dist.domainName}`);
      }
    },
    async update(ctx) {
      const id = output(ctx, 'cloudfront-distribution').id;
      if (typeof id !== 'string') return;
      const configured = servingMode(ctx);
      const out = output(ctx, 'cloudfront-distribution');
      const recorded = out.mode === 'ssr' || out.mode === 'static' ? out.mode : undefined;
      // Full reconcile on every SSR bootstrap (so a later config change converges)
      // and on either side of a mode switch (so the origins/behaviors move with the
      // mode). A static stack that stays static keeps the narrow updates below -
      // aliases and the response headers policy: `spa` and `defaultRootObject`
      // remain creation-time settings there.
      if (configured === 'ssr' || (recorded !== undefined && recorded !== configured)) {
        const changed = await ctx.clients.cloudfront.reconcileDistribution(
          id,
          distributionShape(ctx, configured, preview),
        );
        out.mode = configured;
        recordResponseHeadersPolicyAttached(ctx, id);
        if (changed) {
          ctx.logger.ok(`reconciled the distribution for ${configured} serving`);
          const domainName = out.domainName;
          if (ctx.domain && !preview && typeof domainName === 'string') {
            ctx.logger.info(`  point ${ctx.domain} (CNAME/ALIAS) at ${domainName}`);
          }
        } else {
          ctx.logger.ok(`distribution already matches ${configured} serving`);
        }
        return;
      }
      await reconcileStaticAliases(ctx, id, preview);
      await attachResponseHeadersPolicy(ctx, id);
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

/**
 * True when `delivery` is the one this site's node created. AWS permits exactly
 * one delivery source per distribution, so the analytics plugin necessarily
 * hangs its own delivery off the site's source: ownership is the destination a
 * delivery feeds, and nothing else. The final `:`-separated segment of a
 * `delivery-destination` ARN is its name, which is derived from the environment
 * (`deriveNames`) and therefore also matches the previous stack's delivery on a
 * destroy → bootstrap cycle - exactly the delivery the ConflictException retry
 * exists to remove.
 *
 * Position cannot stand in for this (`findDeliveryIdBySource` takes whichever
 * delivery AWS lists first), and neither can the recorded `destination` output:
 * it is empty precisely when the retry needs it, because `putDeliverySource`
 * throws the Conflict before `putDeliveryDestination` ever runs.
 */
function isOwnDelivery(delivery: DeliverySummary, destinationName: string): boolean {
  return delivery.deliveryDestinationArn.split(':').pop() === destinationName;
}

/**
 * The ids of the site's own deliveries on `names.deliverySource`, after
 * refusing outright when the shared source carries a delivery the site did not
 * create. Both the `delete()` teardown and the ConflictException retry call
 * this BEFORE deleting anything: each of them goes on to delete the delivery
 * source, and AWS rejects that while another delivery is attached - a refusal
 * `deleteDeliverySource` does not catch (it swallows only not-found). Refusing
 * up front turns a teardown that throws part-way, after the site's own delivery
 * is already gone, into an actionable stop with nothing removed.
 */
async function ownDeliveryIdsOrRefuse(ctx: OpsContext): Promise<string[]> {
  const deliveries = await ctx.clients.logsUsEast1.deliveriesForSource(ctx.names.deliverySource);
  const foreign = deliveries.filter((d) => !isOwnDelivery(d, ctx.names.deliveryDestination));
  if (foreign.length > 0) {
    const listed = foreign
      .map((d) => `${d.id} (destination ${d.deliveryDestinationArn})`)
      .join(', ');
    throw new Error(
      `delivery source ${ctx.names.deliverySource} still carries ` +
        `${foreign.length === 1 ? 'a delivery' : `${foreign.length} deliveries`} this site does ` +
        `not own (${listed}); removing the source would break whoever does. Tear that stack ` +
        `down first, then retry: blogwright analytics destroy ${ctx.env} --yes`,
    );
  }
  // Filtered, not `deliveries.map(...)`: the throw above already guarantees every
  // delivery here is the site's own, but that is a non-local guarantee. Re-applying
  // the predicate makes the name and the body agree on their own, so softening the
  // refusal cannot silently start feeding foreign ids to the delete loop.
  return deliveries.filter((d) => isOwnDelivery(d, ctx.names.deliveryDestination)).map((d) => d.id);
}

/**
 * The Web Function's execution role: logging and nothing else. It may create
 * streams in, and put events to, its own two log groups - both of which are
 * graph nodes, so no `logs:CreateLogGroup` grant is needed.
 */
async function applyWebRolePolicy(ctx: OpsContext): Promise<void> {
  await ctx.clients.iam.putRolePolicy(ctx.names.webRole, 'web', {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: [
          logGroupArn(ctx, ctx.names.webLogGroup),
          logGroupArn(ctx, ctx.names.webLocalLogGroup),
        ],
      },
    ],
  });
}

/** IAM role the Lambda Web Function assumes; logging only, by contract. */
function webRoleNode(): ResourceNode {
  return {
    id: 'iam-web-role',
    dependsOn: ['web-log-group', 'web-local-log-group'],
    title: 'IAM Web Function role',
    async read(ctx) {
      const arn = await ctx.clients.iam.getRoleArn(ctx.names.webRole);
      if (arn) output(ctx, 'iam-web-role').arn = arn;
      return Boolean(arn);
    },
    async create(ctx) {
      const arn = await ctx.clients.iam.ensureRole(
        ctx.names.webRole,
        LAMBDA_TRUST,
        `Runtime role for the ${ctx.config.siteName} Web Function`,
        ctx.tags,
      );
      await applyWebRolePolicy(ctx);
      output(ctx, 'iam-web-role').arn = arn;
    },
    async update(ctx) {
      await applyWebRolePolicy(ctx);
    },
    async delete(ctx) {
      await ctx.clients.iam.deleteRole(ctx.names.webRole);
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
        // refuses to repoint an existing source at a new distribution ARN - so a
        // destroy → bootstrap cycle hits ConflictException here. Remove the stale
        // delivery/source/destination trio and retry once.
        if (!(err instanceof AwsError && /Conflict/i.test(err.code))) throw err;
        ctx.logger.step('stale log delivery from a previous stack - removing and retrying');
        // Refuse before deleting anything when the source is shared: removing it
        // IS the retry (PutDeliverySource will not repoint a source that still
        // exists), so a foreign delivery forecloses the retry entirely. Deleting
        // only the site's own delivery and pressing on would leave the stack with
        // no CloudWatch delivery and a failed bootstrap - worse than the conflict
        // being healed. Only the site's own ids are removed here; the old loop
        // deleted every delivery on the source, silently unwiring the other owner.
        const ownDeliveryIds = await ownDeliveryIdsOrRefuse(ctx);
        for (const id of ownDeliveryIds) {
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
      // then the source and destination. The ids aren't in state, so look them up by source
      // name - which also settles whether this site still owns the source at all.
      const deliveryIds = await ownDeliveryIdsOrRefuse(ctx);
      for (const id of deliveryIds) await ctx.clients.logsUsEast1.deleteDelivery(id);
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
      await mergeBucketPolicyStatement(ctx, 'AllowCloudFrontRead', {
        Sid: 'AllowCloudFrontRead',
        Effect: 'Allow',
        Principal: { Service: 'cloudfront.amazonaws.com' },
        Action: ['s3:GetObject'],
        Resource: ctx.preview
          ? `arn:aws:s3:::${ctx.names.bucket}/previews/*`
          : `arn:aws:s3:::${ctx.names.bucket}/site/*`,
        Condition: { StringEquals: { 'AWS:SourceArn': distArn } },
      });
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
 * IAM role a GitHub Actions workflow assumes via OIDC - to deploy/destroy previews
 * (preview stack, any ref) or to deploy production (main branch only, plus CloudFront
 * invalidation).
 *
 * The role carries the site's own grants and nothing else. A plugin needing the deploy
 * role to reach one of *its* resources attaches its own **named** inline policy to this
 * same role from its own graph, reconciled by its own `<plugin> bootstrap` - so this
 * document never names a plugin's resource, and `applyOidcRole` rewriting it wholesale
 * on every `blogwright bootstrap` cannot disturb the plugin's.
 */
function githubOidcRoleNode(preview: boolean, ssr: boolean): ResourceNode {
  const roleName = (ctx: OpsContext) => ctx.names.githubRole;
  return {
    id: 'gh-oidc-role',
    // Production deploys invalidate the distribution, so its ARN must be in state
    // (and, through the distribution's own dependency, the response headers
    // policy's id the deploy grant names).
    // In SSR mode the policy also names the Web Function role's ARN and the
    // function and endpoint ARNs the service answered with.
    dependsOn: preview
      ? ['iam-exec-role']
      : [
          'iam-exec-role',
          'cloudfront-distribution',
          ...(ssr ? ['iam-web-role', 'web-function'] : []),
        ],
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
 * `production` GitHub Environment (release-gated - see production.yml), which lets
 * deploys be gated behind environment protection rules.
 */
export function oidcSubClaim(repo: string, env: string, preview: boolean): string {
  if (preview) return `repo:${repo}:*`;
  if (env === 'production') return `repo:${repo}:environment:production`;
  return `repo:${repo}:ref:refs/heads/main`;
}

/**
 * What an SSR deploy needs from Lambda, scoped to this site's function rather
 * than every Web Function in the account. The function ARN is the one the
 * service recorded (derived from the name when a run has not recorded it yet,
 * the same derivation the Lambda-read bucket statement uses); revisions and
 * endpoints are sub-resources of it. The probes are granted on the endpoint
 * ARN - the resource the function's own policy admits CloudFront on for the
 * same action.
 */
function webFunctionDeployStatements(ctx: OpsContext): object[] {
  const recorded = output(ctx, 'web-function');
  const functionArn =
    typeof recorded.arn === 'string'
      ? recorded.arn
      : `arn:aws:lambda:${ctx.config.region}:${ctx.accountId}:web-function/${ctx.names.webFunction}`;
  const endpointArn =
    typeof recorded.endpointArn === 'string' ? recorded.endpointArn : `${functionArn}/*`;
  return [
    {
      // Revision publishing and the fingerprint lookup.
      Effect: 'Allow',
      Action: [
        'lambda:CreateWebFunctionRevision',
        'lambda:GetWebFunction*',
        'lambda:ListWebFunction*',
      ],
      Resource: [functionArn, `${functionArn}/*`],
    },
    {
      // The preflight and the readiness probe.
      Effect: 'Allow',
      Action: ['lambda:InvokeWebFunctionEndpoint'],
      Resource: [endpointArn],
    },
    {
      Effect: 'Allow',
      Action: ['iam:PassRole'],
      Resource: [String(output(ctx, 'iam-web-role').arn)],
    },
  ];
}

/** The deploy role's inline policy statements (exported for tests). */
export function oidcRolePolicyStatements(ctx: OpsContext): object[] {
  const statements: object[] = [
    { Effect: 'Allow', Action: ['sts:GetCallerIdentity'], Resource: '*' },
    {
      Effect: 'Allow',
      // s3:GetObjectVersion is what reads an artifact a revision is pinned to.
      Action: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        ...(ctx.config.ssr ? ['s3:GetObjectVersion'] : []),
      ],
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
    ...(ctx.config.ssr ? webFunctionDeployStatements(ctx) : []),
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
    // Deploys converge the response headers in place - this one policy only,
    // never the distribution (`reconcileResponseHeadersOnDeploy`).
    const policyId = recordedResponseHeadersPolicyId(ctx);
    if (policyId !== undefined) {
      statements.push({
        Effect: 'Allow',
        Action: ['cloudfront:GetResponseHeadersPolicy', 'cloudfront:UpdateResponseHeadersPolicy'],
        Resource: `arn:aws:cloudfront::${ctx.accountId}:response-headers-policy/${policyId}`,
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
 * distribution - A/AAAA alias records (free queries, apex-safe), not a CNAME.
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
    // CNAME first - a pre-0.2.1 bootstrap's (recorded in state) or an
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
  // Preview stacks never support SSR (a shared host-routed distribution cannot
  // front a per-PR endpoint); the mode is refused by the preview verbs too.
  const ssr = Boolean(ctx.config.ssr) && !ctx.preview;
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
  ];
  const responseHeaders =
    ctx.config.headers !== undefined || recordedResponseHeadersPolicyId(ctx) !== undefined;
  if (responseHeaders) nodes.push(responseHeadersPolicyNode());
  if (ssr) {
    nodes.push(
      // The `.local` companion first: Lambda writes in-Region logs there before
      // centralising them, and would otherwise create it itself, with no
      // retention and outside the graph.
      logGroupNode(
        'web-local-log-group',
        'Web Function local log group',
        (c) => c.names.webLocalLogGroup,
        (c) => c.config.retention.webFunctionDays,
      ),
      logGroupNode(
        'web-log-group',
        'Web Function log group',
        (c) => c.names.webLogGroup,
        (c) => c.config.retention.webFunctionDays,
      ),
      webRoleNode(),
      webOacNode(),
      webCachePolicyNode(),
      webCodeBucketPolicyNode(),
      webFunctionNode(),
    );
  }
  nodes.push(
    distributionNode({ hasDomain, preview: ctx.preview, ssr, responseHeaders }),
    logDeliveryNode(),
    bucketPolicyNode(),
  );
  if (ssr) nodes.push(webFunctionPolicyNode());
  if (hasDomain) nodes.push(certificateNode());
  if (ctx.preview) {
    nodes.push(previewDnsNode(), githubOidcRoleNode(true, false));
  } else if (ctx.config.githubRepo) {
    // staging deploys on push to main; production on release (see the deploy workflows).
    nodes.push(githubOidcRoleNode(false, ssr));
  }
  return nodes;
}
