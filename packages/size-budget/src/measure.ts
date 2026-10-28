/**
 * Install size: what installing one published package adds to a consumer's
 * node_modules - the package's own unpacked files plus every transitive
 * production dependency at the version the lockfile resolved, measured for
 * {@link INSTALL_TARGET}. Workspace dependencies count at their packed size,
 * the form a consumer receives them in.
 */

import { installsOn, isPlatformSpecific, type PlatformTarget } from './platform.js';
import type { LockedDependency, PublishablePackage, Registry, Workspace } from './ports.js';
import { measureTarball } from './tarball.js';

/** pnpm's version prefix for a workspace dependency. */
const WORKSPACE_VERSION_PREFIX = 'link:';

/** Stable, locale-independent ordering for package names and dependency ids. */
const NAME_ORDER = new Intl.Collator('en');

export interface MeasurementPorts {
  readonly workspace: Workspace;
  readonly registry: Registry;
}

interface DependencySize {
  /** `name@version`. */
  readonly id: string;
  readonly size: number;
}

export interface PackageMeasurement {
  readonly name: string;
  /** The package's own unpacked size, in bytes. */
  readonly ownSize: number;
  /** Own size plus every dependency installed on the target, in bytes. */
  readonly installSize: number;
  /** The dependencies counted in `installSize`, largest first. */
  readonly dependencies: readonly DependencySize[];
}

/** Measure every publishable package, sorted by name. */
export async function measureWorkspace(
  ports: MeasurementPorts,
  target: PlatformTarget,
): Promise<PackageMeasurement[]> {
  const packages = await ports.workspace.publishablePackages();
  const ownSizes = new Map<string, number>();
  for (const pkg of packages) {
    ownSizes.set(pkg.name, measureTarball(await ports.workspace.pack(pkg)).unpackedSize);
  }

  const sizer = new DependencySizer(ports, target, ownSizes);
  const measurements: PackageMeasurement[] = [];
  for (const pkg of packages) {
    measurements.push(await measurePackage(pkg, ownSizes, sizer, ports.workspace));
  }
  return measurements.sort((a, b) => NAME_ORDER.compare(a.name, b.name));
}

async function measurePackage(
  pkg: PublishablePackage,
  ownSizes: ReadonlyMap<string, number>,
  sizer: DependencySizer,
  workspace: Workspace,
): Promise<PackageMeasurement> {
  const ownSize = ownSizes.get(pkg.name) ?? 0;
  const dependencies: DependencySize[] = [];
  for (const dependency of await workspace.productionDependencies(pkg)) {
    const size = await sizer.size(dependency);
    if (size !== undefined)
      dependencies.push({ id: `${dependency.name}@${dependency.version}`, size });
  }
  dependencies.sort((a, b) => b.size - a.size || NAME_ORDER.compare(a.id, b.id));
  const installSize = dependencies.reduce((total, dependency) => total + dependency.size, ownSize);
  return { name: pkg.name, ownSize, installSize, dependencies };
}

/**
 * Sizes dependencies, memoised by install path because the published
 * packages share most of their tree (the CLI depends on core and pds).
 */
class DependencySizer {
  private readonly sizes = new Map<string, Promise<number | undefined>>();

  constructor(
    private readonly ports: MeasurementPorts,
    private readonly target: PlatformTarget,
    private readonly ownSizes: ReadonlyMap<string, number>,
  ) {}

  /** Bytes the dependency adds on the target, or `undefined` when the target does not install it. */
  size(dependency: LockedDependency): Promise<number | undefined> {
    let size = this.sizes.get(dependency.path);
    if (size === undefined) {
      size = this.measure(dependency);
      this.sizes.set(dependency.path, size);
    }
    return size;
  }

  private async measure(dependency: LockedDependency): Promise<number | undefined> {
    if (dependency.version.startsWith(WORKSPACE_VERSION_PREFIX)) {
      return this.workspaceSize(dependency);
    }
    const installed = await this.ports.workspace.installedConstraints(dependency.path);
    if (installed !== undefined && !isPlatformSpecific(installed)) {
      return this.ports.workspace.directorySize(dependency.path);
    }
    return this.platformVariantSize(dependency);
  }

  private workspaceSize(dependency: LockedDependency): number {
    const size = this.ownSizes.get(dependency.name);
    if (size === undefined) {
      throw new Error(
        `${dependency.name} is a workspace dependency of a published package but is not published itself - consumers could not install it`,
      );
    }
    return size;
  }

  /**
   * A platform variant counts at its published size when the target installs
   * it - whichever variant this host happened to install - so every host
   * measures the same tree.
   */
  private async platformVariantSize(dependency: LockedDependency): Promise<number | undefined> {
    const id = `${dependency.name}@${dependency.version}`;
    const published = await this.ports.registry.publishedVersion(
      dependency.name,
      dependency.version,
    );
    if (!isPlatformSpecific(published)) {
      throw new Error(
        `${id} is in the lockfile but not installed at ${dependency.path}, and it declares no os/cpu/libc constraint that would explain why - run pnpm install`,
      );
    }
    if (!installsOn(published, this.target)) return undefined;
    if (published.unpackedSize === undefined) {
      throw new Error(
        `the registry publishes no unpacked size for ${id}, so its install size cannot be measured`,
      );
    }
    return published.unpackedSize;
  }
}
