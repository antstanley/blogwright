import {
  AwsError,
  CloudFrontClient,
  createMemoryFileSystem,
  SigningClient,
  staticCredentials,
  type CachePolicyConfigInput,
  type DistributionConfigInput,
  type PdsConfig,
  type RawResponse,
  type ResponseHeadersInput,
  type ResponseHeadersPolicyConfigInput,
} from 'blogwright-core';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { applyGraph } from './graph.js';
import type { OpsContext } from './context.js';
import {
  buildNodes,
  builderImageAction,
  reconcileBuilderImage,
  oidcRolePolicyStatements,
  oidcSubClaim,
  PLACEHOLDER_ARTIFACT_KEY,
  placeholderPackageZip,
  reconcileResponseHeadersOnDeploy,
} from './nodes.js';
import { createTestContext, TEST_AGENT_DIR } from './test-support.js';

/** One response through the real transport seam, for the XML fixtures below. */
function rawResponse(body: string): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: 200, headers: {}, body: bytes, text: () => body };
}

/** The XML the real cache-policy builder emits for a desired config. */
async function cachePolicyXml(config: CachePolicyConfigInput): Promise<string> {
  let body = '';
  const client = new CloudFrontClient(
    new SigningClient({
      region: 'us-east-1',
      credentials: staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' }),
      transport: async (req) => {
        body = String(req.body ?? '');
        return rawResponse('<CachePolicy><Id>CP-1</Id></CachePolicy>');
      },
    }),
  );
  await client.createCachePolicy(config);
  return body;
}

/** The XML the real distribution builder emits for a desired shape. */
async function distributionXml(shape: DistributionConfigInput): Promise<string> {
  let body = '';
  const client = new CloudFrontClient(
    new SigningClient({
      region: 'us-east-1',
      credentials: staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' }),
      transport: async (req) => {
        body = String(req.body ?? '');
        return rawResponse(
          '<Distribution><Id>D1</Id><ARN>arn:aws:cloudfront::1:distribution/D1</ARN>' +
            '<DomainName>d1.cloudfront.net</DomainName><Status>Deployed</Status></Distribution>',
        );
      },
    }),
  );
  await client.createDistribution(shape);
  return body;
}

/**
 * The block `pds: true` stands for: a fully populated `pds` block, `secretName`
 * spelled out. This graph no longer reads any of it - the grant it once fed is
 * the pds plugin's own named inline policy now - so the fixture exists to be the
 * *most* tempting input: the shape that used to produce a Secrets Manager
 * statement here.
 */
const PDS_WITH_SECRET_NAME: PdsConfig = { name: 'x', secretName: 'spelled-out/pds-key' };

/**
 * `pds: true` uses {@link PDS_WITH_SECRET_NAME}; an explicit block is passed
 * through as written, which is how a block omitting `secretName` - legal now
 * that core no longer defaults it - reaches the policy builder.
 */
function ctx(opts: { preview: boolean; pds?: boolean | PdsConfig }): OpsContext {
  const pds = opts.pds === true ? PDS_WITH_SECRET_NAME : opts.pds === false ? undefined : opts.pds;
  return createTestContext({
    preview: opts.preview,
    env: opts.preview ? 'preview' : 'production',
    config: {
      githubRepo: 'antstanley/example',
      ...(pds ? { pds } : {}),
    },
    state: {
      resources: {
        'iam-exec-role': { arn: 'arn:aws:iam::123456789012:role/exec' },
        'iam-build-role': { arn: 'arn:aws:iam::123456789012:role/build' },
        'cloudfront-distribution': {
          arn: 'arn:aws:cloudfront::123456789012:distribution/DIST',
        },
      },
    },
  });
}

function actionsOf(statements: object[]): string[] {
  return statements.flatMap((s) => (s as { Action: string | string[] }).Action);
}

describe('cloudfront log delivery self-heal', () => {
  /** A `delivery-destination` ARN, whose final segment is the destination's name. */
  function destArn(name: string): string {
    return `arn:aws:logs:us-east-1:123456789012:delivery-destination:${name}`;
  }

  /**
   * Stands in for the delivery source as AWS actually behaves: `DeleteDeliverySource`
   * is REJECTED while any delivery is still attached (a Conflict that
   * `deleteDeliverySource` does not catch - it swallows only not-found). A fake that
   * returned void here would let a guard-less teardown pass every assertion about
   * which delivery ids were deleted, which is how the unconditional
   * `deleteDeliverySource` in the retry survived earlier reviews.
   */
  function deliveryCtx(
    failFirstPut: boolean,
    opts: { foreign?: boolean; unattributable?: boolean } = {},
  ) {
    const calls: string[] = [];
    let putCount = 0;
    const aws = {
      sourcePresent: true,
      destinationPresent: true,
      deliveries: [] as { id: string; deliveryDestinationArn: string }[],
    };
    const ctx = createTestContext({
      env: 'staging',
      config: { retention: { microvmDays: 1, cloudfrontDays: 1, webFunctionDays: 1 } },
      state: {
        resources: {
          'cloudfront-distribution': { arn: 'arn:dist/NEW' },
          'cloudfront-log-group': { arn: 'arn:group:*' },
        },
      },
      clients: {
        logsUsEast1: {
          putDeliverySource: async () => {
            calls.push('putSource');
            if (failFirstPut && putCount++ === 0) {
              throw new AwsError({
                service: 'logs',
                code: 'ConflictException',
                message: 'Update to existing Delivery Source with new ResourceId is not allowed.',
                statusCode: 400,
              });
            }
            aws.sourcePresent = true;
            return 'arn:source';
          },
          putDeliveryDestination: async () => (calls.push('putDest'), 'arn:dest'),
          createDelivery: async () => {
            calls.push('createDelivery');
          },
          deliveriesForSource: async () => (calls.push('listDeliveries'), [...aws.deliveries]),
          deleteDelivery: async (id: string) => {
            calls.push(`deleteDelivery:${id}`);
            aws.deliveries = aws.deliveries.filter((d) => d.id !== id);
          },
          deleteDeliverySource: async () => {
            calls.push('deleteSource');
            if (aws.deliveries.length > 0) {
              throw new AwsError({
                service: 'logs',
                code: 'ConflictException',
                message: 'Delivery Source still has deliveries attached.',
                statusCode: 400,
              });
            }
            aws.sourcePresent = false;
          },
          deleteDeliveryDestination: async () => {
            calls.push('deleteDest');
            aws.destinationPresent = false;
          },
        },
      },
    });
    // Seeded after construction so the site's own delivery points at the REAL
    // derived destination name. The foreign delivery is listed FIRST, so a guard
    // that picked its own delivery by position would pick the wrong one.
    const own = { id: 'd-1', deliveryDestinationArn: destArn(ctx.names.deliveryDestination) };
    // The analytics plugin's delivery: a second delivery hung off this same
    // shared source, under the destination name `packages/analytics/src/nodes.ts`
    // derives (`<prefix>-analytics-cf-dest`). Built from `names.prefix` here
    // rather than written out, so what the guard is proved to refuse over is the
    // plugin's real delivery and not a plausible stand-in for one - this package
    // cannot import that one, so the derivation is restated instead.
    const foreign = {
      id: 'analytics-d',
      deliveryDestinationArn: destArn(`${ctx.names.prefix}-analytics-cf-dest`),
    };
    // An empty ARN is what `deliveriesForSource` yields for a delivery AWS returns
    // without a `deliveryDestinationArn` - unattributable, and so not the site's.
    const unattributable = { id: 'unknown-d', deliveryDestinationArn: '' };
    aws.deliveries = opts.foreign
      ? [foreign, own]
      : opts.unattributable
        ? [unattributable, own]
        : [own];
    return { ctx, calls, aws };
  }

  function node(ctx: OpsContext) {
    const found = buildNodes(ctx).find((n) => n.id === 'cloudfront-log-delivery');
    if (!found) throw new Error('cloudfront-log-delivery node not found');
    return found;
  }

  it('removes the stale delivery trio and retries on ConflictException', async () => {
    const { ctx, calls } = deliveryCtx(true);
    await node(ctx).create(ctx);
    expect(calls).toEqual([
      'putSource',
      'listDeliveries',
      'deleteDelivery:d-1',
      'deleteSource',
      'deleteDest',
      'putSource',
      'putDest',
      'createDelivery',
    ]);
    expect(ctx.state.resources['cloudfront-log-delivery']?.delivery).toBe('configured');
  });

  it('wires straight through when there is no conflict', async () => {
    const { ctx, calls } = deliveryCtx(false);
    await node(ctx).create(ctx);
    expect(calls).toEqual(['putSource', 'putDest', 'createDelivery']);
  });

  it('rethrows non-conflict errors untouched', async () => {
    const { ctx } = deliveryCtx(false);
    (
      ctx.clients.logsUsEast1 as unknown as { putDeliverySource: () => Promise<string> }
    ).putDeliverySource = async () => {
      throw new AwsError({
        service: 'logs',
        code: 'AccessDenied',
        message: 'no',
        statusCode: 403,
      });
    };
    await expect(node(ctx).create(ctx)).rejects.toThrow(/AccessDenied/);
  });

  it('tears down delivery, then source, then destination when the site owns them all', async () => {
    const { ctx, calls, aws } = deliveryCtx(false);
    await node(ctx).delete(ctx);
    expect(calls).toEqual(['listDeliveries', 'deleteDelivery:d-1', 'deleteSource', 'deleteDest']);
    expect(aws.deliveries).toEqual([]);
    expect(aws.sourcePresent).toBe(false);
    expect(aws.destinationPresent).toBe(false);
  });

  it('refuses to delete a delivery source carrying a delivery the site does not own', async () => {
    const { ctx, calls, aws } = deliveryCtx(false, { foreign: true });
    await expect(node(ctx).delete(ctx)).rejects.toThrow(
      'blogwright analytics destroy staging --yes',
    );
    await expect(node(ctx).delete(ctx)).rejects.toThrow(/analytics-d/);
    // Nothing removed: not the foreign delivery, not the site's own, not the source.
    expect(calls).toEqual(['listDeliveries', 'listDeliveries']);
    expect(aws.deliveries.map((d) => d.id)).toEqual(['analytics-d', 'd-1']);
    expect(aws.sourcePresent).toBe(true);
    expect(aws.destinationPresent).toBe(true);
  });

  it('refuses when a delivery carries no destination ARN to attribute it by', async () => {
    // The `?? ''` fallback in `deliveriesForSource` is fail-closed by design: a
    // delivery AWS reports without a destination matches no destination name, so it
    // counts as foreign and the guard refuses rather than deleting on a guess.
    const { ctx, calls, aws } = deliveryCtx(false, { unattributable: true });
    await expect(node(ctx).delete(ctx)).rejects.toThrow(/unknown-d/);
    expect(calls).toEqual(['listDeliveries']);
    expect(aws.deliveries.map((d) => d.id)).toEqual(['unknown-d', 'd-1']);
    expect(aws.sourcePresent).toBe(true);
  });

  it('refuses the conflict retry rather than unwiring a shared delivery source', async () => {
    const { ctx, calls, aws } = deliveryCtx(true, { foreign: true });
    await expect(node(ctx).create(ctx)).rejects.toThrow(
      'blogwright analytics destroy staging --yes',
    );
    // The refusal lands BEFORE any delete: the site's own delivery is still
    // attached, so the stack is left whole rather than half torn down.
    expect(calls).not.toContain('deleteDelivery:analytics-d');
    expect(calls).toEqual(['putSource', 'listDeliveries']);
    expect(aws.deliveries.map((d) => d.id)).toEqual(['analytics-d', 'd-1']);
    expect(aws.sourcePresent).toBe(true);
  });
});

