import { AwsError } from '@iamstan/ops-core';
import { describe, expect, it } from 'vitest';

import type { OpsContext } from './context.js';
import { buildNodes, builderImageAction, oidcRolePolicyStatements, oidcSubClaim } from './nodes.js';

function ctx(opts: { preview: boolean; pds?: boolean }): OpsContext {
  return {
    preview: opts.preview,
    env: opts.preview ? 'preview' : 'production',
    accountId: '123456789012',
    config: {
      region: 'us-east-1',
      githubRepo: 'antstanley/iamstan',
      ...(opts.pds
        ? { pds: { name: 'x', service: 'https://bsky.social', secretName: 'iamstan/atproto' } }
        : {}),
    },
    names: {
      bucket: 'production-iamstan-123456789012',
      microvmLogGroup: '/aws/lambda/microvms/production-iamstan-builder',
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
  } as unknown as OpsContext;
}

function actionsOf(statements: object[]): string[] {
  return statements.flatMap((s) => (s as { Action: string | string[] }).Action);
}

describe('cloudfront log delivery self-heal', () => {
  function deliveryCtx(failFirstPut: boolean) {
    const calls: string[] = [];
    let putCount = 0;
    const ctx = {
      preview: false,
      domain: undefined,
      config: { retention: { microvmDays: 1, cloudfrontDays: 1 } },
      names: {
        deliverySource: 'staging-iamstan-cf-source',
        deliveryDestination: 'staging-iamstan-cf-dest',
        microvmLogGroup: '/aws/lambda/microvms/staging-iamstan-builder',
        cloudfrontLogGroup: '/iamstan/staging/cloudfront',
      },
      state: {
        resources: {
          'cloudfront-distribution': { arn: 'arn:dist/NEW' },
          'cloudfront-log-group': { arn: 'arn:group:*' },
        },
      },
      logger: { step: () => undefined, warn: () => undefined },
      clients: {
        logs: {
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
    } as unknown as OpsContext;
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
    (ctx.clients.logs as { putDeliverySource: () => Promise<string> }).putDeliverySource =
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
    expect(oidcSubClaim('antstanley/iamstan', 'preview', true)).toBe('repo:antstanley/iamstan:*');
    // staging: pushes to main
    expect(oidcSubClaim('antstanley/iamstan', 'staging', false)).toBe(
      'repo:antstanley/iamstan:ref:refs/heads/main',
    );
    // production: the release-gated `production` GitHub Environment
    expect(oidcSubClaim('antstanley/iamstan', 'production', false)).toBe(
      'repo:antstanley/iamstan:environment:production',
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

  it('grants GetSecretValue scoped to the pds secret when configured', () => {
    const statements = oidcRolePolicyStatements(ctx({ preview: false, pds: true }));
    const secret = statements.find((s) =>
      actionsOf([s]).includes('secretsmanager:GetSecretValue'),
    ) as { Action: string[]; Resource: string };
    expect(secret.Action).toEqual(['secretsmanager:GetSecretValue']);
    expect(secret.Resource).toBe(
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:iamstan/atproto-*',
    );
  });
});
