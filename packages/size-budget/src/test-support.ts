/** Test helpers: in-memory gzipped tarballs and fakes of the Workspace and Registry ports. */

import { gzipSync } from 'node:zlib';

import type {
  LockedDependency,
  PlatformConstraints,
  PublishablePackage,
  PublishedVersion,
  Registry,
  Workspace,
} from './ports.js';

export interface TarEntry {
  readonly name: string;
  /** ustar type flag: `'0'` file, `'5'` directory, `'x'` pax header. */
  readonly type: string;
  readonly content: string;
}

const BLOCK_SIZE = 512;

/** A minimal ustar header: name, octal size and type flag (the reader ignores checksums). */
export function tarHeader(entry: TarEntry): Buffer {
  const block = Buffer.alloc(BLOCK_SIZE);
  block.write(entry.name, 0, 'latin1');
  block.write(`${Buffer.byteLength(entry.content).toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  block.write(entry.type, 156, 'latin1');
  return block;
}

/** A gzipped tarball of `entries`, closed by the two zero blocks tar writes. */
export function tarball(entries: readonly TarEntry[]): Buffer {
  const blocks = entries.flatMap((entry) => {
    const data = Buffer.from(entry.content);
    const padded = Buffer.alloc(Math.ceil(data.length / BLOCK_SIZE) * BLOCK_SIZE);
    data.copy(padded);
    return [tarHeader(entry), padded];
  });
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(2 * BLOCK_SIZE)]));
}

export const tarFile = (name: string, content: string): TarEntry => ({ name, type: '0', content });

/** What the fake workspace knows about one installed (or absent) dependency. */
interface FakeInstall {
  readonly constraints?: PlatformConstraints;
  readonly size?: number;
}

export interface FakeWorkspaceOptions {
  /** Package name to its own unpacked size. */
  readonly packages: Readonly<Record<string, number>>;
  /** Package name to its flattened production dependencies. */
  readonly dependencies: Readonly<Record<string, readonly LockedDependency[]>>;
  /** Install path to what is installed there; a missing path is not installed. */
  readonly installed: Readonly<Record<string, FakeInstall>>;
}

export function createFakeWorkspace(options: FakeWorkspaceOptions): Workspace {
  return {
    publishablePackages: async (): Promise<PublishablePackage[]> =>
      Object.keys(options.packages).map((name) => ({ name, dir: `/repo/packages/${name}` })),
    pack: async (pkg) =>
      tarball([tarFile('package/index.js', 'x'.repeat(options.packages[pkg.name] ?? 0))]),
    productionDependencies: async (pkg) => [...(options.dependencies[pkg.name] ?? [])],
    installedConstraints: async (path) => {
      const install = options.installed[path];
      return install === undefined ? undefined : (install.constraints ?? {});
    },
    directorySize: async (path) => {
      const size = options.installed[path]?.size;
      if (size === undefined) throw new Error(`fake workspace: nothing sized at ${path}`);
      return size;
    },
  };
}

/** A registry answering from `versions`, keyed `name@version`; counts lookups. */
export function createFakeRegistry(
  versions: Readonly<Record<string, PublishedVersion>>,
): Registry & {
  readonly lookups: string[];
} {
  const lookups: string[] = [];
  return {
    lookups,
    publishedVersion: async (name, version) => {
      const id = `${name}@${version}`;
      lookups.push(id);
      const published = versions[id];
      if (published === undefined) throw new Error(`fake registry: no ${id}`);
      return published;
    },
  };
}

/** A dependency installed in pnpm's virtual store. */
export function locked(name: string, version: string): LockedDependency {
  return {
    name,
    version,
    path: `/repo/node_modules/.pnpm/${name}@${version}/node_modules/${name}`,
  };
}