describe('builderImageAction', () => {
  const HEALTHY = { state: 'CREATED' };
  const recorded = { agentHash: 'abc123', logGroup: '/lg' };

  it('creates when the image is missing or being deleted', () => {
    expect(builderImageAction(undefined, recorded, 'abc123', '/lg')).toBe('create');
    expect(builderImageAction({ state: 'DELETING' }, recorded, 'abc123', '/lg')).toBe('create');
  });

  it('skips when a healthy image already matches the agent bundle and log group', () => {
    expect(builderImageAction(HEALTHY, recorded, 'abc123', '/lg')).toBe('skip');
    expect(builderImageAction({ state: 'UPDATED' }, recorded, 'abc123', '/lg')).toBe('skip');
  });

  it('updates when the agent bundle hash changed', () => {
    expect(builderImageAction(HEALTHY, recorded, 'def456', '/lg')).toBe('update');
  });

  it('updates when the log group changed', () => {
    expect(builderImageAction(HEALTHY, recorded, 'abc123', '/other')).toBe('update');
  });

  it('rebuilds (update) when the last build is unhealthy even if the hash matches', () => {
    expect(builderImageAction({ state: 'CREATE_FAILED' }, recorded, 'abc123', '/lg')).toBe(
      'update',
    );
  });

  it('does not treat a legacy state record without the architecture as a rebuild reason', () => {
    // `ARM_64` is the API's only architecture, so every image created before
    // the field existed already runs it: a record lacking `cpuArchitecture`
    // still skips.
    expect(builderImageAction(HEALTHY, recorded, 'abc123', '/lg')).toBe('skip');
  });
});

describe('reconcileBuilderImage architecture', () => {
  const AGENT_HASH = '0123456789ab';

  function imageCtx(existing: { state: string; imageVersion?: string } | undefined) {
    const calls: string[] = [];
    // What GetMicrovmImage answers as the run progresses: an update request
    // flips the image to UPDATING with a new version, which is what the
    // settle poll waits for.
    let current = existing;
    const opsCtx = createTestContext({
      ports: {
        fs: createMemoryFileSystem({
          [`${TEST_AGENT_DIR}/Dockerfile`]: 'FROM scratch',
          [`${TEST_AGENT_DIR}/server.js`]: 'export {};',
          [`${TEST_AGENT_DIR}/agent-manifest.json`]: JSON.stringify({ hash: AGENT_HASH }),
        }),
      },
      state: { resources: { 'microvm-image': { arn: 'arn:img', agentHash: AGENT_HASH } } },
      clients: {
        s3: {
          putObject: async () => 'v1',
        },
        microvms: {
          getImage: async () =>
            current
              ? {
                  imageArn: 'arn:img',
                  imageName: 'builder',
                  state: current.state,
                  imageVersion: current.imageVersion,
                }
              : undefined,
          updateImage: async (_id, input) => {
            calls.push(`updateImage ${JSON.stringify(input.cpuConfigurations ?? null)}`);
            current = { state: 'UPDATED', imageVersion: '2' };
            return {
              imageArn: 'arn:img',
              imageName: 'builder',
              state: 'UPDATING',
              imageVersion: '2',
            };
          },
        },
      },
    });
    return { ctx: opsCtx, calls };
  }

  it('states the Arm64 architecture on an update too, and records it', async () => {
    // The log group differs from the record, so the reconcile updates.
    const { ctx, calls } = imageCtx({ state: 'CREATED', imageVersion: '1' });
    await reconcileBuilderImage(ctx);
    expect(calls).toEqual(['updateImage [{"architecture":"ARM_64"}]']);
    expect(ctx.state.resources['microvm-image']?.cpuArchitecture).toBe('ARM_64');
  });

  it('leaves a matching image alone', async () => {
    const { ctx, calls } = imageCtx({ state: 'CREATED', imageVersion: '1' });
    ctx.state.resources['microvm-image'] = {
      arn: 'arn:img',
      agentHash: AGENT_HASH,
      logGroup: ctx.names.microvmLogGroup,
    };
    await reconcileBuilderImage(ctx);
    expect(calls).toEqual([]);
    // A skip is not a request, so nothing is written: a legacy record without
    // the architecture stays as it is, and is not a rebuild reason either.
    expect(ctx.state.resources['microvm-image']?.cpuArchitecture).toBeUndefined();
  });
});

describe('oidcSubClaim', () => {
  it('scopes the subject per environment', () => {
    // preview: any ref (the flag wins regardless of env name)
    expect(oidcSubClaim('antstanley/example', 'preview', true)).toBe('repo:antstanley/example:*');
    // staging: pushes to main
    expect(oidcSubClaim('antstanley/example', 'staging', false)).toBe(
      'repo:antstanley/example:ref:refs/heads/main',
    );
    // production: the release-gated `production` GitHub Environment
    expect(oidcSubClaim('antstanley/example', 'production', false)).toBe(
      'repo:antstanley/example:environment:production',
    );
  });
});

describe('oidcRolePolicyStatements', () => {
  it('keeps the preview statement set unchanged (no invalidation, no secret)', () => {
    const actions = actionsOf(oidcRolePolicyStatements(ctx({ preview: true, pds: true })));
    expect(actions).not.toContain('cloudfront:CreateInvalidation');
    expect(actions).not.toContain('secretsmanager:GetSecretValue');
  });

  it('lets the deploy role rebuild the builder image (create/update image + pass build role)', () => {
    const statements = oidcRolePolicyStatements(ctx({ preview: false }));
    const actions = actionsOf(statements);
    expect(actions).toContain('lambda:CreateMicrovmImage');
    expect(actions).toContain('lambda:UpdateMicrovmImage');
    const passRole = statements.find((s) => actionsOf([s]).includes('iam:PassRole')) as {
      Resource: string[];
    };
    expect(passRole.Resource).toContain('arn:aws:iam::123456789012:role/build');
  });

  it('adds the Web Function revision and probe grants only in SSR mode', () => {
    const staticActions = actionsOf(oidcRolePolicyStatements(ctx({ preview: false })));
    expect(staticActions).not.toContain('lambda:InvokeWebFunctionEndpoint');
    expect(staticActions).not.toContain('s3:GetObjectVersion');

    const ssrCtx = createTestContext({
      config: {
        githubRepo: 'antstanley/example',
        ssr: { entryPoint: 'index.js' },
      },
      state: {
        resources: {
          'iam-exec-role': { arn: 'arn:aws:iam::123456789012:role/exec' },
          'iam-build-role': { arn: 'arn:aws:iam::123456789012:role/build' },
          'iam-web-role': { arn: 'arn:aws:iam::123456789012:role/production-example-web-role' },
          'cloudfront-distribution': { arn: 'arn:aws:cloudfront::123456789012:distribution/DIST' },
          'web-function': {
            arn: 'arn:aws:lambda:us-east-1:123456789012:web-function/production-example-web',
            endpointArn:
              'arn:aws:lambda:us-east-1:123456789012:web-function/production-example-web/endpoint/site',
          },
        },
      },
    });
    const ssrStatements = oidcRolePolicyStatements(ssrCtx);
    const ssrActions = actionsOf(ssrStatements);
    expect(ssrActions).toContain('lambda:CreateWebFunctionRevision');
    expect(ssrActions).toContain('lambda:GetWebFunction*');
    expect(ssrActions).toContain('lambda:ListWebFunction*');
    expect(ssrActions).toContain('lambda:InvokeWebFunctionEndpoint');
    expect(ssrActions).toContain('s3:GetObjectVersion');
    const passRole = ssrStatements.filter((s) => actionsOf([s]).includes('iam:PassRole'));
    expect(passRole.flatMap((s) => (s as { Resource: string[] }).Resource)).toContain(
      'arn:aws:iam::123456789012:role/production-example-web-role',
    );
    // Scoped to this site's function, never every Web Function in the account.
    const resourcesFor = (action: string) =>
      ssrStatements
        .filter((s) => actionsOf([s]).includes(action))
        .flatMap((s) => (s as { Resource: string | string[] }).Resource);
    const fn = 'arn:aws:lambda:us-east-1:123456789012:web-function/production-example-web';
    expect(resourcesFor('lambda:CreateWebFunctionRevision')).toEqual([fn, `${fn}/*`]);
    expect(resourcesFor('lambda:ListWebFunction*')).toEqual([fn, `${fn}/*`]);
    expect(resourcesFor('lambda:InvokeWebFunctionEndpoint')).toEqual([`${fn}/endpoint/site`]);
  });

  it('grants production invalidation on the distribution ARN', () => {
    const statements = oidcRolePolicyStatements(ctx({ preview: false }));
    const inv = statements.find((s) =>
      actionsOf([s]).includes('cloudfront:CreateInvalidation'),
    ) as { Resource: string };
    expect(inv.Resource).toBe('arn:aws:cloudfront::123456789012:distribution/DIST');
    expect(actionsOf(statements)).not.toContain('secretsmanager:GetSecretValue');
  });

  it.each([false, true])(
    'ignores PDS config in the complete site policy (preview: %s)',
    (preview) => {
      const unconfigured = oidcRolePolicyStatements(ctx({ preview }));
      // Cover both the explicit name and the default the removed branch derived.
      const blocks: PdsConfig[] = [PDS_WITH_SECRET_NAME, { name: 'x' }];
      for (const pds of blocks) {
        const statements = oidcRolePolicyStatements(ctx({ preview, pds }));
        expect(statements).toEqual(unconfigured);
        expect(
          actionsOf(statements).filter((action) => action.startsWith('secretsmanager:')),
        ).toEqual([]);
      }
    },
  );
});

