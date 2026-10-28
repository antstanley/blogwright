/**
 * The artifact manifest: the canonical, versioned record of exactly what one
 * static build published - every path, its byte count and its lowercase
 * SHA-256 - plus one aggregate release hash and a release identity string.
 *
 * It is what lets an operator assert "what is live is what was reviewed": CI
 * can archive it, and `blogwright verify` compares it against the objects
 * actually stored in S3.
 *
 * The aggregate release hash is defined so it can be recomputed outside
 * blogwright from a build directory: it is the SHA-256 of the `sha256sum`
 * listing of every file, sorted by path in byte order -
 *
 *   find -L . -type f | sed 's|^\./||' | LC_ALL=C sort | xargs -d '\n' sha256sum | sha256sum
 *
 * - that is, one `<sha256>  <path>\n` line per file (two spaces).
 *
 * Every build of a revision records its own manifest at a key unique to that
 * build ({@link artifactBuildManifestKey}); the first one a deploy records is
 * also kept, write-once, as the revision's original ({@link artifactManifestKey}).
 * A later build of the same revision can therefore never replace the record a
 * review covered.
 */

import { createHash } from 'node:crypto';

/** The format version this module writes and the only one it reads. */
export const ARTIFACT_MANIFEST_VERSION = 1;

/** How many hex characters of the release hash the release identity carries. */
export const RELEASE_HASH_PREFIX_LENGTH = 12;

/** One published file: a site-root-relative path, its size and content hash. */
export interface ArtifactFile {
  /** `/`-separated, relative to the site root (`index.html`, `posts/a/index.html`). */
  path: string;
  /** Size in bytes. */
  bytes: number;
  /** Lowercase hex SHA-256 of the file's bytes. */
  sha256: string;
}

/** The record one build writes to `build/artifacts/<hash>.json`. */
export interface ArtifactManifest {
  /** Format version; see {@link ARTIFACT_MANIFEST_VERSION}. */
  manifestVersion: typeof ARTIFACT_MANIFEST_VERSION;
  /** The revision hash the artifact was built from. */
  hash: string;
  /** `<siteVersion>+<hash>.<releaseHashPrefix>`, or `<hash>.<releaseHashPrefix>` without a site version. */
  release: string;
  /** Aggregate SHA-256 over the file list; see the module comment. */
  releaseHash: string;
  /** The `version` of the built app's `package.json`, when it declares one. */
  siteVersion?: string | undefined;
  fileCount: number;
  totalBytes: number;
  /** Every published file, sorted by path in byte order. */
  files: ArtifactFile[];
}

/** What one object under a prefix holds; the hash is absent when it was not read. */
export interface ObservedFile {
  bytes: number;
  sha256?: string | undefined;
}

/** A file whose observed size or content differs from the manifest. */
export interface ChangedFile {
  path: string;
  expected: { bytes: number; sha256: string };
  actual: ObservedFile;
}

/** The outcome of comparing a manifest with the objects actually stored. */
export interface ArtifactComparison {
  /** Files present with the recorded size and hash. */
  matched: number;
  /** Manifest paths with no object. */
  missing: string[];
  /** Manifest paths whose object differs. */
  changed: ChangedFile[];
  /** Objects the manifest does not list - live, they would be served too. */
  unexpected: string[];
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The original artifact manifest of a revision: the first one a deploy
 * recorded for it. It is written once and never replaced by a later build.
 */
export function artifactManifestKey(hash: string): string {
  return `build/artifacts/${hash}.json`;
}

/** Where every build of a revision records its own manifest, one object per build. */
export function artifactBuildManifestPrefix(hash: string): string {
  return `build/artifacts/${hash}/`;
}

/**
 * One build's own manifest. `buildId` is unique per build, so the object's
 * presence proves that build wrote it - a build that recorded nothing can
 * never be mistaken for one that reproduced an earlier record.
 */
export function artifactBuildManifestKey(hash: string, buildId: string): string {
  return `${artifactBuildManifestPrefix(hash)}${buildId}.json`;
}

/** Lowercase hex SHA-256 of some bytes. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const utf8 = new TextEncoder();

/**
 * Byte-order comparison of the paths' UTF-8 encodings - what `LC_ALL=C sort`
 * does. JavaScript's `<` compares UTF-16 code units, which disagrees for
 * characters outside the Basic Multilingual Plane.
 */
function compareUtf8(a: string, b: string): number {
  const left = utf8.encode(a);
  const right = utf8.encode(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function sortedByPath(files: readonly ArtifactFile[]): ArtifactFile[] {
  return [...files].sort((a, b) => compareUtf8(a.path, b.path));
}

/** The aggregate release hash of a file list, in any order. */
export function computeReleaseHash(files: readonly ArtifactFile[]): string {
  const listing = sortedByPath(files)
    .map((file) => `${file.sha256}  ${file.path}\n`)
    .join('');
  return sha256Hex(listing);
}

/**
 * The human-facing release identity string: `<siteVersion>+<hash>.<prefix>`.
 * A version that already carries semver build metadata (`1.4.0+exp.1`) has the
 * revision appended to it (`1.4.0+exp.1.<hash>.<prefix>`), since semver allows
 * one `+`.
 */
export function releaseIdentity(
  hash: string,
  releaseHash: string,
  siteVersion?: string | undefined,
): string {
  const build = `${hash}.${releaseHash.slice(0, RELEASE_HASH_PREFIX_LENGTH)}`;
  if (!siteVersion) return build;
  return siteVersion.includes('+') ? `${siteVersion}.${build}` : `${siteVersion}+${build}`;
}

function assertValidFile(file: ArtifactFile, source: string): void {
  if (typeof file.path !== 'string' || file.path === '') {
    throw new Error(`${source}: a file entry has an empty path`);
  }
  if (file.path.startsWith('/') || file.path.split('/').some((part) => part === '..')) {
    throw new Error(`${source}: file path "${file.path}" must be relative to the site root`);
  }
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
    throw new Error(`${source}: file "${file.path}" has an invalid byte count ${file.bytes}`);
  }
  if (typeof file.sha256 !== 'string' || !SHA256_HEX.test(file.sha256)) {
    throw new Error(`${source}: file "${file.path}" sha256 must be 64 lowercase hex characters`);
  }
}

function assertUniquePaths(files: readonly ArtifactFile[], source: string): void {
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) throw new Error(`${source}: file "${file.path}" is listed twice`);
    seen.add(file.path);
  }
}

