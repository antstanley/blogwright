/**
 * The transform Lambda's build identity: a reproducible hash of the *source*
 * the function is bundled from, the artifact names that hash is stamped
 * beside, and the one derivation of the zip key that hash produces.
 *
 * This is step 5 of
 * [§Implementation notes](../../../.specs/changes/merged/2026-07-26-analytics_plugin.md) -
 * "The hash keys the uploaded zip so identical source never redeploys the
 * function" - and it exists as its own module so `nodes.ts` (task 50) consumes
 * a derivation rather than restating a key format. A key spelled twice is a key
 * that can disagree with itself, and the disagreement is invisible: the
 * function silently redeploys on every reconcile, or worse, never redeploys
 * after a real source change.
 *
 * ## Why the *source*, never the bundle
 *
 * `DEVELOPMENT.md` §Repository hygiene states the rule this module obeys: "The
 * build-agent manifest hashes the agent's *source*, not the built bundle, so
 * image keys do not vary by platform." Bundler output varies with the
 * toolchain and the host (macOS laptop vs the Linux CI runner); source bytes do
 * not. Hashing the bundle would key the same code under two different zip keys
 * depending on who ran `pnpm build`, redeploying the function on every
 * platform switch for no change at all. So the bundle path appears nowhere in
 * the input list below - which is also why `packages/analytics/src/aws/lambda.ts`
 * (task 36) deliberately does not surface `CodeSha256`: that digests the zip
 * Lambda holds, and comparing it to this hash would compare two different
 * things.
 *
 * ## What is in the hash, and why each input is there
 *
 * The shape follows `agentSourceHash` (`packages/build-agent/src/agent-hash.ts`)
 * exactly: collect, label, sort by label with a codepoint comparison, and
 * digest each input as `label` NUL `bytes` NUL. The framing matters - without
 * the labels a file rename would leave the hash unchanged, and without the NUL
 * separators two adjacent inputs could be split differently and collide.
 *
 * The inputs are a deliberate superset of what rolldown actually tree-shakes
 * into the bundle: an unrelated change to this package or to core can force a
 * (harmless) redeploy, which is the right trade against ever shipping a stale
 * transform. `core/src` is in because the bundle genuinely inlines it - the
 * entry constructs core's `SigningClient` and `SecretsManagerClient` - and the
 * lockfile, `tsconfig.json` and the rolldown config are in because each of them
 * changes the emitted bundle without changing a single line of this package's
 * own source. The rolldown config lives at `src/transform/rolldown.config.ts`,
 * so the `analytics/src` collection below already carries it; it is not listed
 * a second time, because hashing the same bytes under two labels adds nothing.
 * `transform-hash.test.ts` proves each of those inputs is live by changing one
 * byte of it and asserting the hash moves.
 *
 * Test files are excluded (the `.test.ts` filter, as in `agentSourceHash`):
 * they are never bundled, so a test-only edit must not redeploy the function.
 *
 * ## No direct filesystem call here
 *
 * Reading crosses the {@link FileSystem} port rather than Node's `fs` module,
 * so this stays a domain module under DEVELOPMENT.md §Hexagonal architecture
 * and no `packages/analytics/src/` path has to join the `no-restricted-imports`
 * override list in `.oxlintrc.json`. The real adapter is constructed in
 * `transform/write-manifest.ts`, the build-time edge that runs this.
 */

import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';

import type { FileSystem } from 'blogwright-core';

/**
 * Hex characters kept from the SHA-256 digest. Twelve, as `agentSourceHash`
 * slices to: enough that a collision between two revisions of one small source
 * tree is not a practical concern, short enough to read in a resource name.
 */
const HASH_LENGTH = 12;

/** A well-formed {@link transformSourceHash} result. */
const HASH_PATTERN = new RegExp(`^[0-9a-f]{${HASH_LENGTH}}$`);

/**
 * Where the build puts the Lambda artifacts, relative to the package root.
 * Its own directory, not `dist/transform/` (which `tsc` fills with the
 * unbundled modules), so the bundle can never be overwritten by the compiler.
 *
 * It holds two files, and they are not both deployment artifacts:
 * {@link TRANSFORM_BUNDLE_FILE} is the zip's single entry, and
 * {@link TRANSFORM_MANIFEST_FILE} is read *beside* the zip at deploy time for
 * the hash and the key it derives. Task 50 zips the bundle file alone - see
 * {@link TRANSFORM_BUNDLE_FILE} for why a one-file zip is the shape the
 * `Handler` string assumes - and never the directory wholesale.
 */
export const TRANSFORM_BUNDLE_DIR = 'dist/transform-bundle';

/**
 * The bundle's file name inside {@link TRANSFORM_BUNDLE_DIR} - and, unchanged,
 * inside the zip task 50 uploads.
 *
 * `.mjs`, not `.js`: the bundle is ESM, and the Lambda Node runtime reads a
 * `.js` file in the deployment package as CommonJS unless the zip also carries
 * a `package.json` declaring `"type": "module"`. A one-file zip with a `.mjs`
 * extension needs no such companion, so there is no second file to forget - and
 * this file, alone, is what that zip contains.
 *
 * That the emitted bundle really is ESM exporting this module's binding is
 * asserted by `transform/write-manifest.ts` on every build, because no test
 * sees the emitted file.
 */