describe('distributionNode.update', () => {
  function distCtx(opts: { domain?: string; existingAliasCall?: boolean }) {
    const calls: Array<{ id: string; aliases: string[]; cert: string | undefined }> = [];
    const ctx = createTestContext({
      config: opts.domain ? { domain: opts.domain } : {},
      state: {
        resources: {
          'cloudfront-distribution': { id: 'D1', domainName: 'd1.cloudfront.net' },
          'acm-certificate': { arn: 'arn:aws:acm:us-east-1:1:certificate/abc' },
        },
      },
      clients: {
        cloudfront: {
          setDistributionAliases: async (id: string, aliases: string[], cert?: string) => {
            calls.push({ id, aliases, cert });
            return true;
          },
        },
      },
    });
    return { ctx, calls };
  }

  function distNode(ctx: OpsContext) {
    const found = buildNodes(ctx).find((n) => n.id === 'cloudfront-distribution');
    if (!found?.update) throw new Error('distribution node has no update');
    return found;
  }

  it('attaches the domain alias and certificate on reconcile', async () => {
    const { ctx, calls } = distCtx({ domain: 'example.com' });
    await distNode(ctx).update!(ctx);
    expect(calls).toEqual([
      {
        id: 'D1',
        aliases: ['example.com'],
        cert: 'arn:aws:acm:us-east-1:1:certificate/abc',
      },
    ]);
  });

  it('uses a wildcard alias for the preview stack', async () => {
    const { ctx, calls } = distCtx({ domain: 'preview.example.com' });
    ctx.preview = true;
    const found = buildNodes(ctx).find((n) => n.id === 'cloudfront-distribution');
    await found!.update!(ctx);
    expect(calls[0]?.aliases).toEqual(['*.preview.example.com']);
  });

  it('leaves a static stack that stays static to the alias-only update', async () => {
    // A recorded static mode plus a static config is not a mode switch and not
    // an SSR bootstrap, so the full reconcile must not run - `spa` and
    // `defaultRootObject` stay creation-time settings there.
    const { ctx } = distCtx({ domain: 'example.com' });
    const reconciled: string[] = [];
    ctx.state.resources['cloudfront-distribution'] = {
      id: 'D1',
      domainName: 'd1.cloudfront.net',
      mode: 'static',
    };
    ctx.clients.cloudfront.reconcileDistribution = async (id: string) => {
      reconciled.push(id);
      return false;
    };
    await distNode(ctx).update!(ctx);
    expect(reconciled).toEqual([]);
  });

  it('reconciles the full shape on a mode switch, recording the mode it left', async () => {
    const ctx = createTestContext({
      config: { ssr: { entryPoint: 'index.js' } },
      state: {
        resources: {
          'cloudfront-distribution': { id: 'D1', domainName: 'd1.cloudfront.net', mode: 'static' },
          oac: { id: 'OAC-S' },
          'cloudfront-function': { arn: 'arn:function:router' },
        },
      },
      clients: {
        cloudfront: {
          reconcileDistribution: async () => true,
        },
      },
    });
    const node = buildNodes(ctx).find((n) => n.id === 'cloudfront-distribution');
    await node?.update?.(ctx);
    expect(ctx.state.resources['cloudfront-distribution']?.mode).toBe('ssr');
  });

  it('never touches aliases when no domain is configured', async () => {
    const { ctx, calls } = distCtx({});
    await distNode(ctx).update!(ctx);
    expect(calls).toEqual([]);
  });
});

describe('distributionNode SPA mode', () => {
  function createCtx(spa: boolean) {
    const inputs: DistributionConfigInput[] = [];
    const tagged: Array<{ arn: string; tags: Record<string, string> }> = [];
    const ctx = createTestContext({
      config: spa ? { spa: true } : {},
      state: {
        resources: {
          oac: { id: 'oac1' },
          'cloudfront-function': { arn: 'arn:cf:fn' },
        },
      },
      clients: {
        cloudfront: {
          createDistribution: async (input: DistributionConfigInput) => {
            inputs.push(input);
            return {
              id: 'D1',
              arn: 'a',
              domainName: 'd.cloudfront.net',
              status: 'InProgress',
              etag: 'E',
            };
          },
          tagResource: async (arn: string, tags: Record<string, string>) => {
            tagged.push({ arn, tags });
          },
        },
      },
    });
    return { ctx, inputs, tagged };
  }

  it('tags the distribution with environment and app on create', async () => {
    const { ctx, tagged } = createCtx(false);
    const node = buildNodes(ctx).find((n) => n.id === 'cloudfront-distribution');
    await node!.create(ctx);
    expect(tagged).toEqual([{ arn: 'a', tags: ctx.tags }]);
    expect(ctx.tags.environment).toBe('test');
  });

  it('maps origin 403/404 to /index.html with 200 when spa is set', async () => {
    const { ctx, inputs } = createCtx(true);
    const node = buildNodes(ctx).find((n) => n.id === 'cloudfront-distribution');
    await node!.create(ctx);
    expect(inputs[0]?.customErrorResponses).toEqual([
      { errorCode: 403, responsePagePath: '/index.html', responseCode: 200 },
      { errorCode: 404, responsePagePath: '/index.html', responseCode: 200 },
    ]);
  });

  it('keeps the 404 page mapping by default', async () => {
    const { ctx, inputs } = createCtx(false);
    const node = buildNodes(ctx).find((n) => n.id === 'cloudfront-distribution');
    await node!.create(ctx);
    expect(inputs[0]?.customErrorResponses).toEqual([
      { errorCode: 403, responsePagePath: '/404.html', responseCode: 404 },
      { errorCode: 404, responsePagePath: '/404.html', responseCode: 404 },
    ]);
  });
});

describe('distributionNode adoption', () => {
  // The deterministic identity for the default test context (site "example", env
  // "test", account 123456789012).
  const OWN_REFERENCE = 'test-example-123456789012';

  function adoptCtx(existingReference: string) {
    const tagged: Array<{ arn: string; tags: Record<string, string> }> = [];
    const configFetches: string[] = [];
    const ctx = createTestContext({
      state: {
        resources: {
          oac: { id: 'oac1' },
          'cloudfront-function': { arn: 'arn:cf:fn' },
        },
      },
      clients: {
        cloudfront: {
          createDistribution: async () => {
            // CloudFront's alias-conflict check fires before CallerReference
            // idempotency, so a re-run against an orphan always lands here.
            throw new AwsError({
              service: 'cloudfront',
              code: 'CNAMEAlreadyExists',
              message: 'One or more of the CNAMEs are already associated with a different resource',
              statusCode: 409,
            });
          },
          listDistributions: async () => [
            {
              id: 'D-OTHER',
              arn: 'arn:other',
              domainName: 'other.cloudfront.net',
              comment: 'another site',
            },
            {
              id: 'D-ORPHAN',
              arn: 'arn:orphan',
              domainName: 'orphan.cloudfront.net',
              comment: 'example test',
            },
          ],
          getDistributionConfig: async (id: string) => {
            configFetches.push(id);
            return {
              config: `<DistributionConfig><CallerReference>${existingReference}</CallerReference></DistributionConfig>`,
              etag: 'E1',
            };
          },
          tagResource: async (arn: string, tags: Record<string, string>) => {
            tagged.push({ arn, tags });
          },
        },
      },
    });
    const node = buildNodes(ctx).find((n) => n.id === 'cloudfront-distribution');
    if (!node) throw new Error('cloudfront-distribution node not found');
    return { ctx, node, tagged, configFetches };
  }

  it('adopts the orphaned distribution when its CallerReference matches', async () => {
    const { ctx, node, tagged, configFetches } = adoptCtx(OWN_REFERENCE);

    await node.create(ctx);

    // Comment narrows the candidates; only the matching-comment config is fetched.
    expect(configFetches).toEqual(['D-ORPHAN']);
    expect(ctx.state.resources['cloudfront-distribution']).toEqual({
      id: 'D-ORPHAN',
      arn: 'arn:orphan',
      domainName: 'orphan.cloudfront.net',
      mode: 'static',
    });
    expect(tagged).toEqual([{ arn: 'arn:orphan', tags: ctx.tags }]);
  });

  it('rethrows the original conflict when no candidate CallerReference matches', async () => {
    const { ctx, node, tagged } = adoptCtx('staging-example-999999999999');

    // A foreign distribution holding the alias is a real conflict - surface it.
    await expect(node.create(ctx)).rejects.toThrow(/CNAMEAlreadyExists/);
    expect(ctx.state.resources['cloudfront-distribution']).toBeUndefined();
    expect(tagged).toEqual([]);
  });
});

describe('bucketNode partial-bootstrap resilience', () => {
  it('records the bucket name before tagging, so a crash mid-create keeps it in state', async () => {
    const ctx = createTestContext({
      clients: {
        s3: {
          createBucket: async () => undefined,
          putBucketTagging: async () => {
            throw new AwsError({
              service: 's3',
              code: 'InternalError',
              message: 'transient',
              statusCode: 500,
            });
          },
        },
      },
    });
    const node = buildNodes(ctx).find((n) => n.id === 'bucket');

    await expect(node!.create(ctx)).rejects.toThrow(/InternalError/);
    expect(ctx.state.resources['bucket']?.name).toBe(ctx.names.bucket);
  });

  it('re-applies tagging and the public-access block on update', async () => {
    const calls: string[] = [];
    const ctx = createTestContext({
      clients: {
        s3: {
          putBucketTagging: async () => {
            calls.push('tagging');
          },
          putPublicAccessBlock: async () => {
            calls.push('publicAccessBlock');
          },
        },
      },
    });
    const node = buildNodes(ctx).find((n) => n.id === 'bucket');

    // A bucket left half-configured by a crashed run converges on the next apply.
    await node!.update!(ctx);
    expect(calls).toEqual(['tagging', 'publicAccessBlock']);
  });
});

