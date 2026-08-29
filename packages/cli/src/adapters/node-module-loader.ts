/**
 * Node adapter for the ModuleLoader port: the only file outside the
 * composition root that imports `node:module`. Resolution goes through
 * `createRequire` anchored on the caller's directory (Node's own CJS/ESM
 * resolver, which understands `exports` maps, symlinked `node_modules`, and
 * pnpm's workspace layout); loading goes through a dynamic `import()` over
 * the resolved file's URL, so both CJS and ESM plugin packages work.
 */

import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ModuleLoader, ModuleResolution } from '../ports.js';

function isModuleNotFound(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';
}

/** Wrap a resolver failure with the specifier and directory, preserving the cause. */
function resolutionFailure(
  operation: string,
  specifier: string,
  fromDir: string,
  err: unknown,
): Error {
  return new Error(
    `failed to ${operation} "${specifier}" from ${fromDir}: ${(err as Error).message}`,
    { cause: err },
  );
}

/**
 * Resolve `specifier`'s entry-point file via `require.resolve`, anchored on
 * `fromDir`. A missing module (`MODULE_NOT_FOUND`) is a normal "not
 * installed" outcome and returns `{ found: false }`; anything else - a
 * malformed specifier, an `exports` map that blocks the subpath, a
 * filesystem error - is unexpected and raises with context.
 */
function resolveEntryPoint(specifier: string, fromDir: string): ModuleResolution {
  const require = createRequire(join(fromDir, 'package.json'));
  try {
    return { found: true, path: require.resolve(specifier) };
  } catch (err) {
    if (isModuleNotFound(err)) return { found: false };
    throw resolutionFailure('resolve', specifier, fromDir, err);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from `entryFile` to the nearest `package.json`. This - not
 * `require.resolve('<specifier>/package.json')` - is how `packageJsonPathFor`
 * finds a plugin's manifest.
 *
 * The direct subpath throws under Node's exports encapsulation whenever a
 * package's `exports` map omits `"./package.json"`, which is true of every
 * published package in this repo:
 *
 * ```
 * require.resolve('blogwright-pds/package.json')
 *   -> ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './package.json' is not
 *      defined by "exports" in .../blogwright-pds/package.json
 * ```
 *
 * (verified 2026-07-26 against this workspace; `blogwright-pds`'s `exports`
 * map lists only `.` and `./rkey`). Walking up from the already-resolved
 * entry file sidesteps `exports` entirely - it is a directory walk over the
 * real filesystem, not a second module resolution - so it works against any
 * package regardless of what its `exports` map declares. A map-backed test
 * fake cannot reproduce the throw above (a fake has no `exports` map to
 * enforce), which is why this behaviour is proven by an integration test
 * against this real adapter (`node-module-loader.test.ts`) rather than a fake.
 * Do not "simplify" this back to the direct subpath.
 */
async function nearestPackageJson(entryFile: string): Promise<ModuleResolution> {
  let dir = dirname(entryFile);
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (await fileExists(candidate)) return { found: true, path: candidate };
    const parent = dirname(dir);
    if (parent === dir) return { found: false };
    dir = parent;
  }
}

/** Build the real Node adapter for the ModuleLoader port. */
export function createNodeModuleLoader(): ModuleLoader {
  return {
    async resolve(specifier, fromDir) {
      return resolveEntryPoint(specifier, fromDir);
    },

    async packageJsonPathFor(specifier, fromDir) {
      const entry = resolveEntryPoint(specifier, fromDir);
      if (!entry.found) return entry;
      const manifest = await nearestPackageJson(entry.path);
      if (!manifest.found) {
        // The walk reached the filesystem root with no package.json above a
        // module Node itself just resolved - an environment inconsistency,
        // not a "not installed" outcome, so it raises rather than reporting
        // `{ found: false }`.
        throw resolutionFailure(
          'locate the package.json for',
          specifier,
          fromDir,
          new Error(`no package.json found above resolved entry point ${entry.path}`),
        );
      }
      return manifest;
    },

    async load(path) {
      try {
        return (await import(pathToFileURL(path).href)) as unknown;
      } catch (err) {
        throw new Error(`failed to load module at ${path}: ${(err as Error).message}`, {
          cause: err,
        });
      }
    },
  };
}
