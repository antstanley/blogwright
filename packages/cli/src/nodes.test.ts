import { AwsError, type DistributionConfigInput } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import type { OpsContext } from './context.js';
import { buildNodes, builderImageAction, oidcRolePolicyStatements, oidcSubClaim } from './nodes.js';
import { createTestContext } from './test-support.js';

function ctx(opts: { preview: boolean; pds?: boolean }): OpsContext {
  return createTestContext({
    preview: opts.preview,
    env: opts.preview ? 'preview' : 'production',
    config: {
      githubRepo: 'antstanley/example',
      ...(opts.pds ? { pds: { name: 'x', secretName: 'example/atproto' } } : {}),
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
  function deliveryCtx(failFirstPut: boolean) {
    const calls: string[] = [];
    let putCount = 0;
    const ctx = createTestContext({
      env: 'staging',
      config: { retention: { microvmDays: 1, cloudfrontDays: 1 } },
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
            return 'arn:source';
          },
          putDeliveryDestination: async () => (calls.push('putDest'), 'arn:dest'),
          createDelivery: async () => {
            calls.push('createDelivery');
          },
          deliveriesForSource: async () => (calls.push('listDeliveries'), ['d-1']),
          deleteDelivery: async (id: string) => {
            calls.push(`deleteDelivery:${id}`);
          },
          deleteDeliverySource: async () => {
            calls.push('deleteSource');
          },
          deleteDeliveryDestination: async () => {
            calls.push('deleteDest');
          },
        },
      },
    });
    return { ctx, calls };
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
    (ctx.clients.logsUsEast1 as unknown as { putDeliverySource: () => Promise<string> }).putDeliverySource =
      async () => {
        throw new AwsError({
          service: 'logs',
          code: 'AccessDenied',
          message: 'no',
          statusCode: 403,
        });
      };
    await expect(node(ctx).create(ctx)).rejects.toThrow(/AccessDenied/);
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

  it('grants production invalidation on the distribution ARN', () => {
    const statements = oidcRolePolicyStatements(ctx({ preview: false }));
    const inv = statements.find((s) =>
      actionsOf([s]).includes('cloudfront:CreateInvalidation'),
    ) as { Resource: string };
    expect(inv.Resource).toBe('arn:aws:cloudfront::123456789012:distribution/DIST');
    expect(actionsOf(statements)).not.toContain('secretsmanager:GetSecretValue');
  });

  it('grants secret read/write scoped to the pds secret when configured', () => {
    const statements = oidcRolePolicyStatements(ctx({ preview: false, pds: true }));
    const secret = statements.find((s) =>
      actionsOf([s]).includes('secretsmanager:GetSecretValue'),
    ) as { Action: string[]; Resource: string };
    // write access too: every sync persists the rotated OAuth refresh token
    expect(secret.Action).toEqual([
      'secretsmanager:GetSecretValue',
      'secretsmanager:PutSecretValue',
      'secretsmanager:CreateSecret',
    ]);
    expect(secret.Resource).toBe(
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:example/atproto-*',
    );
  });
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

    expect(deletes).toEqual([{ name: '*.preview.example.com', type: 'CNAME', value: 'd123.cloudfront.net' }]);
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

  async function policyFor(roleId: 'iam-build-role' | 'iam-exec-role'): Promise<PolicyDoc> {
    let policy: PolicyDoc | undefined;
    const ctx = createTestContext({
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
