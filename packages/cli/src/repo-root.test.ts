import { createMemoryFileSystem } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { findRepoRoot } from './repo-root.js';

describe('findRepoRoot', () => {
  it('walks up from a nested directory to the .git directory', async () => {
    const fs = createMemoryFileSystem({ '/repo/.git/HEAD': 'ref: refs/heads/main\n' });
    await expect(findRepoRoot(fs, '/repo/packages/cli')).resolves.toBe('/repo');
    await expect(findRepoRoot(fs, '/repo')).resolves.toBe('/repo');
  });

  it('accepts a .git file (worktree checkout)', async () => {
    const fs = createMemoryFileSystem({ '/repo/.git': 'gitdir: /elsewhere\n' });
    await expect(findRepoRoot(fs, '/repo')).resolves.toBe('/repo');
  });

  it('accepts a .jj repo', async () => {
    const fs = createMemoryFileSystem({ '/repo/.jj/repo/store/type': 'git\n' });
    await expect(findRepoRoot(fs, '/repo/src')).resolves.toBe('/repo');
  });

  it('throws when no VCS directory exists above the start', async () => {
    const fs = createMemoryFileSystem({ '/repo/readme.md': 'no vcs here' });
    await expect(findRepoRoot(fs, '/repo/src')).rejects.toThrow(/repo root.*\/repo\/src/);
  });
});