describe('previewDnsNode', () => {
  function dnsCtx(existing?: { record: string; zoneId: string; value: string }) {
    const upserts: Array<{ type: string; name: string; value: string; aliasZoneId?: string }> = [];
    const deletes: Array<{ type: string; name: string }> = [];
    const ctx = createTestContext({
      preview: true,
      domain: 'preview.example.com',
      state: {
        resources: {
          'cloudfront-distribution': { id: 'D1', domainName: 'd123.cloudfront.net' },
          ...(existing ? { 'preview-dns': existing } : {}),
        },
      },
      clients: {
        route53: {
          hostedZoneId: async () => 'Z-PREVIEW',
          upsertRecord: async (_zone: string, r: (typeof upserts)[number]) => {
            upserts.push(r);
          },
          deleteRecord: async (_zone: string, r: (typeof deletes)[number]) => {
            deletes.push(r);
          },
        },
      },
    });
    const node = buildNodes(ctx).find((n) => n.id === 'preview-dns');
    if (!node) throw new Error('preview-dns node not found');
    return { ctx, node, upserts, deletes };
  }

  it('creates A and AAAA alias records pointing at the distribution', async () => {
    const { ctx, node, upserts, deletes } = dnsCtx();

    await node.create(ctx);

    // A stray CNAME (manual workaround) is cleared best-effort before the aliases.
    expect(deletes).toEqual([
      { name: '*.preview.example.com', type: 'CNAME', value: 'd123.cloudfront.net' },
    ]);
    expect(upserts).toEqual([
      {
        name: '*.preview.example.com',
        type: 'A',
        value: 'd123.cloudfront.net',
        aliasZoneId: 'Z2FDTNDATAQYW2',
      },
      {
        name: '*.preview.example.com',
        type: 'AAAA',
        value: 'd123.cloudfront.net',
        aliasZoneId: 'Z2FDTNDATAQYW2',
      },
    ]);
    expect(ctx.state.resources['preview-dns']?.type).toBe('ALIAS');
  });

  it('migrates a legacy CNAME on reconcile (deletes it before the aliases)', async () => {
    const { ctx, node, upserts, deletes } = dnsCtx({
      record: '*.preview.example.com',
      zoneId: 'Z-PREVIEW',
      value: 'd123.cloudfront.net',
    });

    await node.update!(ctx);

    expect(deletes).toEqual([
      { name: '*.preview.example.com', type: 'CNAME', value: 'd123.cloudfront.net' },
    ]);
    expect(upserts.map((u) => u.type)).toEqual(['A', 'AAAA']);
    expect(ctx.state.resources['preview-dns']?.type).toBe('ALIAS');
  });
});

describe('cloudfront log nodes use the us-east-1 logs client', () => {
  it('routes group creation and delivery wiring through logsUsEast1', async () => {
    const calls: string[] = [];
    const pinned = {
      logGroupExists: async (_name: string) => false,
      ensureLogGroup: async (name: string) => {
        calls.push(`ensure:${name}`);
      },
      putRetentionPolicy: async (_name: string, _days: number) => {
        calls.push('retention');
      },
      putDeliverySource: async (_n: string, _arn: string, _t: string) => {
        calls.push('source');
        return 'arn:source';
      },
      putDeliveryDestination: async (_n: string, _g: string) => {
        calls.push('dest');
        return 'arn:dest';
      },
      createDelivery: async (_s: string, _d: string) => {
        calls.push('delivery');
      },
    };
    const poisoned = new Proxy(
      {},
      {
        get: (_t, prop) => () => {
          throw new Error(`regional logs client used for CloudFront ${String(prop)} (#3)`);
        },
      },
    );
    const ctx = createTestContext({
      config: { region: 'eu-west-1' },
      state: {
        resources: {
          'cloudfront-distribution': { arn: 'arn:cf:dist' },
          'cloudfront-log-group': { arn: 'arn:aws:logs:us-east-1:1:log-group:/g:*' },
        },
      },
      clients: { logsUsEast1: pinned, logs: poisoned as Record<string, never> },
    });

    const group = buildNodes(ctx).find((n) => n.id === 'cloudfront-log-group');
    await group!.create(ctx);
    const delivery = buildNodes(ctx).find((n) => n.id === 'cloudfront-log-delivery');
    await delivery!.create(ctx);

    expect(calls).toEqual([
      'ensure:/example/test/cloudfront',
      'retention',
      'source',
      'dest',
      'delivery',
    ]);
    expect(String(ctx.state.resources['cloudfront-log-group']?.arn)).toContain(':us-east-1:');
  });
});

describe('site-write roles can tag objects (#7)', () => {
  /** The inline policy a role node writes at create. */
  interface PolicyDoc {
    Statement: Array<{ Action: string[]; Resource: string | string[] }>;
  }

  async function policyFor(
    roleId: 'iam-build-role' | 'iam-exec-role',
    opts: { preview?: boolean } = {},
  ): Promise<PolicyDoc> {
    let policy: PolicyDoc | undefined;
    const ctx = createTestContext({
      ...(opts.preview ? { env: 'preview', preview: true, domain: 'preview.example.com' } : {}),
      clients: {
        iam: {
          ensureRole: async () => 'arn:aws:iam::1:role/r',
          putRolePolicy: async (_role: string, _name: string, doc: object) => {
            policy = doc as PolicyDoc;
          },
        },
      },
    });
    const node = buildNodes(ctx).find((n) => n.id === roleId);
    await node!.create(ctx);
    if (!policy) throw new Error('no policy written');
    return policy;
  }

  // Object tags ride on the PUT (x-amz-tagging), but AWS checks PutObjectTagging
  // as a distinct action: without it every tagged upload 403s (issue #7).
  it.each(['iam-build-role', 'iam-exec-role'] as const)(
    '%s grants s3:PutObjectTagging alongside PutObject on the site prefix',
    async (roleId) => {
      const policy = await policyFor(roleId);
      const siteWrite = policy.Statement.find(
        (s) => s.Action.includes('s3:PutObject') && s.Action.includes('s3:DeleteObject'),
      );
      expect(siteWrite).toBeDefined();
      expect(siteWrite!.Action).toContain('s3:PutObjectTagging');
      expect(String(siteWrite!.Resource)).toContain('/site/*');
    },
  );

  it.each(['iam-build-role', 'iam-exec-role'] as const)(
    '%s may write per-build artifact manifests, but not the write-once originals',
    async (roleId) => {
      const policy = await policyFor(roleId);
      const artifacts = policy.Statement.filter((s) =>
        String(s.Resource).includes('/build/artifacts/'),
      );
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]?.Action).toEqual(['s3:PutObject']);
      // `*/*` matches build/artifacts/<hash>/<buildId>.json, never build/artifacts/<hash>.json.
      expect(String(artifacts[0]?.Resource)).toMatch(/\/build\/artifacts\/\*\/\*$/);
    },
  );

  it.each(['iam-build-role', 'iam-exec-role'] as const)(
    '%s on the preview stack records no artifact manifests',
    async (roleId) => {
      const policy = await policyFor(roleId, { preview: true });
      expect(policy.Statement.some((s) => String(s.Resource).includes('build/artifacts'))).toBe(
        false,
      );
    },
  );
});

describe('bucket versioning', () => {
  function bucketCtx(opts: { ssr: boolean; versioned?: boolean }) {
    const calls: string[] = [];
    const opsCtx = createTestContext({
      config: opts.ssr ? { ssr: { entryPoint: 'index.js' } } : {},
      state: {
        resources: {
          bucket: { name: 'b', ...(opts.versioned ? { versioned: true } : {}) },
        },
      },
      clients: {
        s3: {
          putBucketTagging: async () => {
            calls.push('tagging');
          },
          putPublicAccessBlock: async () => {
            calls.push('pab');
          },
          getBucketVersioning: async () => {
            calls.push('getVersioning');
            return 'Suspended';
          },
          putBucketVersioning: async (_bucket, status) => {
            calls.push(`putVersioning ${status}`);
          },
        },
      },
    });
    const node = buildNodes(opsCtx).find((n) => n.id === 'bucket');
    return { ctx: opsCtx, calls, node };
  }

  it('enables versioning on an SSR update, and records it', async () => {
    const { ctx, calls, node } = bucketCtx({ ssr: true });
    await node?.update?.(ctx);
    expect(calls).toEqual(['tagging', 'pab', 'getVersioning', 'putVersioning Enabled']);
    expect(ctx.state.resources['bucket']?.versioned).toBe(true);
  });

  it('never suspends versioning, including after ssr is removed from the config', async () => {
    const enabled = bucketCtx({ ssr: true, versioned: true });
    await enabled.node?.update?.(enabled.ctx);
    expect(enabled.calls).toEqual(['tagging', 'pab']);

    const removed = bucketCtx({ ssr: false, versioned: true });
    await removed.node?.update?.(removed.ctx);
    expect(removed.calls).toEqual(['tagging', 'pab']);
  });
});

describe('SSR build and exec role grants', () => {
  async function policyForSsr(roleId: 'iam-build-role' | 'iam-exec-role', ssr: boolean) {
    let policy: { Statement: { Action: string[]; Resource: string | string[] }[] } | undefined;
    const opsCtx = createTestContext({
      ...(ssr ? { config: { ssr: { entryPoint: 'index.js' } } } : {}),
      clients: {
        iam: {
          ensureRole: async () => 'arn:aws:iam::1:role/r',
          getRoleArn: async () => undefined,
          putRolePolicy: async (_role: string, _name: string, doc: object) => {
            policy = doc as typeof policy;
          },
        },
      },
    });
    const node = buildNodes(opsCtx).find((n) => n.id === roleId);
    await node?.create(opsCtx);
    return policy?.Statement ?? [];
  }

  it.each(['iam-build-role', 'iam-exec-role'] as const)(
    '%s can write web/artifacts and web/results in SSR mode',
    async (roleId) => {
      const statements = await policyForSsr(roleId, true);
      // An SSR environment records no artifact manifest, so it gets no grant for one.
      expect(
        statements.some((s) =>
          (Array.isArray(s.Resource) ? s.Resource : [s.Resource]).some((r) =>
            r.includes('/build/artifacts/'),
          ),
        ),
      ).toBe(false);
      const web = statements.find((s) =>
        (Array.isArray(s.Resource) ? s.Resource : [s.Resource]).some((r) =>
          r.endsWith('/web/artifacts/*'),
        ),
      );
      expect(web?.Action).toEqual(['s3:PutObject']);
      expect(web?.Resource).toEqual([
        expect.stringContaining('/web/artifacts/*'),
        expect.stringContaining('/web/results/*'),
      ]);
    },
  );

  it.each(['iam-build-role', 'iam-exec-role'] as const)(
    '%s gains nothing new in static mode',
    async (roleId) => {
      const statements = await policyForSsr(roleId, false);
      expect(
        statements.some((s) =>
          (Array.isArray(s.Resource) ? s.Resource : [s.Resource]).some((r) => r.includes('/web/')),
        ),
      ).toBe(false);
    },
  );
});

