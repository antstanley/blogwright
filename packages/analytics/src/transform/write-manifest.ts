/**
 * Build step: check the emitted bundle, then stamp
 * `dist/transform-bundle/transform-manifest.json` with the reproducible source
 * hash and the zip key derived from it.
 *
 * Runs after the rolldown bundle with the analytics package root as its cwd
 * (see the package's `build` script), so the shipped artifact set - the bundle
 * and this manifest - is self-describing and the plugin's function node reads
 * the hash at deploy time without any access to the source trees. It is the
 * `packages/build-agent/src/write-manifest.ts` precedent, moved onto the
 * FileSystem port.
 *
 * This is the build-time edge component of the pair: it constructs the real
 * disk adapter - core's `createNodeFileSystem` - which is why
 * `transform-hash.ts` never has to. That keeps every `packages/analytics/src/`
 * module free of a direct filesystem import and out of the `.oxlintrc.json`
 * `no-restricted-imports` override list.
 *
 * ## Why the emitted bundle is checked here
 *
 * `entry.test.ts` pins the *source* module's exports against
 * {@link TRANSFORM_LAMBDA_HANDLER}, and that is all it can do: under vitest
 * `import('./entry.js')` resolves to `entry.ts`, never to the file rolldown
 * emits. So everything between the source and the artifact - the output
 * `format`, `codeSplitting`, the `input` rolldown is pointed at - is asserted
 * by no test at all. Changing `format: 'esm'` to `'cjs'` in
 * `rolldown.config.ts` is a one-token edit that leaves build, typecheck, test,
 * lint, oxfmt and knip green while emitting a bundle Lambda cannot resolve
 * `index.handler` from at all: every record would go to the Firehose error
 * prefix, and the only symptom would be an empty dashboard - the same failure
 * `entry.ts` and `transform-hash.ts` are written against, reached by a
 * different route.
 *
 * The check therefore loads the emitted `.mjs` the way Lambda's runtime will
 * and asserts the configured `Handler` resolves. It lives in this build step
 * rather than in a `dist`-gated case in `entry.test.ts` for two reasons:
 *
 * - **It cannot be skipped.** This runs on every `pnpm build`; a test that
 *   needs `dist/` to exist runs only when someone happens to have built, which
 *   is a weaker guarantee than a build step in the chain.
 * - **It runs before the stamp.** A bundle that fails the check never acquires
 *   a hash or a zip key, so task 50 has nothing to deploy rather than a fresh
 *   key over a function that cannot start.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createNodeFileSystem } from 'blogwright-core';

import { SALT_SECRET_NAME_ENV } from './handler.js';
import {
  TRANSFORM_BUNDLE_DIR,
  TRANSFORM_BUNDLE_FILE,
  TRANSFORM_LAMBDA_HANDLER,
  TRANSFORM_MANIFEST_FILE,
  transformSourceHash,
  transformZipKey,
} from '../transform-hash.js';

/** Lambda reads `Handler` as `<module base name>.<exported binding>`. */
const [, handlerBinding] = TRANSFORM_LAMBDA_HANDLER.split('.');

/**
 * A stand-in secret *name*, never a secret. `entry.ts` binds its handler at
 * module load and the factory resolves the secret's name then, so importing
 * the bundle at all requires {@link SALT_SECRET_NAME_ENV} to be set - that
 * reject-at-init is deliberate, and `entry.test.ts` sets a placeholder for the
 * same reason. Nothing is invoked and no secret is read: the check ends at the
 * shape of the export.
 */
const EXPORT_CHECK_SECRET_NAME = 'build-time-export-check/not-a-real-secret';

/**
 * Assert the bundle rolldown just emitted exports the binding the function's
 * configured `Handler` names, as the async function Lambda awaits. Throws -
 * failing `pnpm build` - if it does not.
 */
async function assertBundleExportsHandler(): Promise<void> {
  if (!process.env[SALT_SECRET_NAME_ENV]?.trim()) {
    process.env[SALT_SECRET_NAME_ENV] = EXPORT_CHECK_SECRET_NAME;
  }
  // A computed specifier, so rolldown leaves it as a real runtime import of the
  // file on disk instead of resolving and inlining a copy of the entry - which
  // would check the source again and defeat the whole point of this step.
  const bundlePath = resolve(TRANSFORM_BUNDLE_DIR, TRANSFORM_BUNDLE_FILE);
  let bundle: Record<string, unknown>;
  try {
    bundle = (await import(pathToFileURL(bundlePath).href)) as Record<string, unknown>;
  } catch (cause) {
    // Whatever this is, Lambda would hit it at initialisation, once per
    // execution environment, and report it only on the AWS side. A `format`
    // that is not ESM lands here: Node reads a `.mjs` as a module, and
    // CommonJS output references `exports`, which module scope does not have.
    throw new Error(
      `${TRANSFORM_BUNDLE_DIR}/${TRANSFORM_BUNDLE_FILE} could not be loaded as an ES module, so Lambda would fail to initialise it and every record would land in the Firehose error prefix - the cause below says why, and a rolldown output \`format\` other than 'esm' is the usual one`,
      { cause },
    );
  }

  const bound = bundle[handlerBinding as string];
  if (typeof bound !== 'function') {
    throw new Error(
      `${TRANSFORM_BUNDLE_DIR}/${TRANSFORM_BUNDLE_FILE} exports [${Object.keys(bundle).join(', ')}], so the configured Handler "${TRANSFORM_LAMBDA_HANDLER}" resolves to nothing at invoke time and every record would land in the Firehose error prefix - check the rolldown \`input\` and the binding \`transform/entry.ts\` exports`,
    );
  }
  if (bound.constructor.name !== 'AsyncFunction') {
    throw new Error(
      `${TRANSFORM_BUNDLE_DIR}/${TRANSFORM_BUNDLE_FILE} exports "${handlerBinding}" as an ordinary ${bound.constructor.name}, not the async function Lambda awaits - \`transform/entry.ts\` must export the handler \`createTransformHandler\` returns, not the factory itself`,
    );
  }
}

await assertBundleExportsHandler();

const fs = createNodeFileSystem();
const hash = await transformSourceHash(process.cwd(), fs);
// `key` is recorded for the operator and for the `Reviewable:` check; it is
// derived, never authoritative - `transformZipKey` is the single derivation and
// task 50 may call it directly from the hash.
const manifest = { hash, key: transformZipKey(hash) };

await fs.writeText(
  `${TRANSFORM_BUNDLE_DIR}/${TRANSFORM_MANIFEST_FILE}`,
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`${TRANSFORM_MANIFEST_FILE}: ${hash}`);