/** Build a manifest from a build's files; the files may arrive in any order. */
export function createArtifactManifest(input: {
  hash: string;
  siteVersion?: string | undefined;
  files: readonly ArtifactFile[];
}): ArtifactManifest {
  const source = `artifact manifest for ${input.hash}`;
  for (const file of input.files) assertValidFile(file, source);
  assertUniquePaths(input.files, source);
  const files = sortedByPath(input.files).map(({ path, bytes, sha256 }) => ({
    path,
    bytes,
    sha256,
  }));
  const releaseHash = computeReleaseHash(files);
  return {
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    hash: input.hash,
    release: releaseIdentity(input.hash, releaseHash, input.siteVersion),
    releaseHash,
    ...(input.siteVersion ? { siteVersion: input.siteVersion } : {}),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
  };
}

/** The bytes written to S3 for a manifest. */
export function serializeArtifactManifest(manifest: ArtifactManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFileEntry(value: unknown, source: string): ArtifactFile {
  if (!isRecord(value)) throw new Error(`${source}: every files[] entry must be an object`);
  const file = { path: value.path, bytes: value.bytes, sha256: value.sha256 } as ArtifactFile;
  assertValidFile(file, source);
  return file;
}

/**
 * Parse and validate a stored manifest. Beyond the shape, the derived fields
 * (release hash, identity, counts) are recomputed from the file list, so a
 * hand-edited or truncated manifest is refused rather than trusted.
 */
export function parseArtifactManifest(text: string, source: string): ArtifactManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${source} is not valid JSON: ${(err as Error).message}`, { cause: err });
  }
  if (!isRecord(raw)) throw new Error(`${source} must be a JSON object`);
  if (raw.manifestVersion !== ARTIFACT_MANIFEST_VERSION) {
    throw new Error(
      `${source} has manifestVersion ${JSON.stringify(raw.manifestVersion)}; this blogwright ` +
        `reads version ${ARTIFACT_MANIFEST_VERSION} - upgrade blogwright to read it`,
    );
  }
  if (typeof raw.hash !== 'string' || raw.hash === '') {
    throw new Error(`${source} has no revision hash`);
  }
  if (!Array.isArray(raw.files)) throw new Error(`${source} has no files[] list`);
  const siteVersion = typeof raw.siteVersion === 'string' ? raw.siteVersion : undefined;
  const expected = createArtifactManifest({
    hash: raw.hash,
    siteVersion,
    files: raw.files.map((entry) => readFileEntry(entry, source)),
  });
  for (const field of ['releaseHash', 'release', 'fileCount', 'totalBytes'] as const) {
    if (raw[field] !== expected[field]) {
      throw new Error(
        `${source} records ${field} ${JSON.stringify(raw[field])} but its file list gives ` +
          `${JSON.stringify(expected[field])}; the manifest is corrupt or was edited`,
      );
    }
  }
  return expected;
}

/**
 * Compare a manifest with the objects stored under a prefix, keyed by
 * site-root-relative path. A path counts as matched only when both its byte
 * count and its SHA-256 equal the manifest's.
 */
export function compareArtifact(
  manifest: ArtifactManifest,
  observed: ReadonlyMap<string, ObservedFile>,
): ArtifactComparison {
  const listed = new Set(manifest.files.map((file) => file.path));
  const comparison: ArtifactComparison = { matched: 0, missing: [], changed: [], unexpected: [] };
  for (const file of manifest.files) {
    const actual = observed.get(file.path);
    if (!actual) comparison.missing.push(file.path);
    else if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) {
      comparison.changed.push({
        path: file.path,
        expected: { bytes: file.bytes, sha256: file.sha256 },
        actual,
      });
    } else comparison.matched += 1;
  }
  comparison.unexpected = [...observed.keys()]
    .filter((path) => !listed.has(path))
    .sort(compareUtf8);
  return comparison;
}

/** True when the stored objects are exactly the manifest's files, byte for byte. */
export function isExactMatch(comparison: ArtifactComparison): boolean {
  return (
    comparison.missing.length === 0 &&
    comparison.changed.length === 0 &&
    comparison.unexpected.length === 0
  );
}
