import { describe, expect, it } from 'vitest';

import { mergeConfig, type SsrConfig } from './config.js';
import { entryShim, runtimeEntryPoint } from './entry-shim.js';

function ssr(block: Record<string, unknown>): SsrConfig {
  const config = mergeConfig({ siteName: 'example', region: 'us-east-1', ssr: block });
  if (!config.ssr) throw new Error('fixture has no ssr block');
  return config.ssr;
}

describe('entryShim', () => {
  it('is absent without ssr.shim, so the revision starts the entry itself', () => {
    const config = ssr({ entryPoint: 'server/lambda.mjs' });
    expect(entryShim(config)).toBeUndefined();
    expect(runtimeEntryPoint(config)).toBe('server/lambda.mjs');
  });

  it('sits beside the entry, imports it relatively, and is what the revision starts', () => {
    const config = ssr({ entryPoint: 'server/entry.mjs', shim: { host: 'HOST', port: 'PORT' } });
    const shim = entryShim(config);
    expect(shim?.path).toBe('server/blogwright-entry.mjs');
    expect(runtimeEntryPoint(config)).toBe('server/blogwright-entry.mjs');
    expect(shim?.source).toContain('process.env["HOST"] = host;');
    expect(shim?.source).toContain('process.env["PORT"] = endpoint.slice(colon + 1);');
    expect(shim?.source).toMatch(/await import\("\.\/entry\.mjs"\);\n$/);
  });

  it('places a root entry shim at the archive root and sets only the port without a host', () => {
    const shim = entryShim(ssr({ shim: { port: 'PORT' } }));
    expect(shim?.path).toBe('blogwright-entry.mjs');
    expect(shim?.source).toContain('await import("./index.js");');
    expect(shim?.source).not.toContain('const host');
  });
});