export const TRANSFORM_BUNDLE_FILE = 'index.mjs';

/**
 * The build-time manifest carrying the hash and the key it derives, written
 * beside the bundle in {@link TRANSFORM_BUNDLE_DIR} and read beside the zip -
 * never packed inside it.
 */
export const TRANSFORM_MANIFEST_FILE = 'transform-manifest.json';

/**
 * The `Handler` string the function is configured with (task 50), spelled here
 * because it is derived from this module's artifact names and nothing else:
 * the bundle's base name, then the binding `transform/entry.ts` exports.
 *
 * It is here rather than in `nodes.ts` because getting it wrong fails at
 * *invoke* time with an AWS-side error and no build error - every record would
 * land in the Firehose error prefix with nothing in this repo reporting it, and
 * the only symptom is an empty dashboard. Two checks pin this constant against
 * a real export rather than a comment: `transform/entry.test.ts` against the
 * entry *module*'s, and `transform/write-manifest.ts` against the emitted
 * *bundle*'s, on every build. A rename or a bundler-config change reddens one
 * of them instead of silently emptying the warehouse.
 */
export const TRANSFORM_LAMBDA_HANDLER = 'index.handler';

/** One hashed input: the label that names it, and where to read its bytes. */
interface HashInput {
  readonly label: string;
  readonly path: string;
}

/**
 * Every non-test file under `root`, labelled by its path under `prefix`.
 *
 * `listFiles` is contracted to return sorted, `root`-relative paths, so the
 * collection order does not depend on the host filesystem's readdir order;
 * separators are normalised to `/` so a label is the same on every platform.
 */
async function collectSource(fs: FileSystem, root: string, prefix: string): Promise<HashInput[]> {
  const files = await fs.listFiles(root);
  return files
    .filter((relativePath) => !relativePath.endsWith('.test.ts'))
    .map((relativePath) => ({
      label: `${prefix}/${relativePath.split(sep).join('/')}`,
      path: join(root, relativePath),
    }));
}

/**
 * A hash of the transform's *source*, computed at bundle time and stamped into
 * `dist/transform-bundle/transform-manifest.json` (see
 * `transform/write-manifest.ts`) so the plugin reads it at runtime without any
 * access to the source tree.
 *
 * `dir` is the analytics package root; core and the workspace root are located
 * from it the way `agentSourceHash` locates its own siblings. Only labels,
 * never absolute paths, reach the digest, so the same tree checked out at two
 * different paths hashes identically - a property `transform-hash.test.ts`
 * asserts, because a hash that moves with the checkout directory would key the
 * same code under a different zip on every machine.
 */
export async function transformSourceHash(dir: string, fs: FileSystem): Promise<string> {
  const coreDir = join(dir, '..', 'core');
  const rootDir = join(dir, '..', '..');
  const inputs: HashInput[] = [
    ...(await collectSource(fs, join(dir, 'src'), 'analytics/src')),
    ...(await collectSource(fs, join(coreDir, 'src'), 'core/src')),
    { label: 'analytics/package.json', path: join(dir, 'package.json') },
    { label: 'analytics/tsconfig.json', path: join(dir, 'tsconfig.json') },
    { label: 'core/package.json', path: join(coreDir, 'package.json') },
    { label: 'workspace/tsconfig.base.json', path: join(rootDir, 'tsconfig.base.json') },
    { label: 'workspace/pnpm-lock.yaml', path: join(rootDir, 'pnpm-lock.yaml') },
    // Codepoint sort, not localeCompare: collation must not depend on host locale/ICU.
  ].sort((a, b) => (a.label < b.label ? -1 : 1));

  const digest = createHash('sha256');
  for (const { label, path } of inputs) {
    digest.update(label);
    digest.update('\0');
    digest.update(await fs.readBytes(path));
    digest.update('\0');
  }
  return digest.digest('hex').slice(0, HASH_LENGTH);
}

/**
 * The key the bundled transform's zip is stored and compared under, derived
 * from {@link transformSourceHash} and spelled in this one place. Task 50's
 * `analytics-transform-function` records it and skips the code update when it
 * has not moved, so identical source provably maps to an identical key.
 *
 * A malformed hash raises rather than producing a key: `transform-undefined.zip`
 * is a key that compares equal to itself forever, which would pin the deployed
 * function at whatever code first shipped and never update it again.
 */
export function transformZipKey(hash: string): string {
  if (!HASH_PATTERN.test(hash)) {
    throw new Error(
      `the analytics transform's source hash must be ${HASH_LENGTH} lowercase hex characters, not "${hash}" - rebuild the package so ${TRANSFORM_MANIFEST_FILE} is regenerated`,
    );
  }
  return `analytics/transform/transform-${hash}.zip`;
}