describe('certificateNode validation race', () => {
  // ACM fills DomainValidationOptions asynchronously after RequestCertificate:
  // the first describe can legitimately return no validation records for a
  // pending certificate, and the node must wait for them instead of skipping
  // record creation (which would leave the cert unvalidatable).
  it('waits for ACM to publish validation records before creating them', async () => {
    const record = { name: '_x.preview.example.com.', type: 'CNAME', value: '_y.acm.aws.' };
    const upserts: Array<{ name: string; type: string; value: string }> = [];
    let describes = 0;
    const ctx = createTestContext({
      preview: true,
      env: 'preview',
      config: { domain: 'preview.example.com' },
      clients: {
        acm: {
          requestCertificate: async () => 'arn:aws:acm:us-east-1:1:certificate/new',
          describeCertificate: async () => {
            describes += 1;
            if (describes === 1) return { status: 'PENDING_VALIDATION', validation: [] };
            if (describes === 2) return { status: 'PENDING_VALIDATION', validation: [record] };
            return { status: 'ISSUED', validation: [record] };
          },
        },
        route53: {
          hostedZoneId: async () => 'Z1',
          upsertRecord: async (_zone: string, r: (typeof upserts)[number]) => {
            upserts.push(r);
          },
        },
      },
    });
    const node = buildNodes(ctx).find((n) => n.id === 'acm-certificate');
    await node!.create(ctx);
    expect(upserts).toEqual([record]);
    expect(describes).toBeGreaterThanOrEqual(3);
  });
});

/*
 * The SSR graph: every Web Function node's create/reconcile, and the
 * idempotence an immediate re-bootstrap must show. The whole graph is applied
 * (not a filtered subset) because `topoSort` rejects a node whose dependency
 * is missing, and the surrounding static nodes are what a real bootstrap pays.
 */
