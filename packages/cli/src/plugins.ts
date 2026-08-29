/**
 * Plugin discovery: finds every installed `blogwright-*` package that
 * declares a `blogwright.plugin` manifest field, loads it, and validates its
 * default export against core's `Plugin` contract.
 *
 * The candidate set is the UNION of two sources, each resolved from its own
 * directory - see `collectCandidates` below - because a consuming repo
 * depends on `blogwright`, not on `blogwright-pds`: scanning the consumer's
 * own `package.json` alone would never find a plugin bundled inside the CLI
 * itself.
 *
 * Collect, never throw, for anything candidate-specific: a broken plugin -
 * one that fails to resolve, whose manifest is malformed, or whose default
 * export fails validation - becomes an entry in `failures`, not a thrown
 * error that aborts the whole discovery pass. One bad dependency must not
 * make `blogwright deploy` (or any other built-in command) unusable. The
 * only things this module *does* throw for are the two preconditions
 * discovery cannot proceed without at all: the repo's own `package.json` and
 * the CLI's own `package.json`, both read before any candidate is resolved.
 */

import { join } from 'node:path';

import {
  FileNotFoundError,
  PLUGIN_NAME_PATTERN,
  validatePlugin,
  type FileSystem,
  type Plugin,
  type PluginManifest,
} from 'blogwright-core';

import type { Ports } from './ports.js';

/** Only a dependency name starting with this becomes a plugin candidate. */
const PLUGIN_PACKAGE_PREFIX = 'blogwright-';

/** One candidate package to probe, and the directory it resolves from. */
interface Candidate {
  readonly packageName: string;
  readonly fromDir: string;
}

/** Why one candidate package failed to become a usable plugin. */
interface PluginLoadFailure {
  readonly packageName: string;
  readonly reason: string;
}

