import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { agentSourceHash } from './agent-package.js';

/** Build a minimal build-agent + sibling ops-core source tree under a temp dir. */
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-'));
  const agent = join(root, 'build-agent');
  const core = join(root, 'core');
  await mkdir(join(agent, 'src'), { recursive: true });
  await mkdir(join(core, 'src', 'aws'), { recursive: true });
  await writeFile(join(agent, 'Dockerfile'), 'FROM base\n');
  await writeFile(join(agent, 'package.json'), '{"name":"agent"}');
  await writeFile(join(agent, 'src', 'server.ts'), 'export const s = 1;');
  await writeFile(join(core, 'package.json'), '{"name":"core"}');
  await writeFile(join(core, 'src', 'aws', 's3.ts'), 'export const s3 = 1;');
  return agent;
}

describe('agentSourceHash', () => {
  it('is deterministic and 12 hex chars', async () => {
    const dir = await fixture();
    const a = await agentSourceHash(dir);
    const b = await agentSourceHash(dir);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it('ignores test files', async () => {
    const dir = await fixture();
    const before = await agentSourceHash(dir);
    await writeFile(join(dir, 'src', 'server.test.ts'), 'test only');
    expect(await agentSourceHash(dir)).toBe(before);
  });

  it('changes when build-agent source changes', async () => {
    const dir = await fixture();
    const before = await agentSourceHash(dir);
    await writeFile(join(dir, 'src', 'server.ts'), 'export const s = 2;');
    expect(await agentSourceHash(dir)).not.toBe(before);
  });

  it('changes when the bundled ops-core source changes', async () => {
    const dir = await fixture();
    const before = await agentSourceHash(dir);
    await writeFile(join(dir, '..', 'core', 'src', 'aws', 's3.ts'), 'export const s3 = 2;');
    expect(await agentSourceHash(dir)).not.toBe(before);
  });
});