describe('SSR bootstrap graph', () => {
  interface SsrRun {
    ctx: OpsContext;
    calls: string[];
    /** The bodies the run sent to selected APIs, for shape assertions. */
    bodies: Record<string, string>;
  }

  /** A fake that answers exactly like AWS would for a fresh stack. */
  function ssrBootstrapCtx(existing?: Partial<Record<string, unknown>>): SsrRun {
    const calls: string[] = [];
    const bodies: Record<string, string> = {};
    const exists = existing ?? {};
    // The bucket policy as S3 stores it: the merged writer reads back what the
    // previous node wrote, so the fake has to persist it between calls.
    let storedBucketPolicy = exists['bucketPolicy'] as string | undefined;
    const opsCtx = createTestContext({
      env: 'production',
      config: {
        githubRepo: 'antstanley/example',
        ssr: { entryPoint: 'server/lambda.mjs', cacheKeyHeaders: ['Authorization'] },
      },
      ports: {
        // The builder-image node packages the agent from `ctx.agentDir`; the
        // bytes do not matter to this graph, only that they exist.
        fs: createMemoryFileSystem({
          [`${TEST_AGENT_DIR}/Dockerfile`]: 'FROM scratch',
          [`${TEST_AGENT_DIR}/server.js`]: 'export {};',
          [`${TEST_AGENT_DIR}/agent-manifest.json`]: JSON.stringify({ hash: '0123456789ab' }),
        }),
      },
      state: {
        resources: {
          'iam-exec-role': { arn: 'arn:exec' },
          'iam-build-role': { arn: 'arn:build' },
          ...(exists['state'] as Record<string, Record<string, never>> | undefined),
        },
      },
      clients: {
        s3: {
          bucketExists: async () => Boolean(exists['bucket']),
          createBucket: async () => {
            calls.push('s3.createBucket');
          },
          putBucketTagging: async () => {
            calls.push('s3.putBucketTagging');
          },
          putPublicAccessBlock: async () => {
            calls.push('s3.putPublicAccessBlock');
          },
          getBucketVersioning: async () => (exists['bucketVersioned'] ? 'Enabled' : undefined),
          putBucketVersioning: async (_bucket, status) => {
            calls.push(`s3.putBucketVersioning ${status}`);
          },
          putObject: async (_bucket, key, body, _type) => {
            calls.push(`s3.putObject ${key}`);
            if (typeof body === 'string' && key.startsWith('web/artifacts/')) bodies[key] = body;
            return `version-${key}`;
          },
          getBucketPolicy: async () => storedBucketPolicy,
          putBucketPolicy: async (_bucket, policy) => {
            calls.push('s3.putBucketPolicy');
            storedBucketPolicy = policy;
            bodies['bucketPolicy'] = policy;
          },
          deleteObject: async () => undefined,
        },
        logs: {
          logGroupExists: async () => Boolean(exists['webLogGroup']),
          ensureLogGroup: async (name) => {
            calls.push(`logs.ensureLogGroup ${name}`);
          },
          putRetentionPolicy: async (name, days) => {
            calls.push(`logs.putRetentionPolicy ${name} ${days}`);
          },
        },
        logsUsEast1: {
          logGroupExists: async () => true,
          putRetentionPolicy: async () => undefined,
          // The vended log-delivery trio the static graph wires on every bootstrap.
          putDeliverySource: async () => {
            calls.push('logsUsEast1.putDeliverySource');
            return 'arn:source';
          },
          putDeliveryDestination: async () => {
            calls.push('logsUsEast1.putDeliveryDestination');
            return 'arn:destination';
          },
          createDelivery: async () => {
            calls.push('logsUsEast1.createDelivery');
          },
          deliveriesForSource: async () => [],
        },
        iam: {
          getRoleArn: async (name) =>
            exists['webRole'] ? `arn:aws:iam::1:role/${name}` : undefined,
          ensureRole: async (name) => {
            calls.push(`iam.ensureRole ${name}`);
            return `arn:aws:iam::1:role/${name}`;
          },
          putRolePolicy: async (name, policyName, policy) => {
            calls.push(`iam.putRolePolicy ${name} ${policyName}`);
            if (policyName === 'web') bodies['webRolePolicy'] = JSON.stringify(policy);
          },
          ensureOidcProvider: async () => {
            calls.push('iam.ensureOidcProvider');
          },
        },
        microvms: {
          getImage: async (id) =>
            id
              ? {
                  imageArn: String(id),
                  imageName: 'production-example-builder',
                  state: 'CREATED',
                  imageVersion: '1',
                }
              : undefined,
          createImage: async (input) => {
            calls.push(`microvms.createImage ${JSON.stringify(input.cpuConfigurations ?? null)}`);
            return {
              imageArn: 'arn:aws:lambda:us-east-1:1:microvm-image/production-example-builder',
              imageName: 'production-example-builder',
              state: 'CREATING',
              imageVersion: undefined,
            };
          },
        },
        cloudfront: {
          createOriginAccessControl: async (input) => {
            calls.push(
              `cloudfront.createOriginAccessControl ${input.originType} ${input.signingBehavior ?? 'always'}`,
            );
            return `OAC-${input.originType}`;
          },
          createCachePolicy: async (config) => {
            calls.push(`cloudfront.createCachePolicy ${config.headerNames.join(',')}`);
            bodies['cachePolicy'] = JSON.stringify(config);
            return { id: 'CP-1', etag: 'E1' };
          },
          getCachePolicy: async () =>
            exists['cachePolicy']
              ? { id: 'CP-1', config: String(exists['cachePolicy']), etag: 'E1' }
              : undefined,
          updateCachePolicy: async (id, config, etag) => {
            calls.push(
              `cloudfront.updateCachePolicy ${id} ${config.headerNames.join(',')} ${etag}`,
            );
          },
          ensureFunction: async () => {
            calls.push('cloudfront.ensureFunction');
            return 'arn:function:router';
          },
          createDistribution: async (input) => {
            calls.push('cloudfront.createDistribution');
            bodies['distribution'] = JSON.stringify(input);
            return {
              id: 'D1',
              arn: 'arn:aws:cloudfront::1:distribution/D1',
              domainName: 'd1.cloudfront.net',
              status: 'Deployed',
              etag: 'E1',
            };
          },
          getDistribution: async () =>
            exists['distribution']
              ? {
                  id: 'D1',
                  arn: 'arn:aws:cloudfront::1:distribution/D1',
                  domainName: 'd1.cloudfront.net',
                  status: 'Deployed',
                  etag: 'E1',
                }
              : undefined,
          getDistributionConfig: async () =>
            exists['distributionConfig']
              ? { config: String(exists['distributionConfig']), etag: 'E1' }
              : undefined,
          reconcileDistribution: async (_id, input) => {
            calls.push('cloudfront.reconcileDistribution');
            bodies['reconciled'] = JSON.stringify(input);
            return false;
          },
          setDistributionAliases: async () => false,
          tagResource: async () => {
            calls.push('cloudfront.tagResource');
          },
          createInvalidation: async () => 'inv',
        },
        lambdaWeb: {
          getWebFunction: async () =>
            exists['webFunction']
              ? {
                  functionName: 'production-example-web',
                  functionArn: 'arn:aws:lambda:us-east-1:1:web-function/production-example-web',
                  state: 'Active',
                  revisionId: 'r-placeholder',
                }
              : undefined,
          createWebFunction: async (input) => {
            calls.push('lambdaWeb.createWebFunction');
            bodies['createWebFunction'] = JSON.stringify(input);
            return {
              functionName: input.functionName,
              functionArn: 'arn:aws:lambda:us-east-1:1:web-function/production-example-web',
              state: 'Active',
              revision: {
                revisionArn: 'arn:rev-placeholder',
                revisionId: 'r-placeholder',
                state: 'Pending',
              },
              endpoint: {
                endpointName: 'site',
                endpointArn: 'arn:endpoint',
                domainName: 'abc.lambda-web.us-east-1.on.aws',
                state: 'Pending',
              },
            };
          },
          getWebFunctionEndpoint: async () =>
            exists['webEndpoint']
              ? {
                  endpointName: 'site',
                  endpointArn: 'arn:endpoint',
                  domainName: 'abc.lambda-web.us-east-1.on.aws',
                  state: 'Active',
                }
              : undefined,
          createWebFunctionEndpoint: async (input) => {
            calls.push(
              `lambdaWeb.createWebFunctionEndpoint ${input.endpointType} ${input.authType} ${input.autoDeploymentMode}`,
            );
            return {
              endpointName: 'site',
              endpointArn: 'arn:endpoint',
              domainName: 'abc.lambda-web.us-east-1.on.aws',
              state: 'Active',
            };
          },
          getResourcePolicy: async () =>
            exists['resourcePolicy'] && exists['distribution']
              ? { policy: String(exists['resourcePolicy']), revisionId: 'rev-1' }
              : exists['resourcePolicy']
                ? { policy: String(exists['resourcePolicy']), revisionId: 'rev-1' }
                : undefined,
          putResourcePolicy: async (_name, policy) => {
            calls.push('lambdaWeb.putResourcePolicy');
            bodies['resourcePolicy'] = policy;
            return { policy, revisionId: 'rev-1' };
          },
          listWebFunctionRevisions: async () => [],
          createWebFunctionRevision: async () => {
            calls.push('lambdaWeb.createWebFunctionRevision');
            throw new Error('bootstrap must never create a revision');
          },
        },
      },
    });
    return { ctx: opsCtx, calls, bodies };
  }

  it('creates versioning, both log groups, the role, the OAC, the cache policy and the code policy', async () => {
    const run = ssrBootstrapCtx();
    await applyGraph(buildNodes(run.ctx), run.ctx);

    expect(run.calls).toContain('s3.putBucketVersioning Enabled');
    expect(run.calls).toContain(`logs.ensureLogGroup ${run.ctx.names.webLocalLogGroup}`);
    expect(run.calls).toContain(`logs.ensureLogGroup ${run.ctx.names.webLogGroup}`);
    expect(run.calls).toContain(`logs.putRetentionPolicy ${run.ctx.names.webLogGroup} 90`);
    expect(run.calls).toContain('cloudfront.createOriginAccessControl lambda always-amz-auth');
    expect(run.calls).toContain('cloudfront.createCachePolicy Authorization');

    const webRole = JSON.parse(run.bodies['webRolePolicy'] ?? '{}') as {
      Statement: { Action: string[]; Resource: string[] }[];
    };
    expect(webRole.Statement[0]?.Action).toEqual(['logs:CreateLogStream', 'logs:PutLogEvents']);
    // Both groups are nodes, so the role never needs logs:CreateLogGroup.
    expect(webRole.Statement[0]?.Resource).toEqual([
      `arn:aws:logs:us-east-1:123456789012:log-group:${run.ctx.names.webLogGroup}:*`,
      `arn:aws:logs:us-east-1:123456789012:log-group:${run.ctx.names.webLocalLogGroup}:*`,
    ]);

    const policy = JSON.parse(run.bodies['bucketPolicy'] ?? '{}') as {
      Statement: { Sid: string; Action: string[]; Resource: string; Condition: unknown }[];
    };
    const codeStatement = policy.Statement.find(
      (s) => s.Sid === 'AllowLambdaWebFunctionCodeAccess',
    );
    expect(codeStatement?.Action).toEqual(['s3:GetObject', 's3:GetObjectVersion']);
    expect(codeStatement?.Resource).toBe(`arn:aws:s3:::${run.ctx.names.bucket}/web/artifacts/*`);
    expect(codeStatement?.Condition).toEqual({
      ArnLike: {
        'AWS:SourceArn': `arn:aws:lambda:us-east-1:123456789012:web-function/${run.ctx.names.webFunction}/revision/*`,
      },
    });
    // The CloudFront-read statement is preserved, in its own Sid.
    expect(policy.Statement.some((s) => s.Sid === 'AllowCloudFrontRead')).toBe(true);
    // The placeholder is inside the prefix the statement covers, and is uploaded
    // before the function that reads it is created.
    expect(run.calls).toContain(`s3.putObject ${PLACEHOLDER_ARTIFACT_KEY}`);
    expect(run.calls.indexOf('s3.putObject web/artifacts/placeholder.zip')).toBeLessThan(
      run.calls.indexOf('lambdaWeb.createWebFunction'),
    );
  });

  it('ships a placeholder package that listens on the endpoint and answers 503', () => {
    const files = unzipSync(placeholderPackageZip());
    expect(Object.keys(files)).toEqual(['index.js']);
    const source = new TextDecoder().decode(files['index.js']);
    expect(source).toContain('AWS_LAMBDA_HTTP_ENDPOINT');
    expect(source).toContain('503');
    // Reproducible: identical bytes on every call, so the placeholder never churns.
    expect(Array.from(placeholderPackageZip())).toEqual(Array.from(placeholderPackageZip()));
  });

  it('creates the function with the placeholder revision, then the site endpoint and resource policy', async () => {
    const run = ssrBootstrapCtx();
    await applyGraph(buildNodes(run.ctx), run.ctx);

    const fn = JSON.parse(run.bodies['createWebFunction'] ?? '{}') as {
      revisionConfig: {
        description: string;
        buildConfig: {
          codeConfig: { s3Object: { bucket: string; key: string; versionId: string } };
          runtimeConfig: { runtime: string };
        };
        serviceConfig: {
          executionRoleArn: string;
          timeoutSeconds: number;
          maxConcurrencyPerEnvironment: number;
          environmentVariables: Record<string, string>;
          telemetryConfig: { loggingConfig: { logGroup: string } };
        };
      };
      endpointConfig: Record<string, string>;
    };
    expect(fn.revisionConfig.description).toBe('blogwright:placeholder');
    expect(fn.revisionConfig.buildConfig.codeConfig.s3Object).toEqual({
      bucket: run.ctx.names.bucket,
      key: 'web/artifacts/placeholder.zip',
      versionId: 'version-web/artifacts/placeholder.zip',
    });
    expect(fn.revisionConfig.buildConfig.runtimeConfig.runtime).toBe('nodejs24.x');
    expect(fn.revisionConfig.serviceConfig.executionRoleArn).toBe(
      `arn:aws:iam::1:role/${run.ctx.names.webRole}`,
    );
    expect(fn.revisionConfig.serviceConfig.timeoutSeconds).toBe(30);
    expect(fn.revisionConfig.serviceConfig.maxConcurrencyPerEnvironment).toBe(64);
    expect(fn.revisionConfig.serviceConfig.telemetryConfig.loggingConfig.logGroup).toBe(
      run.ctx.names.webLogGroup,
    );
    expect(fn.endpointConfig).toEqual({
      endpointName: 'site',
      endpointType: 'HomeRegion',
      authType: 'IamAuth',
      autoDeploymentMode: 'LatestRevision',
    });
    // The create response carried the endpoint, so no second call is needed.
    expect(run.calls).not.toContain(
      'lambdaWeb.createWebFunctionEndpoint HomeRegion IamAuth LatestRevision',
    );
    expect(run.ctx.state.resources['web-function']?.endpointDomainName).toBe(
      'abc.lambda-web.us-east-1.on.aws',
    );
    expect(run.ctx.state.resources['web-function']?.placeholderRevisionId).toBe('r-placeholder');

    const resourcePolicy = JSON.parse(run.bodies['resourcePolicy'] ?? '{}') as {
      Statement: { Sid: string; Action: string; Resource: string; Condition: unknown }[];
    };
    expect(resourcePolicy.Statement).toEqual([
      {
        Sid: 'AllowCloudFrontOACAccess',
        Effect: 'Allow',
        Principal: { Service: 'cloudfront.amazonaws.com' },
        Action: 'lambda:InvokeWebFunctionEndpoint',
        Resource: 'arn:endpoint',
        Condition: {
          ArnLike: { 'AWS:SourceArn': 'arn:aws:cloudfront::1:distribution/D1' },
        },
      },
    ]);
    // The builder image request states the Arm64 architecture on create.
    expect(
      run.calls.some((call) => call.includes('microvms.createImage [{"architecture":"ARM_64"}]')),
    ).toBe(true);
  });

  it('an immediate re-run pushes nothing and creates no revision', async () => {
    const first = ssrBootstrapCtx();
    await applyGraph(buildNodes(first.ctx), first.ctx);

    // What AWS would answer with after the first run: the very XML the real
    // builders produce for the shape that run asked for.
    const cachePolicy = await cachePolicyXml({
      name: first.ctx.names.ssrCachePolicy,
      comment: `${first.ctx.config.siteName} ${first.ctx.env} SSR responses`,
      minTtl: 0,
      defaultTtl: 0,
      maxTtl: 31_536_000,
      headerNames: ['Authorization'],
      queryStrings: 'all',
      cookies: 'none',
      gzip: true,
      brotli: true,
    });
    const distributionConfig = await distributionXml(
      JSON.parse(first.bodies['distribution'] ?? '{}') as DistributionConfigInput,
    );

    const second = ssrBootstrapCtx({
      bucket: true,
      bucketVersioned: true,
      webLogGroup: true,
      webRole: true,
      webFunction: true,
      webEndpoint: true,
      bucketPolicy: first.bodies['bucketPolicy'],
      resourcePolicy: first.bodies['resourcePolicy'],
      cachePolicy,
      distribution: true,
      distributionConfig,
      state: first.ctx.state.resources,
    });
    await applyGraph(buildNodes(second.ctx), second.ctx);

    expect(second.calls).not.toContain('s3.putBucketVersioning Enabled');
    expect(second.calls).not.toContain('cloudfront.createCachePolicy Authorization');
    expect(second.calls).not.toContain('lambdaWeb.createWebFunction');
    expect(second.calls).not.toContain(
      'lambdaWeb.createWebFunctionEndpoint HomeRegion IamAuth LatestRevision',
    );
    expect(second.calls).not.toContain('lambdaWeb.putResourcePolicy');
    expect(second.calls).not.toContain('lambdaWeb.createWebFunctionRevision');
    expect(second.calls.some((call) => call.startsWith('cloudfront.updateCachePolicy'))).toBe(
      false,
    );
  });

  it('updates the cache policy in place when cacheKeyHeaders changed after bootstrap', async () => {
    const first = ssrBootstrapCtx();
    await applyGraph(buildNodes(first.ctx), first.ctx);

    // The live policy predates `cacheKeyHeaders: ["Authorization"]`.
    const cachePolicy = await cachePolicyXml({
      name: first.ctx.names.ssrCachePolicy,
      minTtl: 0,
      defaultTtl: 0,
      maxTtl: 31_536_000,
      headerNames: [],
      queryStrings: 'all',
      cookies: 'none',
      gzip: true,
      brotli: true,
    });
    const second = ssrBootstrapCtx({
      bucket: true,
      bucketVersioned: true,
      webLogGroup: true,
      webRole: true,
      webFunction: true,
      webEndpoint: true,
      bucketPolicy: first.bodies['bucketPolicy'],
      resourcePolicy: first.bodies['resourcePolicy'],
      cachePolicy,
      distribution: true,
      state: first.ctx.state.resources,
    });
    await applyGraph(buildNodes(second.ctx), second.ctx);

    // The name is taken, so a second create is what CloudFront would refuse.
    expect(second.calls).not.toContain('cloudfront.createCachePolicy Authorization');
    expect(second.calls).toContain('cloudfront.updateCachePolicy CP-1 Authorization E1');
  });
});

