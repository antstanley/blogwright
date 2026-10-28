/**
 * The agent's half of the artifact manifest: hash every file a static build
 * published and record the result where the CLI asked for it. The format and
 * the aggregate release hash are owned by `blogwright-core`.
 */

import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  createArtifactManifest,
  serializeArtifactManifest,
  sha256Hex,
  type ArtifactFile,
  type ArtifactManifest,
  type S3Client,
} from 'blogwright-core';

import type { LogFn } from './build.js';

/**
 * A built file's path under the output directory, `/`-separated: the S3 key
 * minus the site prefix. A backslash becomes `/` too, so a name like `a\b.html`
 * publishes as `a/b.html` - the manifest and the upload must agree on that.
 */
export function sitePathOf(rootDir: string, file: string): string {
  return relative(rootDir, file).split('\\').join('/');
}

/** Size and SHA-256 of each file, keyed by its site path (see {@link sitePathOf}). */
export async function describeFiles(rootDir: string, files: string[]): Promise<ArtifactFile[]> {
  const described: ArtifactFile[] = [];
  for (const file of files) {
    const content = await readFile(file);
    described.push({
      path: sitePathOf(rootDir, file),
      bytes: content.byteLength,
      sha256: sha256Hex(content),
    });
  }
  return described;
}

/**
 * The `version` the app's own `package.json` declares, if any - part of the
 * release identity. Only `package.json` is read: an app whose pnpm manifest is
 * `package.yaml` or `package.json5`, a missing or unparseable `package.json`, or
 * one without a string version all mean "no version", never a failed build. A
 * leading byte-order mark is ignored, as npm and pnpm ignore it.
 */
export async function readSiteVersion(appDir: string): Promise<string | undefined> {
  let parsed: unknown;
  try {
    const text = await readFile(join(appDir, 'package.json'), 'utf8');
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    // No readable package.json is a site without a version, not a broken build.
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const version = (parsed as { version?: unknown }).version;
  return typeof version === 'string' && version !== '' ? version : undefined;
}

/** Build the manifest for a published output directory. */
export async function buildArtifactManifest(opts: {
  hash: string;
  appDir: string;
  rootDir: string;
  files: string[];
}): Promise<ArtifactManifest> {
  return createArtifactManifest({
    hash: opts.hash,
    siteVersion: await readSiteVersion(opts.appDir),
    files: await describeFiles(opts.rootDir, opts.files),
  });
}

/**
 * Build the manifest of a published output directory and write it to
 * `target.key`. Nothing here fails the build - the site is already published -
 * so any failure, building the manifest or writing it, is logged as a warning.
 * The CLI finds no manifest at the key and says so too.
 */
export async function recordArtifactManifest(
  s3: S3Client,
  log: LogFn,
  target: { bucket: string; key: string },
  build: { hash: string; appDir: string; rootDir: string; files: string[] },
): Promise<void> {
  let manifest: ArtifactManifest;
  try {
    manifest = await buildArtifactManifest(build);
  } catch (err) {
    log(
      `warning: could not build the artifact manifest (${(err as Error).message}) - ` +
        'the site is published, but this build records no release',
    );
    return;
  }
  await writeArtifactManifest(s3, log, target, manifest);
}

/**
 * Write the manifest. A failed write does not fail the build - the site is
 * already published - but it is logged with the fix: a stack bootstrapped
 * before artifact manifests existed has no `build/artifacts/*` grant.
 */
export async function writeArtifactManifest(
  s3: S3Client,
  log: LogFn,
  target: { bucket: string; key: string },
  manifest: ArtifactManifest,
): Promise<void> {
  try {
    await s3.putObject(
      target.bucket,
      target.key,
      serializeArtifactManifest(manifest),
      'application/json',
    );
    log(
      `wrote ${target.key}: release ${manifest.release} ` +
        `(${manifest.fileCount} files, sha256 ${manifest.releaseHash})`,
    );
  } catch (err) {
    log(
      `warning: could not write artifact manifest ${target.key} (${(err as Error).message}) - ` +
        'run `blogwright bootstrap <env>` to grant the builder write access to build/artifacts/',
    );
  }
}
