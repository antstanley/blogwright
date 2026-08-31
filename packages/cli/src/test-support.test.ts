import { createNodeFileSystem, findRepoRoot, type Plugin } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import {
  buildDiscoveryPorts,
  createRecordingPackageManager,
  createTestContext,
  TEST_AGENT_DIR,
  withBrokenPlugin,
} from './test-support.js';

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

  it('defaults agentDir to TEST_AGENT_DIR and honours an override', () => {
    expect(createTestContext().agentDir).toBe(TEST_AGENT_DIR);
    expect(createTestContext({ agentDir: '/elsewhere/agent' }).agentDir).toBe('/elsewhere/agent');
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

describe('createRecordingPackageManager', () => {
  it('answers detect with the configured manager, defaulting to pnpm', async () => {
    await expect(createRecordingPackageManager().detect('/repo')).resolves.toBe('pnpm');
    await expect(createRecordingPackageManager('yarn').detect('/repo')).resolves.toBe('yarn');
  });

  it('records add/remove calls instead of spawning a process', async () => {
    const packages = createRecordingPackageManager();

    await packages.add('blogwright-analytics', { dev: true, exact: true });
    await packages.remove('blogwright-pds');

    expect(packages.calls).toEqual([
      { op: 'add', spec: 'blogwright-analytics', opts: { dev: true, exact: true } },
      { op: 'remove', name: 'blogwright-pds' },
    ]);
  });
});

/** A fixture plugin for the {@link withBrokenPlugin} cases below. */
const HEALTHY_PLUGIN: Plugin = {
  name: 'widget',
  description: 'manage widgets',
  commands: [{ action: 'sync', summary: 'sync widgets', run: async () => undefined }],
};

describe('withBrokenPlugin', () => {
  it('joins the broken candidate onto the consumer manifest, keeping every other field it already declared', async () => {
    // `collectCandidates` (`plugins.ts`) unions `dependencies` AND
    // `devDependencies`, so a helper that rewrote the manifest down to a
    // lone `dependencies` key would erase half the candidate set of any
    // fixture that seeded the other half - silently, since the erased
    // plugins simply stop being discovered rather than failing.
    const base = await buildDiscoveryPorts([
      { packageName: 'blogwright-metrics', namespace: 'widget', plugin: HEALTHY_PLUGIN },
    ]);
    const repoRoot = await findRepoRoot(createNodeFileSystem());
    const manifestPath = `${repoRoot}/package.json`;
    const seeded: unknown = JSON.parse(await base.fs.readText(manifestPath));
    await base.fs.writeText(
      manifestPath,
      JSON.stringify({ ...(seeded as object), devDependencies: { 'blogwright-dev': '1.0.0' } }),
    );

    const { fs } = await withBrokenPlugin(base, 'blogwright-broken');

    expect(JSON.parse(await fs.readText(manifestPath))).toEqual({
      dependencies: { 'blogwright-metrics': '1.0.0', 'blogwright-broken': '1.0.0' },
      devDependencies: { 'blogwright-dev': '1.0.0' },
    });
  });
});
