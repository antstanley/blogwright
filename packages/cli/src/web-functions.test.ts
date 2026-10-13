import { describe, expect, it } from 'vitest';

import type { OpsContext } from './context.js';
import { createTestContext } from './test-support.js';
import {
  FINGERPRINT_PREFIX,
  isInvokeAuthorizationFailure,
  preflightWebFunction,
  publishRecordedRevision,
  publishWebRevision,
  readWebBuildResult,
  revisionFingerprint,
  revisionSettings,
  warnAboutSsrSeo,
  type WebFunctionManifest,
} from './web-functions.js';

/** A proxy response, the shape the signed probe transport returns. */
function probe(statusCode: number, headers: Record<string, string> = {}) {
  return {
    statusCode,
    headers,
    body: new Uint8Array(),
    text: () => '',
  };
}

interface RevisionFixture {
  revisionId: string;
  state: string;
  description?: string | undefined;
  functionArn?: string | undefined;
  buildConfig?:
    | {
        codeConfig: { s3Object: { bucket: string; key: string; versionId?: string | undefined } };
        runtimeConfig: { runtime: string };
      }
    | undefined;
  serviceConfig?:
    | {
        executionRoleArn: string;
        timeoutSeconds?: number | undefined;
        maxConcurrencyPerEnvironment?: number | undefined;
        environmentVariables?: Record<string, string> | undefined;
      }
    | undefined;
  errors?: { attribute?: string; errorCode?: string; errorMessage?: string }[] | undefined;
  revisionArn?: string | undefined;
}

interface SsrFixture {
  ctx: OpsContext;
  calls: string[];
  /** Replace the probe's answer - the readiness retry decides on it. */
  setProbeAnswer: (answer: () => number) => void;
  revisions: RevisionFixture[];
  created: Record<string, unknown>[];
  /** Bodies written per key, so a test can read the manifest a path recorded. */
  written: Record<string, string>;
}

function ssrContext(opts: {
  revisions?: RevisionFixture[];
  /** The endpoint's status; defaults to 200. */
  probeAnswer?: () => number;
  ssr?: Record<string, unknown>;
  configDocument?: Record<string, unknown>;
  state?: Record<string, Record<string, string | number | boolean | string[]>>;
  changedPaths?: string[];
  /** Manifests already in the bucket, by hash. */
  manifests?: Record<string, unknown>;
}): SsrFixture {
  const calls: string[] = [];
  const revisions: RevisionFixture[] = [...(opts.revisions ?? [])];
  let probeAnswer: () => number = opts.probeAnswer ?? (() => 200);
  const created: Record<string, unknown>[] = [];
  const written: Record<string, string> = {};
  const changed = opts.changedPaths ?? [];

  const ctx = createTestContext({
    env: 'production',
    config: {
      ssr: {
        entryPoint: 'server/lambda.mjs',
        env: { ORIGIN: 'https://example.com' },
        ...opts.ssr,
      },
    },
    ...(opts.configDocument ? { configDocument: opts.configDocument } : {}),
    state: {
      resources: {
        'iam-web-role': { arn: 'arn:aws:iam::123456789012:role/web' },
        'web-function': {
          name: 'production-example-web',
          arn: 'arn:aws:lambda:us-east-1:123456789012:web-function/production-example-web',
          endpointName: 'site',
          endpointArn:
            'arn:aws:lambda:us-east-1:123456789012:web-function/production-example-web/endpoint/site',
          endpointDomainName: 'abc123.lambda-url.us-east-1.on.aws',
        },
        'cloudfront-distribution': { id: 'D1', arn: 'arn:dist', mode: 'ssr' },
        ...opts.state,
      },
    },
    clients: {
      signing: {
        sendToUrl: async () => {
          calls.push('probe');
          return probe(probeAnswer());
        },
      },
      lambdaWeb: {
        listWebFunctionRevisions: async () => revisions as never,
        getWebFunctionRevision: async (_fn, revisionId) =>
          (revisions.find((r) => r.revisionId === revisionId) ?? revisions[0]) as never,
        createWebFunctionRevision: async (input) => {
          calls.push(`createRevision ${input.description ?? ''}`);
          created.push(input as unknown as Record<string, unknown>);
          const revision: RevisionFixture = {
            revisionId: `r-${created.length}`,
            revisionArn: `arn:rev-${created.length}`,
            functionArn: 'arn:fn',
            state: 'Active',
            description: input.description,
            buildConfig: input.buildConfig,
            serviceConfig: input.serviceConfig,
          };
          revisions.unshift(revision);
          return revision as never;
        },
      },
      cloudfront: {
        createInvalidation: async (_id, paths) => {
          calls.push(`invalidate ${paths.join(',')}`);
          return 'inv-1';
        },
      },
      s3: {
        getObjectText: async (_bucket, key) => {
          if (key.startsWith('build/changed/')) {
            return changed.length > 0 || opts.changedPaths
              ? JSON.stringify({ paths: changed })
              : undefined;
          }
          if (key.startsWith('web/publishing/')) return written[key];
          const stored = /^build\/manifests\/(.+)\.json$/.exec(key)?.[1];
          if (stored !== undefined && opts.manifests?.[stored] !== undefined) {
            return JSON.stringify(opts.manifests[stored]);
          }
          return undefined;
        },
        deleteObject: async (_bucket, key) => {
          calls.push(`deleteObject ${key}`);
          delete written[key];
        },
        putObject: async (_bucket, key, body) => {
          calls.push(`putObject ${key}`);
          if (typeof body === 'string') written[key] = body;
          return undefined;
        },
        listObjects: async () => [],
      },
    },
  });
  return {
    ctx,
    calls,
    setProbeAnswer: (answer) => {
      probeAnswer = answer;
    },
    revisions,
    created,
    written,
  };
}

