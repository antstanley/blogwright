import { describe, expect, it } from 'vitest';

import { createTestContext } from './test-support.js';

describe('createTestContext', () => {
  it('builds a complete context with derived defaults', async () => {
    const ctx = createTestContext();
    expect(ctx.env).toBe('test');
    expect(ctx.config.siteName).toBe('example');
    expect(ctx.names.bucket).toBe('test-example-123456789012');
    expect(ctx.state).toEqual({ version: 1, env: 'test', updatedAt: undefined, resources: {} });
    ctx.logger.info('silent by default');
    await expect(ctx.save()).resolves.toBeUndefined(); // no-op, never touches S3
  });

  it('merges config overrides over the defaults and validates them', () => {
    const ctx = createTestContext({
      env: 'production',
      config: { pds: { name: 'Ant', secretName: 's' } },
    });
    expect(ctx.config.pds?.name).toBe('Ant');
    expect(ctx.config.paths.publicDir).toBe('public'); // defaults survive
    expect(ctx.names.microvmImage).toBe('production-example-builder');
    expect(() => createTestContext({ config: { siteName: 'Bad Name' } })).toThrow(/siteName/);
  });

  it('wires an isolated in-memory filesystem port', async () => {
    const ctx = createTestContext();
    await ctx.ports.fs.writeText('/repo/file.txt', 'hello');
    expect(await ctx.ports.fs.readText('/repo/file.txt')).toBe('hello');
    expect(await createTestContext().ports.fs.exists('/repo/file.txt')).toBe(false);
  });

  it('rejects any AWS call a test did not explicitly override', async () => {
    const ctx = createTestContext();
    await expect(ctx.clients.sts.getAccountId()).rejects.toThrow(/unexpected AWS request/);
  });

  it('routes overridden client methods to the test double, leaving the rest guarded', async () => {
    const ctx = createTestContext({
      clients: { secrets: { getSecretValue: async () => 'stored' } },
    });
    expect(await ctx.clients.secrets.getSecretValue('name')).toBe('stored');
    await expect(ctx.clients.secrets.describeSecret('name')).rejects.toThrow(
      /unexpected AWS request/,
    );
  });
});
