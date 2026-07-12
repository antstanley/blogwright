import { createMemoryFileSystem } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { deriveAppTag, loadConfig } from './context.js';

const ROOT = '/repo';

describe('loadConfig', () => {
  it('loads the per-environment file, stripping JSONC comments', async () => {
    const fs = createMemoryFileSystem({
      '/repo/config/production.jsonc': '{\n  // the slug\n  "siteName": "example"\n}\n',
    });
    const config = await loadConfig(fs, { env: 'production', root: ROOT });
    expect(config.siteName).toBe('example');
    expect(config.region).toBe('us-east-1'); // merged over defaults
  });

  it('falls back to ops.config.jsonc when the per-environment file is absent', async () => {
    const fs = createMemoryFileSystem({
      '/repo/ops.config.jsonc': '{"siteName": "fallback"}',
    });
    const config = await loadConfig(fs, { env: 'staging', root: ROOT });
    expect(config.siteName).toBe('fallback');
  });

  it('reads only the explicit path when one is given', async () => {
    const fs = createMemoryFileSystem({
      '/repo/config/production.jsonc': '{"siteName": "wrong"}',
      '/elsewhere/custom.jsonc': '{"siteName": "custom"}',
    });
    const config = await loadConfig(fs, {
      env: 'production',
      root: ROOT,
      configPath: '/elsewhere/custom.jsonc',
    });
    expect(config.siteName).toBe('custom');
  });

  it('names every candidate it looked for when none exists', async () => {
    const fs = createMemoryFileSystem();
    await expect(loadConfig(fs, { env: 'staging', root: ROOT })).rejects.toThrow(
      /no config found for environment "staging".*config\/staging\.jsonc.*ops\.config\.jsonc/,
    );
  });

  it('surfaces validation failures instead of trying the next candidate', async () => {
    const fs = createMemoryFileSystem({
      '/repo/config/production.jsonc': '{"region": "us-east-1"}', // no siteName
      '/repo/ops.config.jsonc': '{"siteName": "example"}',
    });
    await expect(loadConfig(fs, { env: 'production', root: ROOT })).rejects.toThrow(
      /siteName is required/,
    );
  });
});

describe('deriveAppTag', () => {
  it('prefers the explicit config option, then domain, then repo directory name', () => {
    expect(deriveAppTag({ app: 'my-app' }, 'blog.example.com', '/home/x/site')).toBe('my-app');
    expect(deriveAppTag({ app: undefined }, 'blog.example.com', '/home/x/site')).toBe(
      'blog.example.com',
    );
    expect(deriveAppTag({ app: undefined }, undefined, '/home/x/site')).toBe('site');
  });
});