const RESULT = {
  artifactKey: 'web/artifacts/h1.zip',
  artifactVersionId: 'v-1',
  artifactSha256: 'a'.repeat(64),
  artifactSize: 1024,
  staleStaticKeys: ['site/old.html'],
};

const SOURCE = {
  hash: 'h1',
  sourceKey: 'build/h1.zip',
  startedAt: new Date('2026-10-13T00:00:00.000Z'),
  microvmId: 'vm-1',
};

describe('revision settings and fingerprint', () => {
  it('resolves NODE_ENV and maps a non-default entry point onto the runtime variable', () => {
    const { ctx } = ssrContext({});
    expect(revisionSettings(ctx)).toEqual({
      entryPoint: 'server/lambda.mjs',
      env: {
        NODE_ENV: 'production',
        ORIGIN: 'https://example.com',
        AWS_LAMBDA_NODEJS_ENTRYPOINT: 'server/lambda.mjs',
      },
      timeoutSeconds: 30,
      maxConcurrencyPerEnvironment: 64,
    });
  });

  it('lets ssr.env override NODE_ENV and omits the entry variable for index.js', () => {
    const { ctx } = ssrContext({
      ssr: { entryPoint: 'index.js', env: { NODE_ENV: 'staging' } },
    });
    expect(revisionSettings(ctx).env).toEqual({ NODE_ENV: 'staging' });
  });

  it('changes when only a revision-scoped setting changed, and is otherwise stable', () => {
    const base = revisionFingerprint(ssrContext({}).ctx, RESULT.artifactSha256);
    expect(revisionFingerprint(ssrContext({}).ctx, RESULT.artifactSha256)).toBe(base);
    expect(
      revisionFingerprint(ssrContext({ ssr: { timeoutSeconds: 60 } }).ctx, RESULT.artifactSha256),
    ).not.toBe(base);
    expect(
      revisionFingerprint(
        ssrContext({ ssr: { env: { ORIGIN: 'https://other.example' } } }).ctx,
        RESULT.artifactSha256,
      ),
    ).not.toBe(base);
    expect(revisionFingerprint(ssrContext({}).ctx, 'b'.repeat(64))).not.toBe(base);
  });
});

