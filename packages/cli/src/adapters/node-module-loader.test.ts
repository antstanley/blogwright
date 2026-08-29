/**
 * Integration tests for the ModuleLoader node adapter, exercised against real
 * packages on a real disk (`makeTempDir`/`removeTempDir`). A map-backed fake
 * cannot model Node's `exports` encapsulation, so the load-bearing behaviour
 * here - `packageJsonPathFor` succeeding where `require.resolve('<name>/package.json')`
 * throws - is proven only by the real adapter.
 */

import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempDir, removeTempDir } from '../test-support.js';
import { createNodeModuleLoader } from './node-module-loader.js';

const loader = createNodeModuleLoader();
let root: string;

/**
 * Build `<root>/node_modules/<name>` with the given `exports` map and an
 * `index.js` that exports `value`. Mirrors `blogwright-pds`'s shape: an
 * `exports` map that lists `.` but not `./package.json`, which is what makes
 * `require.resolve('<name>/package.json')` throw under Node's exports
 * encapsulation.
 */
async function writeFakePackage(
  packagesRoot: string,
  name: string,
  exports: Record<string, string>,
  value: string,
): Promise<void> {
  const dir = join(packagesRoot, 'node_modules', name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', type: 'module', exports }, undefined, 2),
  );
  await writeFile(join(dir, 'index.js'), `export const value = ${JSON.stringify(value)};\n`);
}

beforeEach(async () => {
  // realpath: on macOS, os.tmpdir() lives under a /var symlink to /private/var,
  // and Node's module resolver returns the real (symlink-resolved) path, so
  // the two must be compared on equal footing.
  root = await realpath(await makeTempDir('node-module-loader'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0' }));
  // Shaped like blogwright-pds: exports "." but not "./package.json".
  await writeFakePackage(root, 'fake-pkg', { '.': './index.js' }, 'hello');
  // Shaped like blogwright itself: exports a subpath but not ".".
  await writeFakePackage(root, 'no-entry-pkg', { './sub': './index.js' }, 'unreachable');
});

afterEach(async () => {
  await removeTempDir(root);
});

describe('createNodeModuleLoader resolve', () => {
  it('resolves an installed package to its entry-point file', async () => {
    const result = await loader.resolve('fake-pkg', root);
    expect(result).toEqual({ found: true, path: join(root, 'node_modules/fake-pkg/index.js') });
  });

  it('reports an uninstalled specifier as not found rather than throwing', async () => {
    const result = await loader.resolve('does-not-exist-anywhere', root);
    expect(result).toEqual({ found: false });
  });

  it('raises a contextual error - not { found: false } - for a resolution failure that is not a missing module', async () => {
    // no-entry-pkg exists on disk, but its exports map has no "." entry, so
    // resolving the bare specifier throws ERR_PACKAGE_PATH_NOT_EXPORTED, not
    // MODULE_NOT_FOUND. That distinction is why blogwright's own bare
    // specifier can't be resolved through this port either (see
    // ports.ts:packageJsonPathFor's doc comment).
    await expect(loader.resolve('no-entry-pkg', root)).rejects.toThrow(
      /failed to resolve "no-entry-pkg" from .*: .*/,
    );
  });
});

describe('createNodeModuleLoader packageJsonPathFor', () => {
  it('resolves the nearest package.json by walking up from the entry point, for a package whose exports map omits "./package.json"', async () => {
    const result = await loader.packageJsonPathFor('fake-pkg', root);
    expect(result).toEqual({
      found: true,
      path: join(root, 'node_modules/fake-pkg/package.json'),
    });
  });

  it('reports an uninstalled specifier as not found', async () => {
    const result = await loader.packageJsonPathFor('does-not-exist-anywhere', root);
    expect(result).toEqual({ found: false });
  });

  it('contrast: require.resolve of the direct subpath throws ERR_PACKAGE_PATH_NOT_EXPORTED for the same package', () => {
    // This is the failure packageJsonPathFor exists to avoid. Proven here
    // against the real adapter's resolver, not a map-backed fake - a fake has
    // no exports map to enforce, so it cannot reproduce this throw.
    const require = createRequire(join(root, 'package.json'));
    // Built at runtime, not a literal argument: a literal `require.resolve('fake-pkg/…')`
    // reads to static analysis (knip) as a dependency on a package named "fake-pkg".
    const packageJsonSubpath = ['fake-pkg', 'package.json'].join('/');
    let caught: unknown;
    try {
      require.resolve(packageJsonSubpath);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as NodeJS.ErrnoException).code).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });
});

describe('createNodeModuleLoader load', () => {
  it('imports the module at a resolved path', async () => {
    const resolved = await loader.resolve('fake-pkg', root);
    if (!resolved.found) throw new Error('expected fake-pkg to resolve');

    const mod = await loader.load(resolved.path);
    expect(mod).toMatchObject({ value: 'hello' });
  });

  it('translates a load failure into a contextual error', async () => {
    await expect(loader.load(join(root, 'node_modules/fake-pkg/missing.js'))).rejects.toThrow(
      /failed to load module at .*missing\.js/,
    );
  });
});
