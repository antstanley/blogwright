/**
 * The one thing this file exists to catch: an *entry module* that does not
 * export what the function's configured `Handler` string names. That failure is
 * invisible to every other gate - it builds, it deploys, and it fails at invoke
 * time with an AWS-side error, sending every record to the Firehose error
 * prefix with nothing in this repo reporting it. So the export shape is
 * asserted against `TRANSFORM_LAMBDA_HANDLER`, the constant task 50 configures
 * the function with, rather than against a literal restated here.
 *
 * Scope, precisely: under vitest `import('./entry.js')` resolves to `entry.ts`,
 * so what follows pins the **source**. It says nothing about the file rolldown
 * emits, and so nothing about `rolldown.config.ts`'s `format`, `input` or
 * `codeSplitting` - a bundle can export nothing at all with every assertion
 * here still green. The emitted `.mjs` is checked against the same constant by
 * `write-manifest.ts`, which runs between the bundle and the manifest stamp and
 * fails the build; the two together cover the source and the artifact.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { SALT_SECRET_NAME_ENV } from './handler.js';
import { TRANSFORM_BUNDLE_FILE, TRANSFORM_LAMBDA_HANDLER } from '../transform-hash.js';

/** Lambda reads `Handler` as `<module base name>.<exported binding>`. */
const [handlerModule, handlerBinding] = TRANSFORM_LAMBDA_HANDLER.split('.');

const previousSecretName = process.env[SALT_SECRET_NAME_ENV];

afterAll(() => {
  if (previousSecretName === undefined) delete process.env[SALT_SECRET_NAME_ENV];
  else process.env[SALT_SECRET_NAME_ENV] = previousSecretName;
});

describe('the transform bundle entry', () => {
  it('names the module the bundle is emitted as', () => {
    expect(TRANSFORM_BUNDLE_FILE).toBe(`${handlerModule}.mjs`);
  });

  it('exports the binding the configured Handler names, bound and callable', async () => {
    // The entry builds its handler at module load, and the factory resolves the
    // secret's name then, so the variable has to be set before the import.
    process.env[SALT_SECRET_NAME_ENV] = 'example-site/prod/analytics-salt';

    const entry: Record<string, unknown> = await import('./entry.js');

    expect(Object.keys(entry)).toStrictEqual([handlerBinding]);
    const bound = entry[handlerBinding as string];
    expect(typeof bound).toBe('function');
    // The bound handler is the async function Lambda awaits; the factory that
    // builds it is an ordinary synchronous function. That is the difference
    // between an entry that works and one that fails only at invoke time, and
    // it is checked without calling anything - invoking would read the secret,
    // which means a network call from a unit test.
    expect((bound as object).constructor.name).toBe('AsyncFunction');
  });
});
