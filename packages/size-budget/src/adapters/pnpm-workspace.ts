/**
 * Workspace adapter: shells out to pnpm for the package list and packing, and
 * reads the installed dependency tree from node_modules. The tree is walked
 * the way Node resolves it rather than taken from `pnpm list`, whose JSON
 * omits some transitive dependencies. Failures are translated with the
 * command or path before they cross the port.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

import type {
  LockedDependency,
  PlatformConstraints,
  PublishablePackage,
  Workspace,
} from '../ports.js';

const run = promisify(execFile);

/** `pnpm ls -r --json` lists every project; headroom over the 1 MiB default buffer. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const TARBALL_EXTENSION = '.tgz';
const NODE_MODULES = 'node_modules';

/** A version that names one release; a range cannot say which variant the lockfile resolved. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

async function pnpm(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('pnpm', args, { cwd, maxBuffer: MAX_OUTPUT_BYTES });
    return stdout;
  } catch (err) {
    throw new Error(`pnpm ${args.join(' ')} failed in ${cwd}: ${(err as Error).message}`, {
      cause: err,
    });
  }
}

function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${source} is not JSON: ${(err as Error).message}`, { cause: err });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A manifest's name-to-spec map (`dependencies`, `optionalDependencies`). */
function specs(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

async function readManifest(dir: string): Promise<Record<string, unknown>> {
  const path = join(dir, 'package.json');
  const manifest = parseJson(await readFile(path, 'utf8'), path);
  if (!isRecord(manifest)) throw new Error(`${path} is not a JSON object`);
  return manifest;
}

/** Build the pnpm adapter for the workspace rooted at `root`. */
export function createPnpmWorkspace(root: string): Workspace {
  /** Where pnpm would install an exact version, used to key a variant this host skipped. */
  const virtualStorePath = (name: string, version: string): string =>
    join(root, NODE_MODULES, '.pnpm', `${name.replace('/', '+')}@${version}`, NODE_MODULES, name);

  /** Record every production dependency of the package at `dir`, transitively, once per real path. */
  async function collectDependencies(
    dir: string,
    found: Map<string, LockedDependency>,
  ): Promise<void> {
    const manifest = await readManifest(dir);
    const optional = specs(manifest['optionalDependencies']);
    const all = { ...specs(manifest['dependencies']), ...optional };
    for (const [name, spec] of Object.entries(all)) {
      const link = resolveInstalled(dir, name);
      if (link === undefined) {
        if (!(name in optional)) {
          throw new Error(`${name}, a dependency of ${dir}, is not installed - run pnpm install`);
        }
        recordSkippedOptional(dir, name, spec, found);
        continue;
      }
      const path = await realpath(link);
      if (found.has(path)) continue;
      found.set(path, { name, version: await installedVersion(path), path });
      await collectDependencies(path, found);
    }
  }

  /**
   * Node's lookup: `<dir>/node_modules/<name>`, then each parent directory's,
   * stopping at the workspace root so nothing outside the repository is read.
   */
  function resolveInstalled(dir: string, name: string): string | undefined {
    for (let current = dir; current.startsWith(root); current = dirname(current)) {
      if (basename(current) !== NODE_MODULES) {
        const candidate = join(current, NODE_MODULES, name);
        if (existsSync(candidate)) return candidate;
      }
      if (current === root) break;
    }
    return undefined;
  }

  /** A workspace package is versioned `link:<path>`, the form pnpm itself reports. */
  async function installedVersion(path: string): Promise<string> {
    if (!path.split(sep).includes(NODE_MODULES)) return `link:${relative(root, path)}`;
    const version = (await readManifest(path))['version'];
    if (typeof version !== 'string') throw new Error(`${path}/package.json has no version`);
    return version;
  }

  /** An optional dependency this host skipped - a platform variant, sized later from the registry. */
  function recordSkippedOptional(
    dir: string,
    name: string,
    spec: string,
    found: Map<string, LockedDependency>,
  ): void {
    if (!EXACT_VERSION.test(spec)) {
      throw new Error(
        `${name}, an optional dependency of ${dir}, is not installed here and its version "${spec}" is a range, so the variant the target installs cannot be determined`,
      );
    }
    const path = virtualStorePath(name, spec);
    if (!found.has(path)) found.set(path, { name, version: spec, path });
  }

  return {
    async publishablePackages(): Promise<PublishablePackage[]> {
      const listed = parseJson(
        await pnpm(root, ['ls', '-r', '--depth', '-1', '--json']),
        'pnpm ls -r --json output',
      );
      if (!Array.isArray(listed)) {
        throw new Error('pnpm ls -r --json did not print an array of projects');
      }
      return listed
        .filter(isRecord)
        .filter((project) => project['private'] !== true && project['path'] !== root)
        .map((project) => ({ name: String(project['name']), dir: String(project['path']) }));
    },

    async pack(pkg: PublishablePackage): Promise<Uint8Array> {
      await requireBuiltFiles(pkg);
      const destination = await mkdtemp(join(tmpdir(), 'size-budget-'));
      try {
        // pnpm pack, like the release workflow: it rewrites workspace: ranges.
        await pnpm(pkg.dir, ['pack', '--pack-destination', destination]);
        const tarballs = (await readdir(destination)).filter((file) =>
          file.endsWith(TARBALL_EXTENSION),
        );
        if (tarballs.length !== 1) {
          throw new Error(
            `pnpm pack in ${pkg.dir} wrote ${tarballs.length} tarballs, expected one`,
          );
        }
        return await readFile(join(destination, tarballs[0] ?? ''));
      } finally {
        await rm(destination, { recursive: true, force: true });
      }
    },

    async productionDependencies(pkg: PublishablePackage): Promise<LockedDependency[]> {
      const found = new Map<string, LockedDependency>();
      await collectDependencies(pkg.dir, found);
      return [...found.values()];
    },

    async installedConstraints(path: string): Promise<PlatformConstraints | undefined> {
      if (!existsSync(join(path, 'package.json'))) return undefined;
      return constraintsOf(await readManifest(path));
    },

    directorySize,
  };
}

/** Refuse to pack a package whose `files` are missing - an unbuilt package would measure small and pass. */
async function requireBuiltFiles(pkg: PublishablePackage): Promise<void> {
  const manifest = await readManifest(pkg.dir);
  const files = Array.isArray(manifest['files']) ? manifest['files'] : [];
  const missing = files.filter(
    (file): file is string => typeof file === 'string' && !existsSync(join(pkg.dir, file)),
  );
  if (missing.length > 0) {
    throw new Error(
      `${pkg.name} is not built (missing ${missing.join(', ')}) - run pnpm build first`,
    );
  }
}

function constraintsOf(manifest: Record<string, unknown>): PlatformConstraints {
  const constraints: { os?: string[]; cpu?: string[]; libc?: string[] } = {};
  for (const key of ['os', 'cpu', 'libc'] as const) {
    const list = manifest[key];
    if (Array.isArray(list)) {
      constraints[key] = list.filter((entry): entry is string => typeof entry === 'string');
    }
  }
  return constraints;
}

/** Sum of regular file sizes under `path`; symlinks are not followed or counted. */
async function directorySize(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile()) total += (await lstat(entryPath)).size;
  }
  return total;
}
