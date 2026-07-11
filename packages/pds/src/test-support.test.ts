import { describe, expect, it } from 'vitest';

import { createTestContext } from './test-support.js';

describe('createTestContext', () => {
  it('builds a complete pds context with merged, validated config defaults', () => {
    const ctx = createTestContext({ config: { pds: { name: 'Ant', secretName: 's' } } });
    expect(ctx.env).toBe('test');
    expect(ctx.domain).toBeUndefined();
    expect(ctx.config.pds?.name).toBe('Ant');
    expect(ctx.config.paths.publicDir).toBe('public'); // defaults survive
    ctx.logger.info('silent by default');
    expect(() => createTestContext({ config: { siteName: 'Bad Name' } })).toThrow(/siteName/);
  });

  it('wires an isolated in-memory filesystem port', async () => {
    const ctx = createTestContext();
    await ctx.ports.fs.writeText('/repo/file.txt', 'hello');
    expect(await ctx.ports.fs.readText('/repo/file.txt')).toBe('hello');
    expect(await createTestContext().ports.fs.exists('/repo/file.txt')).toBe(false);
  });

  it('rejects any secrets call a test did not explicitly override', async () => {
    const ctx = createTestContext();
    await expect(ctx.clients.secrets.getSecretValue('name')).rejects.toThrow(
      /unexpected AWS request/,
    );
  });

  it('routes overridden secrets methods to the test double, leaving the rest guarded', async () => {
    const ctx = createTestContext({
      clients: { secrets: { getSecretValue: async () => 'stored' } },
    });
    expect(await ctx.clients.secrets.getSecretValue('name')).toBe('stored');
    await expect(ctx.clients.secrets.describeSecret('name')).rejects.toThrow(
      /unexpected AWS request/,
    );
  });

  it('rejects a terminal prompt a test did not script', async () => {
    const ctx = createTestContext();
    await expect(ctx.ports.terminal.question('Paste: ')).rejects.toThrow(
      /unexpected terminal prompt/,
    );
    expect(ctx.ports.terminal.isInteractive).toBe(false);
  });
});
