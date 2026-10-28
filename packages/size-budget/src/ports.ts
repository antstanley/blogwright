/**
 * The two boundaries the size budget measures through: the pnpm workspace
 * (packing, the lockfile-resolved dependency tree, the installed files) and
 * the npm registry (published sizes of platform-specific packages this host
 * did not install). Everything else in the package is pure and is tested
 * against fakes of these ports.
 */

/** npm's `os`/`cpu`/`libc` install constraints, as a manifest declares them. */
export interface PlatformConstraints {
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
  readonly libc?: readonly string[];
}

/** A workspace package that is published to npm (not `private`). */
export interface PublishablePackage {
  readonly name: string;
  /** Absolute path of the package directory. */
  readonly dir: string;
}

/**
 * One transitive production dependency at the version the lockfile resolved.
 * Optional platform variants appear even when this host did not install them.
 */
export interface LockedDependency {
  readonly name: string;
  /** An exact version, or `link:<relative path>` for a workspace package. */
  readonly version: string;
  /** Where pnpm installs it; nothing exists there for a skipped optional variant. */
  readonly path: string;
}

/** What the registry publishes about one exact version. */
export interface PublishedVersion extends PlatformConstraints {
  /** `dist.unpackedSize` in bytes; old publishes predate the field. */
  readonly unpackedSize: number | undefined;
}

export interface Workspace {
  publishablePackages(): Promise<PublishablePackage[]>;
  /** Pack the package exactly as the release workflow does and return the gzipped tarball. */
  pack(pkg: PublishablePackage): Promise<Uint8Array>;
  /** Every transitive production dependency, deduplicated by install path. */
  productionDependencies(pkg: PublishablePackage): Promise<LockedDependency[]>;
  /** The platform constraints of the manifest at `path`, or `undefined` when nothing is installed there. */
  installedConstraints(path: string): Promise<PlatformConstraints | undefined>;
  /** Total bytes of the regular files under `path`. */
  directorySize(path: string): Promise<number>;
}

export interface Registry {
  publishedVersion(name: string, version: string): Promise<PublishedVersion>;
}
