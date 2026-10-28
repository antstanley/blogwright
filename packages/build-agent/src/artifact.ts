/**
 * The agent's half of the artifact manifest: hash every file a static build
 * published and record the result where the CLI asked for it. The format and
 * the aggregate release hash are owned by `blogwright-core`.
 */

import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import {
  createArtifactManifest,
  serializeArtifactManifest,
  sha256Hex,
  type ArtifactFile,
  type ArtifactManifest,
  type S3Client,
} from 'blogwright-core';

import type { LogFn } from './build.js';

/** Size and SHA-256 of each file, keyed by its `/`-separated path under `rootDir`. */
export async function describeFiles(rootDir: string, files: string[]): Promise<ArtifactFile[]> {
  const described: ArtifactFile[] = [];
  for (const file of files) {
    const content = await readFile(file);
    described.push({
      path: relative(rootDir, file).split(sep).join('/'),
      bytes: content.byteLength,
      sha256: sha256Hex(content),
    });
  }
  return described;
}

/** The `version` the app's own `package.json` declares, if any - part of the release identity. */
export async function readSiteVersion(appDir: string): Promise<string | undefined> {
  const text = await readFile(join(appDir, 'package.json'), 'utf8');
  const parsed: unknown = JSON.parse(text);
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
 * Write the manifest. A failed write does not fail the build - the site is
 * already published - but it is logged with the fix: a stack bootstrapped
 * before artifact manifests existed has no `build/artifacts/*` grant. The CLI
 * notices the missing manifest and says so too.
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
