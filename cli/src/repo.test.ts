import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildRepoZip } from './repo.js';

describe('buildRepoZip', () => {
  it('zips the given files preserving relative paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'repo-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'package.json'), '{"name":"x"}');
    await writeFile(join(dir, 'src/index.ts'), 'export const a = 1;');

    const zip = await buildRepoZip(dir, ['package.json', 'src/index.ts']);
    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual(['package.json', 'src/index.ts']);
    expect(new TextDecoder().decode(entries['package.json'])).toBe('{"name":"x"}');
  });
});