/** `discover`'s result: both collections are always arrays, never `null`/`undefined`. */
export interface DiscoveryResult {
  readonly plugins: readonly Plugin[];
  readonly failures: readonly PluginLoadFailure[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The subset of a `package.json` discovery reads to find plugin candidates. */
interface DependencyManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Read and parse `<dir>/package.json` through `ports.fs`, raising an error
 * naming the path, `role`, and what would fix it when the file is absent or
 * unparseable. This is a discovery precondition, not a per-candidate outcome
 * - unlike a broken plugin, a repo or CLI install with no readable
 * `package.json` leaves discovery with nothing to work from at all, so it
 * aborts the whole pass rather than returning an empty result.
 */
async function readDependencyManifest(
  fs: FileSystem,
  packageJsonPath: string,
  role: string,
): Promise<DependencyManifest> {
  let text: string;
  try {
    text = await fs.readText(packageJsonPath);
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      throw new Error(
        `no package.json found at ${packageJsonPath} for ${role} - plugin discovery reads its ` +
          '"dependencies"/"devDependencies" to find installed blogwright-* plugins; create one there.',
        { cause: err },
      );
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `failed to parse ${packageJsonPath} as JSON for ${role}: ${(err as Error).message}`,
      { cause: err },
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`${packageJsonPath} for ${role} must contain a JSON object, not ${text}`);
  }
  return parsed as DependencyManifest;
}

/** Every `dependencies`/`devDependencies` name starting with `blogwright-`, deduplicated and sorted. */
function pluginDependencyNames(pkg: DependencyManifest): string[] {
  const names = new Set<string>();
  for (const deps of [pkg.dependencies, pkg.devDependencies]) {
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (name.startsWith(PLUGIN_PACKAGE_PREFIX)) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * Build the candidate set: the consumer's own `blogwright-*` dependencies
 * (resolved from `repoRoot`) union the CLI's own bundled `blogwright-*`
 * dependencies (resolved from `cliPackageDir`). Both halves are required and
 * each is resolved from its own directory - see the module comment. Neither
 * `blogwright` nor `blogwright/package.json` is ever a candidate: the bare
 * name never matches the `blogwright-` prefix, so it is filtered out before
 * any resolution is attempted.
 */
async function collectCandidates(
  ports: Pick<Ports, 'fs' | 'loader'>,
  repoRoot: string,
  cliPackageDir: string,
): Promise<Candidate[]> {
  const consumerPkg = await readDependencyManifest(
    ports.fs,
    join(repoRoot, 'package.json'),
    'the consuming repo',
  );
  const cliPkg = await readDependencyManifest(
    ports.fs,
    join(cliPackageDir, 'package.json'),
    "the CLI's own package",
  );

  const consumerCandidates = pluginDependencyNames(consumerPkg).map(
    (packageName): Candidate => ({ packageName, fromDir: repoRoot }),
  );
  const bundledCandidates = pluginDependencyNames(cliPkg).map(
    (packageName): Candidate => ({ packageName, fromDir: cliPackageDir }),
  );
  return [...consumerCandidates, ...bundledCandidates];
}

/** Validate a raw `blogwright` field into a `PluginManifest`, or `undefined` when it does not hold. */
function parsePluginManifest(value: unknown): PluginManifest | undefined {
  if (!isRecord(value)) return undefined;
  const plugin = value.plugin;
  if (typeof plugin !== 'string' || !PLUGIN_NAME_PATTERN.test(plugin)) return undefined;
  return { plugin };
}

type CandidateOutcome =
  | { kind: 'plugin'; plugin: Plugin }
  | { kind: 'failure'; failure: PluginLoadFailure }
  | { kind: 'absent' }
  | { kind: 'not-a-plugin' };

/**
 * Resolve, read, and (when it declares a plugin) load and validate one
 * candidate. Every step past `packageJsonPathFor`'s `{ found: false }` branch
 * runs inside one try/catch: any unexpected failure - a resolution error a
 * downgraded resolver would raise (see `ModuleLoader.packageJsonPathFor`'s
 * doc comment), an unreadable or unparseable manifest, or a `validatePlugin`
 * rejection - becomes a `failure` naming `candidate.packageName`, never a
 * thrown error, per the collect-versus-throw choice in the module comment.
 */
async function loadCandidate(
  candidate: Candidate,
  ports: Pick<Ports, 'fs' | 'loader'>,
): Promise<CandidateOutcome> {
  try {
    const manifestPath = await ports.loader.packageJsonPathFor(
      candidate.packageName,
      candidate.fromDir,
    );
    // Declared as a dependency but not actually resolvable (e.g. an
    // out-of-sync lockfile, an optional dependency never installed): nothing
    // to report, since it is not installed at all rather than broken.
    if (!manifestPath.found) return { kind: 'absent' };

    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(await ports.fs.readText(manifestPath.path));
    } catch (err) {
      throw new Error(`failed to read or parse ${manifestPath.path}: ${(err as Error).message}`, {
        cause: err,
      });
    }
    if (!isRecord(manifestJson) || manifestJson.blogwright === undefined) {
      // No `blogwright.plugin` field at all: not a plugin. Skipped silently,
      // per §CLI → Plugin discovery - most of a repo's blogwright-* deps
      // (blogwright-core itself, for one) are not plugins.
      return { kind: 'not-a-plugin' };
    }

    const manifest = parsePluginManifest(manifestJson.blogwright);
    if (!manifest) {
      throw new Error(
        `${manifestPath.path}'s "blogwright" field is malformed - expected ` +
          `{ "plugin": "<namespace>" } with a namespace matching ${PLUGIN_NAME_PATTERN}`,
      );
    }

    const entry = await ports.loader.resolve(candidate.packageName, candidate.fromDir);
    if (!entry.found) {
      throw new Error(
        `declares plugin namespace "${manifest.plugin}" in ${manifestPath.path} but could not ` +
          `be resolved as an entry point from ${candidate.fromDir}`,
      );
    }

    const mod = await ports.loader.load(entry.path);
    return { kind: 'plugin', plugin: validatePlugin(mod, candidate.packageName) };
  } catch (err) {
    return {
      kind: 'failure',
      failure: { packageName: candidate.packageName, reason: (err as Error).message },
    };
  }
}

/**
 * Discover every installed plugin reachable from `repoRoot` (the consuming
 * repo) and `cliPackageDir` (the CLI's own package directory, from
 * {@link cliPackageDir} in `context.ts`). Never throws for a candidate-level
 * problem - see the module comment - only for the two repo-level
 * preconditions `collectCandidates` reads first.
 */
export async function discover(
  repoRoot: string,
  cliPackageDir: string,
  ports: Pick<Ports, 'fs' | 'loader'>,
): Promise<DiscoveryResult> {
  const candidates = await collectCandidates(ports, repoRoot, cliPackageDir);

  const plugins: Plugin[] = [];
  const failures: PluginLoadFailure[] = [];
  for (const candidate of candidates) {
    const outcome = await loadCandidate(candidate, ports);
    if (outcome.kind === 'plugin') plugins.push(outcome.plugin);
    else if (outcome.kind === 'failure') failures.push(outcome.failure);
  }

  return { plugins, failures };
}
