import { AwsError, CACHING_DISABLED, pollUntil, type CreateImageInput } from '@iamstan/ops-core';

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

function logGroupArn(ctx: OpsContext, name: string): string {
  return `arn:aws:logs:${ctx.config.region}:${ctx.accountId}:log-group:${name}:*`;
}

/** S3 resource ARN the build writes the site into (per-PR prefix for preview stacks). */
function siteWriteResource(ctx: OpsContext): string {
  return ctx.preview
    ? `arn:aws:s3:::${ctx.names.bucket}/previews/*/site/*`
    : `arn:aws:s3:::${ctx.names.bucket}/site/*`;
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
      await ctx.clients.s3.putPublicAccessBlock(ctx.names.bucket);
      output(ctx, 'bucket').name = ctx.names.bucket;
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
): ResourceNode {
  return {
    id,
    dependsOn: [],
    title,
    async read(ctx) {
      const exists = await ctx.clients.logs.logGroupExists(name(ctx));
      if (exists) output(ctx, id).arn = logGroupArn(ctx, name(ctx));
      return exists;
    },
    async create(ctx) {
      await ctx.clients.logs.ensureLogGroup(name(ctx));
      await ctx.clients.logs.putRetentionPolicy(name(ctx), days(ctx));
      output(ctx, id).arn = logGroupArn(ctx, name(ctx));
    },
    async update(ctx) {
      await ctx.clients.logs.putRetentionPolicy(name(ctx), days(ctx));
    },
    async delete(ctx) {
      await ctx.clients.logs.deleteLogGroup(name(ctx));
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
        Effect: 'Allow',
        Action: ['s3:PutObject', 's3:DeleteObject'],
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
        'Builds the iamstan MicroVM image',
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
        Effect: 'Allow',
        Action: ['s3:PutObject', 's3:DeleteObject'],
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
        'Runtime role for the iamstan builder MicroVM',
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
      clientToken: `img-${artifact.hash}`,
      description: `iamstan ${ctx.env} builder`,
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

function microvmImageNode(): ResourceNode {
  return {
    id: 'microvm-image',
    dependsOn: ['bucket', 'iam-build-role'],
    title: 'MicroVM builder image',
    async read(ctx) {
      // GetMicrovmImage requires an ARN/ID (not the friendly name), so look up via the
      // ARN recorded in state on a prior create — as with the OAC/distribution nodes.
      // The image "exists" in any non-deleted state; update() reconciles a failed or
      // stale build (create() would otherwise 409 on the existing name).
      const arn = output(ctx, 'microvm-image').arn;
      if (typeof arn !== 'string') return false;
      const image = await ctx.clients.microvms.getImage(arn);
      if (!image || /DELET/i.test(image.state)) return false;
      if (image.imageVersion) output(ctx, 'microvm-image').version = image.imageVersion;
      return true;
    },
    async create(ctx) {
      const { input, hash } = await imageInput(ctx);
      ctx.logger.step(`create MicroVM image (agent ${hash})`);
      const image = await ctx.clients.microvms.createImage(input);
      // Persist the ARN immediately so a later failure/retry can find the image via read()
      // → update() instead of re-issuing create() and hitting a 409 on the existing name.
      output(ctx, 'microvm-image').arn = image.imageArn;
      await ctx.save();
      await awaitImageSettled(ctx, image.imageArn, 'CREATED');
      output(ctx, 'microvm-image').agentHash = hash;
    },
    async update(ctx) {
      const arn = String(output(ctx, 'microvm-image').arn);
      const before = await ctx.clients.microvms.getImage(arn);
      const healthy = Boolean(before) && /CREATED|UPDATED/i.test(before?.state ?? '');
      const { input, hash } = await imageInput(ctx);
      // Skip the (slow) rebuild when the image is healthy and the agent is unchanged.
      if (healthy && output(ctx, 'microvm-image').agentHash === hash) return;
      ctx.logger.step(`update MicroVM image (agent ${hash})`);
      await ctx.clients.microvms.updateImage(arn, input);
      await awaitImageSettled(ctx, arn, 'UPDATED', before?.imageVersion);
      output(ctx, 'microvm-image').agentHash = hash;
    },
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
        const token = `iamstan${ctx.env}`.replace(/\W/g, '');
        arn = await ctx.clients.acm.requestCertificate(certDomain, token);
        output(ctx, 'acm-certificate').arn = arn;
        await ctx.save();
      }
      const initial = await ctx.clients.acm.describeCertificate(arn);
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
 * `pr-42.preview.iamstan.dev/foo` → origin `previews/pr-42/site/foo`, with directory →
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

/** CloudFront Function that maps a preview subdomain to its S3 prefix (preview stacks only). */
function previewFunctionNode(): ResourceNode {
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
        PREVIEW_FUNCTION_CODE,
        `iamstan ${ctx.env} preview host router`,
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

/** The CloudFront distribution. Preview stacks use a host-routing function + no caching. */
function distributionNode(hasDomain: boolean, preview: boolean): ResourceNode {
  const dependsOn = [
    'bucket',
    'oac',
    ...(hasDomain ? ['acm-certificate'] : []),
    ...(preview ? ['cloudfront-function'] : []),
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
      const dist = await ctx.clients.cloudfront.createDistribution({
        callerReference: `${ctx.names.prefix}-${ctx.accountId}`,
        comment: `iamstan ${ctx.env}`,
        bucketDomainName: `${ctx.names.bucket}.s3.${ctx.config.region}.amazonaws.com`,
        // Preview: function rewrites the full path, so the origin path is the bucket root.
        originPath: preview ? '' : '/site',
        originAccessControlId: String(output(ctx, 'oac').id),
        defaultRootObject: ctx.config.defaultRootObject,
        aliases: ctx.domain ? [preview ? `*.${ctx.domain}` : ctx.domain] : [],
        acmCertificateArn: hasDomain ? String(output(ctx, 'acm-certificate').arn) : undefined,
        ...(preview
          ? {
              cachePolicyId: CACHING_DISABLED,
              functionArn: String(output(ctx, 'cloudfront-function').arn),
            }
          : {}),
      });
      const out = output(ctx, 'cloudfront-distribution');
      out.id = dist.id;
      out.arn = dist.arn;
      out.domainName = dist.domainName;
      ctx.logger.info(`  CloudFront domain: ${dist.domainName}`);
      if (ctx.domain) {
        const record = preview ? `*.${ctx.domain}` : ctx.domain;
        ctx.logger.info(`  point ${record} (CNAME/ALIAS) at ${dist.domainName}`);
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
  return {
    id: 'cloudfront-log-delivery',
    dependsOn: ['cloudfront-distribution', 'cloudfront-log-group'],
    title: 'CloudFront log delivery',
    async read(ctx) {
      return typeof output(ctx, 'cloudfront-log-delivery').delivery === 'string';
    },
    async create(ctx) {
      const distArn = String(output(ctx, 'cloudfront-distribution').arn);
      const groupArn = String(output(ctx, 'cloudfront-log-group').arn).replace(/:\*$/, '');
      const sourceArn = await ctx.clients.logs.putDeliverySource(
        ctx.names.deliverySource,
        distArn,
        'ACCESS_LOGS',
      );
      const destArn = await ctx.clients.logs.putDeliveryDestination(
        ctx.names.deliveryDestination,
        groupArn,
      );
      await ctx.clients.logs.createDelivery(ctx.names.deliverySource, destArn);
      const out = output(ctx, 'cloudfront-log-delivery');
      out.delivery = 'configured';
      out.source = sourceArn;
      out.destination = destArn;
    },
    async delete(ctx) {
      // Best-effort: the delivery is orphaned when the distribution/log group are removed.
      ctx.logger.warn('log delivery left to teardown with its distribution/log group');
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

/** IAM role a GitHub Actions workflow assumes via OIDC to deploy/destroy previews. */
function githubOidcRoleNode(): ResourceNode {
  const roleName = (ctx: OpsContext) => `${ctx.names.prefix}-gh`;
  return {
    id: 'gh-oidc-role',
    dependsOn: ['iam-exec-role'],
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

async function applyOidcRole(ctx: OpsContext, roleName: string): Promise<void> {
  const repo = ctx.config.githubRepo;
  if (!repo) throw new Error('config.githubRepo is required for the preview OIDC role');
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
            StringLike: { [`${GITHUB_OIDC_URL}:sub`]: `repo:${repo}:*` },
          },
        },
      ],
    },
    'GitHub Actions preview deploy role',
  );
  await ctx.clients.iam.putRolePolicy(roleName, 'preview-deploy', {
    Version: '2012-10-17',
    Statement: [
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
        // RunMicrovm passes the exec role to the MicroVM.
        Effect: 'Allow',
        Action: ['iam:PassRole'],
        Resource: String(output(ctx, 'iam-exec-role').arn),
      },
    ],
  });
  output(ctx, 'gh-oidc-role').arn = arn;
}

/** Route53 wildcard record pointing *.<domain> at the preview CloudFront distribution. */
function previewDnsNode(): ResourceNode {
  return {
    id: 'preview-dns',
    dependsOn: ['cloudfront-distribution'],
    title: 'Route53 wildcard record',
    async read(ctx) {
      return typeof output(ctx, 'preview-dns').record === 'string';
    },
    async create(ctx) {
      const domain = ctx.domain;
      if (!domain) throw new Error('preview DNS requires a domain');
      const zoneId = await ctx.clients.route53.hostedZoneId(domain);
      if (!zoneId) throw new Error(`no Route53 hosted zone found for ${domain}`);
      const cf = String(output(ctx, 'cloudfront-distribution').domainName);
      await ctx.clients.route53.upsertRecord(zoneId, {
        name: `*.${domain}`,
        type: 'CNAME',
        value: cf,
      });
      const out = output(ctx, 'preview-dns');
      out.record = `*.${domain}`;
      out.zoneId = zoneId;
      out.value = cf;
      ctx.logger.info(`  *.${domain} -> ${cf}`);
    },
    async delete(ctx) {
      const out = output(ctx, 'preview-dns');
      if (
        typeof out.zoneId === 'string' &&
        typeof out.record === 'string' &&
        typeof out.value === 'string'
      ) {
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
    ),
    buildRoleNode(),
    execRoleNode(),
    microvmImageNode(),
    oacNode(),
    distributionNode(hasDomain, ctx.preview),
    logDeliveryNode(),
    bucketPolicyNode(),
  ];
  if (hasDomain) nodes.push(certificateNode());
  if (ctx.preview) {
    nodes.push(previewFunctionNode(), previewDnsNode(), githubOidcRoleNode());
  }
  return nodes;
}