describe('response headers policy', () => {
  const HEADERS: ResponseHeadersInput = {
    security: { hsts: true, contentTypeOptions: true, frameOptions: 'deny' },
    custom: [{ name: 'Cross-Origin-Opener-Policy', value: 'same-origin' }],
  };

  interface HeadersRun {
    ops: OpsContext;
    calls: string[];
    warnings: string[];
    oks: string[];
    created: ResponseHeadersPolicyConfigInput[];
    distributions: DistributionConfigInput[];
  }

  function cloudfrontError(code: string, statusCode: number): AwsError {
    return new AwsError({ service: 'cloudfront', code, message: code, statusCode });
  }

  /**
   * A stack with a static distribution recorded (`D1`), optionally a recorded
   * policy (`RHP-1`) - attached to `D1` or detached with its delete pending -
   * and a live policy that matches the config unless `drifted`.
   */
  function headersCtx(opts: {
    headers?: ResponseHeadersInput;
    recorded?: boolean;
    attached?: boolean;
    pendingDelete?: boolean;
    drifted?: boolean;
    policyGone?: boolean;
    inUse?: boolean;
    alsoUsedBy?: string[];
    createError?: string;
    leftByEarlierRun?: boolean;
    preview?: boolean;
    ssr?: boolean;
  }): HeadersRun {
    const calls: string[] = [];
    const warnings: string[] = [];
    const oks: string[] = [];
    const created: ResponseHeadersPolicyConfigInput[] = [];
    const distributions: DistributionConfigInput[] = [];
    const record = {
      id: 'RHP-1',
      ...(opts.attached ? { attachedTo: 'D1' } : {}),
      ...(opts.pendingDelete ? { pendingDelete: true } : {}),
    };
    const ops = createTestContext({
      preview: opts.preview,
      env: opts.preview ? 'preview' : 'production',
      config: {
        githubRepo: 'antstanley/example',
        ...(opts.headers ? { headers: opts.headers } : {}),
        ...(opts.ssr ? { ssr: { staticDir: 'dist/client', staticPaths: ['/_app/*'] } } : {}),
      },
      logger: {
        warn: (message: string) => warnings.push(message),
        ok: (message: string) => oks.push(message),
      },
      state: {
        resources: {
          'cloudfront-distribution': {
            id: 'D1',
            arn: 'arn:aws:cloudfront::123456789012:distribution/D1',
            domainName: 'd1.cloudfront.net',
            mode: opts.ssr ? 'ssr' : 'static',
          },
          oac: { id: 'OAC-S' },
          'cloudfront-function': { arn: 'arn:function:router' },
          'web-function': { endpointDomainName: 'abc.on.aws' },
          'web-oac': { id: 'OAC-W' },
          'web-cache-policy': { id: 'CP-SSR' },
          'iam-exec-role': { arn: 'arn:exec' },
          'iam-build-role': { arn: 'arn:build' },
          ...(opts.recorded ? { 'response-headers-policy': record } : {}),
        },
      },
      clients: {
        cloudfront: {
          getResponseHeadersPolicy: async (id: string) => {
            calls.push(`get ${id}`);
            return opts.policyGone ? undefined : { id, config: '<live/>', etag: 'E1' };
          },
          responseHeadersPolicyMatches: () => !opts.drifted,
          createResponseHeadersPolicy: async (input: ResponseHeadersPolicyConfigInput) => {
            calls.push(`create ${input.name}`);
            if (opts.createError) throw cloudfrontError(opts.createError, 400);
            created.push(input);
            return 'RHP-NEW';
          },
          findResponseHeadersPolicyId: async (name: string) => {
            calls.push(`find ${name}`);
            return opts.leftByEarlierRun ? 'RHP-OLD' : undefined;
          },
          updateResponseHeadersPolicy: async (id: string, _input, etag: string | undefined) => {
            calls.push(`update ${id} ${etag ?? ''}`);
          },
          deleteResponseHeadersPolicy: async (id: string) => {
            calls.push(`delete ${id}`);
            if (opts.inUse) throw cloudfrontError('ResponseHeadersPolicyInUse', 409);
          },
          listDistributionIdsUsingResponseHeadersPolicy: async (id: string) => {
            calls.push(`users ${id}`);
            return opts.alsoUsedBy ?? [];
          },
          attachResponseHeadersPolicy: async (distributionId: string, policyId: string) => {
            calls.push(`attach ${distributionId} ${policyId}`);
            return true;
          },
          detachResponseHeadersPolicy: async (distributionId: string, policyId: string) => {
            calls.push(`detach ${distributionId} ${policyId}`);
            return true;
          },
          reconcileDistribution: async (_id: string, input: DistributionConfigInput) => {
            calls.push('reconcileDistribution');
            distributions.push(input);
            return false;
          },
          createDistribution: async (input: DistributionConfigInput) => {
            distributions.push(input);
            return { id: 'D2', arn: 'a', domainName: 'd', status: 'InProgress', etag: 'E' };
          },
          tagResource: async () => undefined,
        },
      },
    });
    return { ops, calls, warnings, oks, created, distributions };
  }

  function node(ops: OpsContext, id: string) {
    const found = buildNodes(ops).find((n) => n.id === id);
    if (!found) throw new Error(`${id} node not in the graph`);
    return found;
  }

  describe('graph membership', () => {
    it('is absent when headers are neither configured nor recorded', () => {
      const { ops } = headersCtx({});
      expect(buildNodes(ops).map((n) => n.id)).not.toContain('response-headers-policy');
      expect(node(ops, 'cloudfront-distribution').dependsOn).not.toContain(
        'response-headers-policy',
      );
    });

    it('is present, ahead of the distribution, when configured or still recorded', () => {
      for (const opts of [{ headers: HEADERS }, { recorded: true }]) {
        const { ops } = headersCtx(opts);
        expect(node(ops, 'response-headers-policy').dependsOn).toEqual([]);
        expect(node(ops, 'cloudfront-distribution').dependsOn).toContain('response-headers-policy');
      }
    });

    it('joins the preview stack too', () => {
      const { ops } = headersCtx({ headers: HEADERS, preview: true });
      expect(buildNodes(ops).map((n) => n.id)).toContain('response-headers-policy');
    });
  });

  describe('create', () => {
    it('creates the policy under the derived name and records its id', async () => {
      const { ops, created } = headersCtx({ headers: HEADERS });
      const policy = node(ops, 'response-headers-policy');
      expect(await policy.read(ops)).toBe(false);
      await policy.create(ops);
      expect(created[0]?.name).toBe('production-example-headers');
      expect(created[0]?.headers.custom).toEqual(HEADERS.custom);
      expect(ops.state.resources['response-headers-policy']).toEqual({ id: 'RHP-NEW' });
    });

    it('adopts the policy an interrupted run left under the same name, then converges it', async () => {
      const { ops, calls, oks } = headersCtx({
        headers: HEADERS,
        createError: 'ResponseHeadersPolicyAlreadyExists',
        leftByEarlierRun: true,
        drifted: true,
      });
      await node(ops, 'response-headers-policy').create(ops);
      expect(calls).toEqual([
        'create production-example-headers',
        'find production-example-headers',
        'get RHP-OLD',
        'update RHP-OLD E1',
      ]);
      expect(ops.state.resources['response-headers-policy']).toEqual({ id: 'RHP-OLD' });
      expect(oks).toContain(
        'adopted response headers policy production-example-headers (RHP-OLD), left by an earlier run',
      );
    });

    it('surfaces the conflict when no policy of that name can be found', async () => {
      const { ops } = headersCtx({
        headers: HEADERS,
        createError: 'ResponseHeadersPolicyAlreadyExists',
      });
      await expect(node(ops, 'response-headers-policy').create(ops)).rejects.toThrow(
        /ResponseHeadersPolicyAlreadyExists/,
      );
      expect(ops.state.resources['response-headers-policy']).toBeUndefined();
    });

    it('names the adjustable quota CloudFront enforces instead of config load', async () => {
      const tooMany = headersCtx({
        headers: HEADERS,
        createError: 'TooManyCustomHeadersInResponseHeadersPolicy',
      });
      await expect(
        node(tooMany.ops, 'response-headers-policy').create(tooMany.ops),
      ).rejects.toThrow(
        /custom lists 1 headers, more than this account's CloudFront quota .*\(10 by default\).*Service Quotas/,
      );
      const longCsp = headersCtx({
        headers: { security: { contentSecurityPolicy: "default-src 'self'" } },
        createError: 'TooLongCSPInResponseHeadersPolicy',
      });
      await expect(
        node(longCsp.ops, 'response-headers-policy').create(longCsp.ops),
      ).rejects.toThrow(
        /contentSecurityPolicy is 18 characters, over this account's CloudFront quota .*\(1783 by default\)/,
      );
    });

    it('creates the distribution with the policy on its default behavior, recording it attached', async () => {
      const { ops, distributions } = headersCtx({ headers: HEADERS, recorded: true });
      delete ops.state.resources['cloudfront-distribution'];
      await node(ops, 'cloudfront-distribution').create(ops);
      expect(distributions[0]?.defaultBehavior.responseHeadersPolicyId).toBe('RHP-1');
      expect(ops.state.resources['response-headers-policy']).toEqual({
        id: 'RHP-1',
        attachedTo: 'D2',
      });
    });
  });

  describe('reconcile on bootstrap', () => {
    it('leaves a matching policy alone and attaches it to a static distribution', async () => {
      const { ops, calls } = headersCtx({ headers: HEADERS, recorded: true });
      const policy = node(ops, 'response-headers-policy');
      expect(await policy.read(ops)).toBe(true);
      await policy.update!(ops);
      await node(ops, 'cloudfront-distribution').update!(ops);
      // read() + update()'s comparison read; no update, then the narrow attach.
      expect(calls).toEqual(['get RHP-1', 'get RHP-1', 'attach D1 RHP-1']);
      expect(ops.state.resources['response-headers-policy']).toEqual({
        id: 'RHP-1',
        attachedTo: 'D1',
      });
    });

    it('records nothing attached when the attach fails', async () => {
      const { ops } = headersCtx({ headers: HEADERS, recorded: true });
      ops.clients.cloudfront.attachResponseHeadersPolicy = async () => {
        throw new Error('the default cache behavior already carries response headers policy HAND');
      };
      await expect(node(ops, 'cloudfront-distribution').update!(ops)).rejects.toThrow(/HAND/);
      expect(ops.state.resources['response-headers-policy']).toEqual({ id: 'RHP-1' });
    });

    it('updates a drifted policy in place, guarded by its ETag', async () => {
      const { ops, calls } = headersCtx({ headers: HEADERS, recorded: true, drifted: true });
      await node(ops, 'response-headers-policy').update!(ops);
      expect(calls).toEqual(['get RHP-1', 'update RHP-1 E1']);
    });

    it('never touches the distribution of a static stack without a policy of its own', async () => {
      const { ops, calls } = headersCtx({});
      await node(ops, 'cloudfront-distribution').update!(ops);
      // A policy attached by hand survives: there is nothing Blogwright owns to attach.
      expect(calls).toEqual([]);
    });

    it('carries the policy on every SSR behavior, the static paths included', async () => {
      const { ops, distributions } = headersCtx({ headers: HEADERS, recorded: true, ssr: true });
      await node(ops, 'cloudfront-distribution').update!(ops);
      expect(distributions[0]?.defaultBehavior.responseHeadersPolicyId).toBe('RHP-1');
      expect(distributions[0]?.orderedBehaviors?.map((b) => b.responseHeadersPolicyId)).toEqual([
        'RHP-1',
      ]);
      expect(ops.state.resources['response-headers-policy']).toEqual({
        id: 'RHP-1',
        attachedTo: 'D1',
      });
    });

    it('detaches and deletes the policy once headers are removed, then forgets it', async () => {
      const { ops, calls } = headersCtx({ recorded: true, attached: true });
      const policy = node(ops, 'response-headers-policy');
      expect(await policy.read(ops)).toBe(true);
      await policy.update!(ops);
      expect(calls).toEqual(['get RHP-1', 'detach D1 RHP-1', 'delete RHP-1']);
      expect(ops.state.resources['response-headers-policy']).toBeUndefined();
      expect(buildNodes(ops).map((n) => n.id)).not.toContain('response-headers-policy');
    });

    it('records the delete as pending when CloudFront has not released a detached policy', async () => {
      const { ops, calls, warnings } = headersCtx({ recorded: true, attached: true, inUse: true });
      await node(ops, 'response-headers-policy').update!(ops);
      expect(calls).toEqual(['get RHP-1', 'detach D1 RHP-1', 'delete RHP-1', 'users RHP-1']);
      expect(ops.state.resources['response-headers-policy']).toEqual({
        id: 'RHP-1',
        pendingDelete: true,
      });
      expect(warnings).toEqual([
        expect.stringMatching(
          /RHP-1 is detached from the distribution, but CloudFront has not released it yet.*next bootstrap deletes it/,
        ),
      ]);
    });

    it('says once that another distribution uses the policy, and stops managing it', async () => {
      const { ops, warnings } = headersCtx({
        recorded: true,
        attached: true,
        inUse: true,
        alsoUsedBy: ['D1', 'D9'],
      });
      await node(ops, 'response-headers-policy').update!(ops);
      expect(warnings).toEqual([
        expect.stringMatching(
          /RHP-1 is detached from this site's distribution but is also attached to D9, so it was not deleted\. Blogwright no longer manages it/,
        ),
      ]);
      // Forgotten: the next bootstrap neither retries nor warns again.
      expect(ops.state.resources['response-headers-policy']).toBeUndefined();
      expect(buildNodes(ops).map((n) => n.id)).not.toContain('response-headers-policy');
    });

    it('clears a stale record without claiming to create anything', async () => {
      const { ops, calls, oks } = headersCtx({ recorded: true, policyGone: true });
      const policy = node(ops, 'response-headers-policy');
      // Unconfigured: present, so the graph runs update, never create.
      expect(await policy.read(ops)).toBe(true);
      await policy.update!(ops);
      expect(calls).toEqual(['get RHP-1']);
      expect(ops.state.resources['response-headers-policy']).toBeUndefined();
      expect(oks).toEqual(['response headers policy RHP-1 no longer exists; cleared its record']);
      await expect(policy.create(ops)).rejects.toThrow(/created only from config\.headers/);
    });

    it('deletes the recorded policy on destroy', async () => {
      const { ops, calls } = headersCtx({ headers: HEADERS, recorded: true });
      await node(ops, 'response-headers-policy').delete(ops);
      expect(calls).toEqual(['delete RHP-1']);
    });
  });

  describe('reconcileResponseHeadersOnDeploy', () => {
    it('updates a drifted policy in place without touching the distribution', async () => {
      const { ops, calls, warnings } = headersCtx({
        headers: HEADERS,
        recorded: true,
        attached: true,
        drifted: true,
      });
      await reconcileResponseHeadersOnDeploy(ops);
      expect(calls).toEqual(['get RHP-1', 'update RHP-1 E1']);
      expect(warnings).toEqual([]);
    });

    it('is a read and nothing more when the policy already matches', async () => {
      const { ops, calls } = headersCtx({ headers: HEADERS, recorded: true, attached: true });
      await reconcileResponseHeadersOnDeploy(ops);
      expect(calls).toEqual(['get RHP-1']);
    });

    it('does nothing at all for a site without headers', async () => {
      const { ops, calls, warnings } = headersCtx({});
      await reconcileResponseHeadersOnDeploy(ops);
      expect(calls).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it('warns, with no AWS call, about a policy a bootstrap created but never attached', async () => {
      const { ops, calls, warnings } = headersCtx({ headers: HEADERS, recorded: true });
      await reconcileResponseHeadersOnDeploy(ops);
      expect(calls).toEqual([]);
      expect(warnings).toEqual([
        expect.stringMatching(
          /RHP-1 is not attached to the distribution.*run `blogwright bootstrap production` to attach it/,
        ),
      ]);
      // Attached to a distribution that has since been replaced counts as not attached.
      const replaced = headersCtx({ headers: HEADERS, recorded: true, attached: true });
      replaced.ops.state.resources['cloudfront-distribution']!.id = 'D7';
      await reconcileResponseHeadersOnDeploy(replaced.ops);
      expect(replaced.warnings).toEqual([expect.stringMatching(/not attached/)]);
    });

    it('points at bootstrap for what changes the distribution, saying what is left to do', async () => {
      const added = headersCtx({ headers: HEADERS });
      await reconcileResponseHeadersOnDeploy(added.ops);
      expect(added.calls).toEqual([]);
      expect(added.warnings).toEqual([
        expect.stringMatching(
          /no response headers policy exists yet; run `blogwright bootstrap production`/,
        ),
      ]);

      const removed = headersCtx({ recorded: true, attached: true });
      await reconcileResponseHeadersOnDeploy(removed.ops);
      expect(removed.calls).toEqual([]);
      expect(removed.warnings).toEqual([
        expect.stringMatching(
          /RHP-1 is still attached to the distribution; .* to detach and delete it/,
        ),
      ]);

      const pending = headersCtx({ recorded: true, pendingDelete: true });
      await reconcileResponseHeadersOnDeploy(pending.ops);
      expect(pending.warnings).toEqual([
        expect.stringMatching(/RHP-1 is already detached from the distribution; .* to delete it/),
      ]);

      const neverAttached = headersCtx({ recorded: true });
      await reconcileResponseHeadersOnDeploy(neverAttached.ops);
      expect(neverAttached.warnings).toEqual([
        expect.stringMatching(
          /run `blogwright bootstrap production` to delete response headers policy RHP-1/,
        ),
      ]);

      const gone = headersCtx({
        headers: HEADERS,
        recorded: true,
        attached: true,
        policyGone: true,
      });
      await reconcileResponseHeadersOnDeploy(gone.ops);
      expect(gone.warnings).toEqual([expect.stringMatching(/RHP-1 no longer exists/)]);
    });
  });

  describe('deploy role grant', () => {
    const GRANT = ['cloudfront:GetResponseHeadersPolicy', 'cloudfront:UpdateResponseHeadersPolicy'];

    it('may read and update exactly the recorded policy', () => {
      const { ops } = headersCtx({ headers: HEADERS, recorded: true });
      const statement = oidcRolePolicyStatements(ops).find((s) =>
        actionsOf([s]).includes('cloudfront:UpdateResponseHeadersPolicy'),
      );
      expect(statement).toEqual({
        Effect: 'Allow',
        Action: GRANT,
        Resource: 'arn:aws:cloudfront::123456789012:response-headers-policy/RHP-1',
      });
      // Never the distribution itself: attaching stays a bootstrap action, and
      // whether the policy is attached comes from state, not a distribution read.
      const actions = actionsOf(oidcRolePolicyStatements(ops));
      expect(actions).not.toContain('cloudfront:UpdateDistribution');
      expect(actions).not.toContain('cloudfront:GetDistributionConfig');
    });

    it('is absent without a recorded policy, and on the preview role', () => {
      const unrecorded = headersCtx({ headers: HEADERS });
      const preview = headersCtx({ headers: HEADERS, recorded: true, preview: true });
      for (const { ops } of [unrecorded, preview]) {
        expect(actionsOf(oidcRolePolicyStatements(ops))).not.toContain(GRANT[1]);
      }
    });
  });
});