describe('preflightWebFunction', () => {
  it('passes on any application answer, including the placeholder 503', async () => {
    const { ctx } = ssrContext({ probeAnswer: () => 503 });
    await expect(preflightWebFunction(ctx)).resolves.toBeUndefined();
  });

  it('stops with the action named when the endpoint refuses the caller', async () => {
    const { ctx } = ssrContext({ probeAnswer: () => 403 });
    await expect(preflightWebFunction(ctx)).rejects.toThrow(/lambda:InvokeWebFunctionEndpoint/);
  });

  it('reads a 403 carrying the service error header as an application answer', () => {
    expect(
      isInvokeAuthorizationFailure(probe(403, { 'lambda-web-error-type': 'FunctionError' })),
    ).toBe(false);
    expect(isInvokeAuthorizationFailure(probe(403))).toBe(true);
    expect(isInvokeAuthorizationFailure(probe(503))).toBe(false);
  });
});

describe('readWebBuildResult', () => {
  it('refuses when the agent left no result', async () => {
    const { ctx } = ssrContext({});
    await expect(readWebBuildResult(ctx, 'missing')).rejects.toThrow(/no SSR build result/);
  });
});

describe('publishWebRevision', () => {
  it('creates one revision, probes before invalidating /*, and records the manifest', async () => {
    const fixture = ssrContext({ revisions: [] });
    const outcome = await publishWebRevision(fixture.ctx, SOURCE, RESULT, {
      intervalMs: 1,
      timeoutMs: 50,
    });

    expect(outcome.created).toBe(true);
    expect(outcome.revisionId).toBe('r-1');
    expect(outcome.staleKeysDeleted).toBe(1);
    expect(outcome.invalidation).toEqual({ mode: 'all', count: 0 });
    const create = fixture.created[0] as {
      description?: string | undefined;
      buildConfig: {
        codeConfig: { s3Object: Record<string, string> };
        runtimeConfig: { runtime: string };
      };
      serviceConfig: {
        executionRoleArn: string;
        timeoutSeconds?: number | undefined;
        maxConcurrencyPerEnvironment?: number | undefined;
        environmentVariables?: Record<string, string> | undefined;
        telemetryConfig?: { loggingConfig: { logGroup: string } } | undefined;
      };
    };
    expect(create.buildConfig.codeConfig.s3Object).toEqual({
      bucket: fixture.ctx.names.bucket,
      key: 'web/artifacts/h1.zip',
      versionId: 'v-1',
    });
    expect(create.buildConfig.runtimeConfig.runtime).toBe('nodejs24.x');
    expect(create.serviceConfig.environmentVariables).toEqual({
      NODE_ENV: 'production',
      ORIGIN: 'https://example.com',
      AWS_LAMBDA_NODEJS_ENTRYPOINT: 'server/lambda.mjs',
    });
    expect(create.serviceConfig.telemetryConfig?.loggingConfig.logGroup).toBe(
      fixture.ctx.names.webLogGroup,
    );
    expect(create.description).toBe(
      `${FINGERPRINT_PREFIX}${revisionFingerprint(fixture.ctx, RESULT.artifactSha256)}`,
    );
    expect(outcome.manifest.status).toBe('succeeded');
    expect(outcome.manifest.webFunction).toMatchObject({
      revisionId: 'r-1',
      artifactKey: 'web/artifacts/h1.zip',
      artifactVersionId: 'v-1',
      settings: revisionSettings(fixture.ctx),
      endpointName: 'site',
      endpointDomainName: 'abc123.lambda-url.us-east-1.on.aws',
    });
    // The readiness probe answers before anything cached or published is touched,
    // and the publish is noted in flight from before the create until it is recorded.
    const fingerprint = revisionFingerprint(fixture.ctx, 'a'.repeat(64));
    expect(fixture.calls).toEqual([
      `putObject web/publishing/${fingerprint}.json`,
      `createRevision ${FINGERPRINT_PREFIX}${fingerprint}`,
      'probe',
      'invalidate /*',
      'deleteObject site/old.html',
      'putObject build/manifests/h1.json',
      `deleteObject web/publishing/${fingerprint}.json`,
    ]);
  });

  it('skips creation when the fingerprint already serves, and invalidates only changed paths', async () => {
    const fixture = ssrContext({
      revisions: [
        {
          revisionId: 'r-live',
          revisionArn: 'arn:rev-live',
          state: 'Active',
          description: `${FINGERPRINT_PREFIX}${revisionFingerprint(ssrPlaceholderConfig(), RESULT.artifactSha256)}`,
        },
      ],
      changedPaths: ['/old.html'],
    });
    // The fingerprint depends on the context, so recompute against this fixture.
    fixture.revisions[0]!.description = `${FINGERPRINT_PREFIX}${revisionFingerprint(fixture.ctx, RESULT.artifactSha256)}`;

    const outcome = await publishWebRevision(fixture.ctx, SOURCE, RESULT, {
      intervalMs: 1,
      timeoutMs: 50,
    });
    expect(outcome.created).toBe(false);
    expect(outcome.revisionId).toBe('r-live');
    expect(fixture.created).toHaveLength(0);
    expect(outcome.invalidation).toEqual({ mode: 'paths', count: 1 });
    expect(outcome.manifest.webFunction?.revisionId).toBe('r-live');
    // A finished publish is not re-verified.
    expect(fixture.calls).not.toContain('probe');
  });

  it('finishes a publish that stopped between cutover and invalidation', async () => {
    const fixture = ssrContext({
      revisions: [{ revisionId: 'r-live', revisionArn: 'arn:rev-live', state: 'Active' }],
      changedPaths: [],
    });
    const fingerprint = revisionFingerprint(fixture.ctx, RESULT.artifactSha256);
    fixture.revisions[0]!.description = `${FINGERPRINT_PREFIX}${fingerprint}`;
    // What an earlier run left: the revision is Active and serving, the note
    // that its publish is in flight was never cleared, and no path changed.
    fixture.written[`web/publishing/${fingerprint}.json`] = '{"hash":"h1"}';

    const outcome = await publishWebRevision(fixture.ctx, SOURCE, RESULT, {
      intervalMs: 1,
      timeoutMs: 50,
    });
    expect(outcome.created).toBe(false);
    expect(outcome.revisionId).toBe('r-live');
    expect(fixture.created).toHaveLength(0);
    // Verified and invalidated in full, not read as an unchanged revision.
    expect(outcome.invalidation).toEqual({ mode: 'all', count: 0 });
    expect(fixture.calls).toEqual([
      'probe',
      'invalidate /*',
      'deleteObject site/old.html',
      'putObject build/manifests/h1.json',
      `deleteObject web/publishing/${fingerprint}.json`,
    ]);
    expect(fixture.written[`web/publishing/${fingerprint}.json`]).toBeUndefined();
  });

  it('fails an unfinished publish whose revision does not serve, leaving the cache alone', async () => {
    const fixture = ssrContext({
      revisions: [{ revisionId: 'r-live', revisionArn: 'arn:rev-live', state: 'Active' }],
      probeAnswer: () => 502,
    });
    const fingerprint = revisionFingerprint(fixture.ctx, RESULT.artifactSha256);
    fixture.revisions[0]!.description = `${FINGERPRINT_PREFIX}${fingerprint}`;
    fixture.written[`web/publishing/${fingerprint}.json`] = '{"hash":"h1"}';

    await expect(
      publishWebRevision(fixture.ctx, SOURCE, RESULT, { intervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow(/r-live is Active but did not serve.*NOT serving.*blogwright rollback/);
    expect(fixture.calls.some((call) => call.startsWith('invalidate'))).toBe(false);
    expect(fixture.calls.some((call) => call.startsWith('deleteObject site/'))).toBe(false);
    // Still unfinished: the next deploy verifies it again.
    expect(fixture.written[`web/publishing/${fingerprint}.json`]).toBeDefined();
  });

  it('fails with the revision errors on a Failed revision and leaves the previous one serving', async () => {
    const fixture = ssrContext({
      revisions: [
        {
          revisionId: 'r-live',
          revisionArn: 'arn:rev-live',
          state: 'Active',
          description: `${FINGERPRINT_PREFIX}other`,
        },
      ],
    });
    // The newly created revision settles Failed.
    fixture.ctx.clients.lambdaWeb.getWebFunctionRevision = async () =>
      ({
        revisionId: 'r-failed',
        revisionArn: 'arn:rev-failed',
        state: 'Failed',
        errors: [{ errorCode: 'Runtime.InvalidEntrypoint', errorMessage: 'no index.js' }],
      }) as never;
    fixture.ctx.clients.lambdaWeb.createWebFunctionRevision = async (input) => {
      fixture.created.push(input as unknown as Record<string, unknown>);
      return {
        revisionId: 'r-failed',
        revisionArn: 'arn:rev-failed',
        state: 'Creating',
        errors: [],
      } as never;
    };

    await expect(
      publishWebRevision(fixture.ctx, SOURCE, RESULT, { intervalMs: 1, timeoutMs: 50 }),
    ).rejects.toThrow(/Runtime\.InvalidEntrypoint: no index\.js/);
    const written = fixture.calls.find((call) => call.startsWith('putObject build/manifests/'));
    expect(written).toBeDefined();
    expect(fixture.calls.some((call) => call.startsWith('invalidate'))).toBe(false);
    expect(fixture.calls.some((call) => call.startsWith('deleteObject site/'))).toBe(false);
  });

  it('restores the previous revision when the new one never serves, leaving cache and stale keys alone', async () => {
    const fixture = ssrContext({
      revisions: [
        {
          revisionId: 'r-live',
          revisionArn: 'arn:rev-live',
          state: 'Active',
          description: `${FINGERPRINT_PREFIX}other`,
          buildConfig: {
            codeConfig: {
              s3Object: { bucket: 'b', key: 'web/artifacts/live.zip', versionId: 'v-live' },
            },
            runtimeConfig: { runtime: 'nodejs24.x' },
          },
          serviceConfig: {
            executionRoleArn: 'arn:aws:iam::123456789012:role/live',
            timeoutSeconds: 45,
            maxConcurrencyPerEnvironment: 12,
            environmentVariables: { NODE_ENV: 'production' },
          },
        },
      ],
    });
    // The new revision never answers below 500; once the restore revision
    // exists, the endpoint does.
    fixture.setProbeAnswer(() => (fixture.created.length >= 2 ? 200 : 502));

    await expect(
      publishWebRevision(fixture.ctx, SOURCE, RESULT, { intervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow(/did not serve within/);

    // Two revision creates: the rejected one, then a restore from the captured config.
    expect(fixture.created).toHaveLength(2);
    expect(fixture.created[1]).toMatchObject({
      description: `${FINGERPRINT_PREFIX}other`,
      buildConfig: {
        codeConfig: {
          s3Object: { bucket: 'b', key: 'web/artifacts/live.zip', versionId: 'v-live' },
        },
        runtimeConfig: { runtime: 'nodejs24.x' },
      },
      serviceConfig: {
        executionRoleArn: 'arn:aws:iam::123456789012:role/live',
        timeoutSeconds: 45,
        maxConcurrencyPerEnvironment: 12,
        environmentVariables: { NODE_ENV: 'production' },
      },
    });
    // No cache invalidation and no stale-key deletion - cached pages keep serving.
    expect(fixture.calls.some((call) => call.startsWith('invalidate'))).toBe(false);
    expect(fixture.calls.some((call) => call.startsWith('deleteObject site/'))).toBe(false);
    expect(fixture.calls).toContain('putObject build/manifests/h1.json');
    // The rejected revision no longer serves, so nothing is left in flight.
    expect(Object.keys(fixture.written).some((key) => key.startsWith('web/publishing/'))).toBe(
      false,
    );
  });

  it('names the rollback command when even the restore does not serve', async () => {
    const fixture = ssrContext({
      revisions: [
        {
          revisionId: 'r-live',
          revisionArn: 'arn:rev-live',
          state: 'Active',
          description: `${FINGERPRINT_PREFIX}other`,
        },
      ],
      changedPaths: [],
      probeAnswer: () => 502,
    });
    await expect(
      publishWebRevision(fixture.ctx, SOURCE, RESULT, { intervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow(/endpoint is NOT serving/);
    const messages = fixture.calls.filter((call) => call.startsWith('putObject build/manifests/'));
    expect(messages).toHaveLength(1);
    // The dead revision is what the endpoint routes to, so its publish stays
    // noted in flight: a retry must verify it, not read it as unchanged.
    const fingerprint = revisionFingerprint(fixture.ctx, RESULT.artifactSha256);
    expect(fixture.written[`web/publishing/${fingerprint}.json`]).toBeDefined();
  });

  it('reads a probe that cannot reach the endpoint as not serving yet', async () => {
    const fixture = ssrContext({ revisions: [], changedPaths: [] });
    let probes = 0;
    fixture.setProbeAnswer(() => {
      probes += 1;
      if (probes < 3) throw new Error('socket hang up');
      return 200;
    });
    const outcome = await publishWebRevision(fixture.ctx, SOURCE, RESULT, {
      intervalMs: 1,
      timeoutMs: 500,
    });
    expect(outcome.created).toBe(true);
    expect(probes).toBe(3);
    expect(fixture.calls).toContain('invalidate /*');
    expect(JSON.parse(fixture.written['build/manifests/h1.json'] ?? '{}')).toMatchObject({
      status: 'succeeded',
    });
  });

  it('restores and records the failure when the probe never reaches the new revision', async () => {
    const fixture = ssrContext({
      revisions: [
        {
          revisionId: 'r-live',
          revisionArn: 'arn:rev-live',
          state: 'Active',
          description: `${FINGERPRINT_PREFIX}other`,
        },
      ],
    });
    // Unreachable until the restore revision exists - a thrown probe must reach
    // the restore path exactly as a 5xx does.
    fixture.setProbeAnswer(() => {
      if (fixture.created.length < 2) throw new Error('getaddrinfo ENOTFOUND');
      return 200;
    });
    await expect(
      publishWebRevision(fixture.ctx, SOURCE, RESULT, { intervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow(/did not serve within.*restored revision r-2/);
    expect(fixture.created).toHaveLength(2);
    expect(JSON.parse(fixture.written['build/manifests/h1.json'] ?? '{}')).toMatchObject({
      status: 'failed',
    });
  });

  it('keeps the verified block of an earlier deploy of the hash when a redeploy fails', async () => {
    const verified = {
      revisionId: 'r-earlier',
      fingerprint: 'fp-earlier',
      artifactVersionId: 'v-0',
    };
    const fixture = ssrContext({
      revisions: [],
      probeAnswer: () => 502,
      manifests: { h1: { hash: 'h1', status: 'succeeded', webFunction: verified } },
    });
    await expect(
      publishWebRevision(fixture.ctx, SOURCE, RESULT, { intervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow(/did not serve within/);
    const manifest = JSON.parse(fixture.written['build/manifests/h1.json'] ?? '{}') as {
      status: string;
      webFunction?: unknown;
    };
    expect(manifest.status).toBe('failed');
    expect(manifest.webFunction).toEqual(verified);
  });
});

/** A context purely to recompute a fingerprint for hand-written revision fixtures. */
function ssrPlaceholderConfig(): OpsContext {
  return ssrContext({}).ctx;
}

describe('publishRecordedRevision', () => {
  const recorded: WebFunctionManifest = {
    revisionId: 'r-old',
    revisionArn: 'arn:rev-old',
    fingerprint: 'fp-old',
    artifactKey: 'web/artifacts/old.zip',
    artifactVersionId: 'v-old',
    artifactSha256: 'c'.repeat(64),
    settings: {
      entryPoint: 'index.js',
      env: { NODE_ENV: 'production' },
      timeoutSeconds: 45,
      maxConcurrencyPerEnvironment: 12,
    },
    endpointName: 'site',
    endpointDomainName: 'abc123.lambda-url.us-east-1.on.aws',
  };

  it('reproduces the recorded artifact and settings without reading the current config', async () => {
    const fixture = ssrContext({ revisions: [] });
    const outcome = await publishRecordedRevision(
      fixture.ctx,
      { ...SOURCE, microvmId: 'rollback' },
      recorded,
      { intervalMs: 1, timeoutMs: 50 },
    );
    expect(outcome.created).toBe(true);
    expect(fixture.created[0]).toMatchObject({
      description: `${FINGERPRINT_PREFIX}fp-old`,
      buildConfig: {
        codeConfig: {
          s3Object: {
            bucket: fixture.ctx.names.bucket,
            key: 'web/artifacts/old.zip',
            versionId: 'v-old',
          },
        },
        runtimeConfig: { runtime: 'nodejs24.x' },
      },
      serviceConfig: {
        timeoutSeconds: 45,
        maxConcurrencyPerEnvironment: 12,
        environmentVariables: { NODE_ENV: 'production' },
      },
    });
    expect(outcome.invalidation).toEqual({ mode: 'all', count: 0 });
    expect(outcome.manifest.webFunction?.revisionId).toBe('r-1');
  });

  it('skips creation when the recorded fingerprint is already serving', async () => {
    const fixture = ssrContext({
      revisions: [
        {
          revisionId: 'r-live',
          revisionArn: 'arn:rev-live',
          state: 'Active',
          description: `${FINGERPRINT_PREFIX}fp-old`,
        },
      ],
    });
    const outcome = await publishRecordedRevision(fixture.ctx, SOURCE, recorded, {
      intervalMs: 1,
      timeoutMs: 50,
    });
    expect(outcome.created).toBe(false);
    expect(fixture.created).toHaveLength(0);
    // Every rollback path probes and invalidates.
    expect(fixture.calls).toContain('invalidate /*');
    // The manifest names what serves now, not the revision first recorded.
    expect(outcome.manifest.webFunction).toMatchObject({
      revisionId: 'r-live',
      revisionArn: 'arn:rev-live',
      fingerprint: 'fp-old',
    });
  });

  it('leaves the recorded block in the manifest when the rollback does not serve', async () => {
    const fixture = ssrContext({
      revisions: [],
      probeAnswer: () => 502,
      manifests: { h1: { hash: 'h1', status: 'succeeded', webFunction: recorded } },
    });
    await expect(
      publishRecordedRevision(fixture.ctx, SOURCE, recorded, { intervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow(/is Active but did not serve/);
    const manifest = JSON.parse(fixture.written['build/manifests/h1.json'] ?? '{}') as {
      status: string;
      webFunction?: unknown;
    };
    // A second `rollback h1` must still find the artifact and settings.
    expect(manifest.status).toBe('failed');
    expect(manifest.webFunction).toEqual(recorded);
  });
});

describe('warnAboutSsrSeo', () => {
  it('warns for a written non-off seo value and stays silent on defaults', () => {
    const warned: string[] = [];
    const { ctx } = ssrContext({
      configDocument: { seo: { robots: 'index' } },
      state: {},
    });
    const withLogger = { ...ctx, logger: { ...ctx.logger, warn: (m: string) => warned.push(m) } };
    warnAboutSsrSeo(withLogger);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/seo is inert/);

    // No raw `seo` key, however the merged defaults read: silent.
    const defaults = ssrContext({});
    const silent: string[] = [];
    warnAboutSsrSeo({
      ...defaults.ctx,
      logger: { ...defaults.ctx.logger, warn: (m: string) => silent.push(m) },
    });
    expect(silent).toEqual([]);

    // An explicit `off` is the operator saying "leave them alone": silent.
    const off = ssrContext({ configDocument: { seo: { robots: 'off', sitemap: 'off' } } });
    const offWarnings: string[] = [];
    warnAboutSsrSeo({
      ...off.ctx,
      logger: { ...off.ctx.logger, warn: (m: string) => offWarnings.push(m) },
    });
    expect(offWarnings).toEqual([]);
  });
});
