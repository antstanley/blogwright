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
 *
 * The same collect-never-throw rule governs the two namespace-collision
 * checks this module applies itself, after a candidate has already loaded
 * and validated cleanly: a plugin whose declared name is one the CLI
 * dispatches itself (`RESERVED_COMMANDS`, `known-commands.ts` - a leaf
 * module with no imports of its own, so this domain module never has to
 * import the composition root just to read it), and two plugins that
 * declare the same name as each other. §CLI → Namespace collisions calls
 * this "rejected with an error", but - exactly like a malformed manifest or
 * a failed `validatePlugin` check above - that rejection is a reported
 * `failures` entry, not a thrown one. Throwing here would let a single
 * colliding plugin abort discovery for every other, unrelated plugin and
 * every built-in command that runs it; `blogwright plugin list` (task 17)
 * depends on the collect outcome too, since it is the one place a collision
 * becomes visible to a human.
 *
 * `pds` is deliberately absent from `RESERVED_COMMANDS`. The hardcoded
 * `command === 'pds'` branch in `cli.ts` (ahead of its `KNOWN_COMMANDS`
 * membership test) already shadows any plugin that declares the name `pds`
 * - but that shadow belongs to task 29, which deletes the branch once the
 * bundled `blogwright-pds` package is dispatched as an ordinary plugin.
 * Reserving `pds` here now would fix a problem this module does not have
 * (nothing here lets `pds` through unchecked; `cli.ts` intercepts it first)
 * while creating one task 29 would then have to undo - so the name stays
 * unreserved on purpose, pinned by a test below.
 *
 * DECISION (task 13, record here for task 16 to find): a plugin's declared
 * ACTIONS can collide with a generic action the CLI contributes, distinct
 * from the namespace collisions above. §CLI → `blogwright <plugin> init`
 * names exactly one such collision a boundary check can reject: a plugin
 * declaring BOTH an `init` command in its own `commands` AND an `init?(io)`
 * contributor is unsatisfiable, because a declared command always wins
 * dispatch (`plugin-commands.ts`'s `matchAction` matches a plugin's own
 * `commands` before the generic action is ever considered), so the
 * contributor would ask its questions nowhere. That check - `rejectDeclaredInitCollisions`
 * below - lives HERE, in this module's collision pass, rather than in core's
 * `validatePlugin` (`blogwright-core`'s `plugin.ts`), for the same reason the
 * namespace checks do: it is about actions the *CLI* contributes generically
 * (the config-writing `init`), which core must not know exists, and this
 * module already reports a plugin-level rejection as a `failures` entry
 * rather than a thrown error. §CLI → Plugin lifecycle adds the sibling rule
 * for `bootstrap`/`destroy` (always generic; a plugin may never declare
 * either, full stop - no "unless paired with a contributor" nuance, since
 * there is no bootstrap/destroy contributor to pair with). Task 16 extends
 * `rejectDeclaredInitCollisions` (or adds a sibling function called from the
 * same place in `discover`, below) with that rule, so every declared-action
 * collision rejection greps to this one module instead of splitting across
 * whichever of the two tasks happened to land first.
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

import { RESERVED_COMMANDS } from './known-commands.js';
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
 *
 * A package name present in BOTH manifests - e.g. a plugin `blogwright
 * plugin add` (task 18) pinned directly into the consuming repo, which
 * already sits in the CLI's own bundled dependencies too - is one installed
 * package, not two: it is deduped here, consumer half winning, so it is
 * probed exactly once. Without this, the same package would reach
 * `resolveNamespaceCollisions` as two `LoadedPlugin` entries sharing one
 * `packageName` and reject itself as a "duplicate" of itself.
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

  const consumerNames = pluginDependencyNames(consumerPkg);
  const consumerCandidates = consumerNames.map(
    (packageName): Candidate => ({ packageName, fromDir: repoRoot }),
  );

  // The bundled half is NOT filtered against the consumer's names here. A name
  // in both manifests must still be probed from both directories, because a
  // consumer can DECLARE a plugin it cannot resolve - a pruned devDependency,
  // `pnpm install --prod`, a hand-edited manifest before install - while the
  // CLI's bundled copy is installed and working. Filtering here would suppress
  // that copy and report nothing at all, which is the silent outcome the
  // two-source union exists to prevent. `discover` instead skips the bundled
  // probe only once the consumer's has actually resolved, so the consumer still
  // wins wherever both work.
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

/** A successfully loaded, `validatePlugin`-passing plugin, paired with the package it came from. */
interface LoadedPlugin {
  readonly packageName: string;
  readonly plugin: Plugin;
}

/**
 * Split every loaded plugin into survivors and namespace-collision failures.
 * A name is checked for a reserved collision before a duplicate one: two
 * plugins both claiming a reserved name are each reported once, against the
 * reservation, not twice against each other. Neither check depends on the
 * order `loaded` arrives in - a duplicate group has no "first" survivor (all
 * of it fails, see the module comment), and every failure naming more than
 * one package lists them from a `.sort()`ed array, so the rendered message
 * text is identical no matter which candidate was resolved first.
 */
function resolveNamespaceCollisions(loaded: readonly LoadedPlugin[]): {
  plugins: Plugin[];
  failures: PluginLoadFailure[];
} {
  const byName = new Map<string, LoadedPlugin[]>();
  for (const entry of loaded) {
    const bucket = byName.get(entry.plugin.name);
    if (bucket) bucket.push(entry);
    else byName.set(entry.plugin.name, [entry]);
  }

  const plugins: Plugin[] = [];
  const failures: PluginLoadFailure[] = [];
  for (const [name, entries] of byName) {
    if (RESERVED_COMMANDS.has(name)) {
      for (const entry of entries) {
        failures.push({
          packageName: entry.packageName,
          reason:
            `${entry.packageName} declares plugin name "${name}", which is reserved for the ` +
            `built-in "${name}" command - built-in commands always win`,
        });
      }
      continue;
    }
    if (entries.length > 1) {
      const packageNames = entries.map((entry) => entry.packageName).sort();
      for (const packageName of packageNames) {
        failures.push({
          packageName,
          reason: `plugin name "${name}" is claimed by more than one installed package: ${packageNames.join(', ')}`,
        });
      }
      continue;
    }
    const [entry] = entries;
    if (entry) plugins.push(entry.plugin);
  }

  return { plugins, failures };
}

/** The generic action name `init?(io)` contributors would otherwise collide with - see {@link rejectDeclaredInitCollisions}. */
const GENERIC_INIT_ACTION = 'init';

/**
 * Reject a plugin declaring BOTH an `init` command in its own `commands` and
 * an `init?(io)` contributor - the one half of §CLI → `blogwright <plugin>
 * init`'s precedence rule a boundary check can decide (see the module
 * comment's DECISION note on why this check lives here, in the collision
 * pass, rather than core's `validatePlugin`). Declaring either alone is
 * valid and passes through untouched: pds declares the `init` command and no
 * contributor, analytics the contributor and no command.
 */
function rejectDeclaredInitCollisions(loaded: readonly LoadedPlugin[]): {
  survivors: LoadedPlugin[];
  failures: PluginLoadFailure[];
} {
  const survivors: LoadedPlugin[] = [];
  const failures: PluginLoadFailure[] = [];
  for (const entry of loaded) {
    const declaresInitCommand = entry.plugin.commands.some(
      (command) => command.action === GENERIC_INIT_ACTION,
    );
    const declaresInitContributor = typeof entry.plugin.init === 'function';
    if (declaresInitCommand && declaresInitContributor) {
      failures.push({
        packageName: entry.packageName,
        reason:
          `${entry.packageName} declares both an "init" command and an init(io) contributor - ` +
          'a declared command always wins dispatch, so the contributor would never run; declare only one',
      });
      continue;
    }
    survivors.push(entry);
  }
  return { survivors, failures };
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

  const loaded: LoadedPlugin[] = [];
  const failures: PluginLoadFailure[] = [];
  // A package named in both manifests appears twice, consumer entry first.
  // Skip the second only when the first RESOLVED - to a plugin or to a failure -
  // so a declared-but-unresolvable consumer entry still falls through to the
  // CLI's bundled copy instead of silently suppressing it.
  const resolved = new Set<string>();
  for (const candidate of candidates) {
    if (resolved.has(candidate.packageName)) continue;
    const outcome = await loadCandidate(candidate, ports);
    if (outcome.kind === 'plugin') {
      resolved.add(candidate.packageName);
      loaded.push({ packageName: candidate.packageName, plugin: outcome.plugin });
    } else if (outcome.kind === 'failure') {
      resolved.add(candidate.packageName);
      failures.push(outcome.failure);
    }
  }

  const actionCollisions = rejectDeclaredInitCollisions(loaded);
  const collisions = resolveNamespaceCollisions(actionCollisions.survivors);
  failures.push(...actionCollisions.failures, ...collisions.failures);

  return { plugins: collisions.plugins, failures };
}
