import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import {
  AwsError,
  createCacheControlLookup,
  parseCacheControlRules,
  REPRODUCIBLE_ZIP_MTIME,
  S3Client,
  SigningClient,
  type AwsCredentials,
  type CacheControlLookup,
  type CacheControlRule,
  type CredentialProvider,
  type EntryShim,
} from 'blogwright-core';
import { unzipSync, zipSync, type Zippable } from 'fflate';

/**
 * The SSR packaging job the CLI puts in the pending document: what to package,
 * what to call the artifact, and where the CLI reads the result. Absent, the
 * agent runs its static publish path unchanged.
 */
interface WebFunctionJob {
  /** Repo-relative built output directory to package. */
  packageDir: string;
  /** Entry file inside the package; must exist. */
  entryPoint: string;
  /** Generated entry shim to add to the package beside the entry, when `ssr.shim` is set. */
  shim?: EntryShim | undefined;
  /** Repo-relative directory of static browser assets to publish, when configured. */
  staticDir?: string | undefined;
  /** S3 key the package is uploaded to (`web/artifacts/<hash>.zip`). */
  artifactKey: string;
  /** S3 key the CLI reads the digest/version/stale keys from (`web/results/<hash>.json`). */
  resultKey: string;
}

/** What the agent writes to `resultKey` before the changed-paths manifest. */
interface WebFunctionBuildResult {
  artifactKey: string;
  artifactVersionId: string;
  artifactSha256: string;
  artifactSize: number;
  /** `site/` keys this build did not publish, left for the CLI to remove after the revision is verified. */
  staleStaticKeys: string[];
}

export interface BuildPayload {
  hash: string;
  sourceKey: string;
  bucket: string;
  region: string;
  sitePrefix: string;
  /** Directory (repo-relative) to run `pnpm install && pnpm build` in; default the repo root. */
  appDir?: string | undefined;
  /** Built output directory (repo-relative) to publish; default `dist`. */
  distDir?: string | undefined;
  /** robots.txt body to publish (the CLI computes it from env + config). */
  robots?: string | undefined;
  /** When set, generate sitemap.xml from the built pages using this origin. */
  sitemapBaseUrl?: string | undefined;
  /** S3 object tags for the synced site files (environment/app; preview deploys carry the PR id). */
  objectTags?: Record<string, string> | undefined;
  /**
   * The environment's `cacheControl` rules, matched against each file's
   * site-relative URL path; absent or empty writes no `Cache-Control`.
   */
  cacheControl?: readonly CacheControlRule[] | undefined;
  /**
   * Re-upload every built file even when its content is unchanged. S3 metadata
   * (content type, object tags, Cache-Control) is only written on a PUT, so a
   * metadata fix never reaches objects the ETag comparison would otherwise skip.
   */
  refresh?: boolean | undefined;
  /** Present only for an SSR environment: package the output as a Web Function revision artifact. */
  webFunction?: WebFunctionJob | undefined;
}

/** The job document the CLI drops at s3://<bucket>/build/pending.json. */
export interface PendingJob {
  hash: string;
  sourceKey: string;
  sitePrefix?: string;
  appDir?: string;
  distDir?: string;
  robots?: string;
  sitemapBaseUrl?: string;
  objectTags?: Record<string, string>;
  cacheControl?: CacheControlRule[];
  refresh?: boolean;
  webFunction?: WebFunctionJob;
}

export type LogFn = (line: string) => void;

let credCache: { creds: AwsCredentials; exp: number } | undefined;

/**
 * Resolve the MicroVM's execution-role credentials. Tries standard env vars first
 * (Lambda-style), then the ECS/container credentials endpoint - covering both ways
 * the exec role might be exposed inside the MicroVM.
 */
async function resolveCredentials(): Promise<AwsCredentials> {
  const envKey = process.env.AWS_ACCESS_KEY_ID;
  const envSecret = process.env.AWS_SECRET_ACCESS_KEY;
  if (envKey && envSecret) {
    return {
      accessKeyId: envKey,
      secretAccessKey: envSecret,
      ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
    };
  }
  const full = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  const rel = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  const url = full ?? (rel ? `http://169.254.170.2${rel}` : undefined);
  if (url) {
    const headers: Record<string, string> = {};
    const token = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
    if (token) headers['Authorization'] = token;
    const res = await fetch(url, { headers });
    const j = (await res.json()) as {
      AccessKeyId: string;
      SecretAccessKey: string;
      Token?: string;
    };
    return {
      accessKeyId: j.AccessKeyId,
      secretAccessKey: j.SecretAccessKey,
      ...(j.Token ? { sessionToken: j.Token } : {}),
    };
  }
  const imds = await imdsCredentials();
  if (imds) return imds;
  throw new Error('no AWS credentials available (env, container endpoint, or IMDS)');
}

/** Resolve credentials from the EC2-style instance metadata service (IMDSv2). */
async function imdsCredentials(): Promise<AwsCredentials | undefined> {
  const base = 'http://169.254.169.254';
  const timeout = () => AbortSignal.timeout(2000);
  try {
    const tokenRes = await fetch(`${base}/latest/api/token`, {
      method: 'PUT',
      headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '21600' },
      signal: timeout(),
    });
    const headers: Record<string, string> = tokenRes.ok
      ? { 'x-aws-ec2-metadata-token': await tokenRes.text() }
      : {};
    const listRes = await fetch(`${base}/latest/meta-data/iam/security-credentials/`, {
      headers,
      signal: timeout(),
    });
    if (!listRes.ok) return undefined;
    const role = (await listRes.text()).trim().split('\n')[0];
    if (!role) return undefined;
    const credRes = await fetch(`${base}/latest/meta-data/iam/security-credentials/${role}`, {
      headers,
      signal: timeout(),
    });
    if (!credRes.ok) return undefined;
    const j = (await credRes.json()) as {
      AccessKeyId: string;
      SecretAccessKey: string;
      Token?: string;
    };
    return {
      accessKeyId: j.AccessKeyId,
      secretAccessKey: j.SecretAccessKey,
      ...(j.Token ? { sessionToken: j.Token } : {}),
    };
  } catch {
    return undefined;
  }
}

const agentCredentials: CredentialProvider = async () => {
  if (credCache && Date.now() < credCache.exp) return credCache.creds;
  const creds = await resolveCredentials();
  credCache = { creds, exp: Date.now() + 5 * 60_000 };
  return creds;
};

/** Build an S3 client using the resolved exec-role credentials. */
export function createAgentS3(region: string): S3Client {
  return new S3Client(
    new SigningClient({
      region,
      credentials: agentCredentials,
      ...(process.env.AWS_ENDPOINT_URL ? { endpointOverride: process.env.AWS_ENDPOINT_URL } : {}),
    }),
  );
}

/**
 * Read all pending build jobs (one object per target under build/pending/). Multiple
 * targets (e.g. concurrent PR previews) each get their own key, so they never collide.
 */
export async function fetchPendingJobs(s3: S3Client, bucket: string): Promise<PendingJob[]> {
  const objects = await s3.listObjects(bucket, 'build/pending/');
  const jobs: PendingJob[] = [];
  for (const obj of objects) {
    if (!obj.key.endsWith('.json')) continue;
    const text = await s3.getObjectText(bucket, obj.key);
    if (text) jobs.push(JSON.parse(text) as PendingJob);
  }
  return jobs;
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  xml: 'application/xml',
  txt: 'text/plain; charset=utf-8',
  // Serve Markdown with its proper MIME type. The prior fallback (application/octet-stream)
  // forced the "view as Markdown" links to download; text/markdown is the correct type and
  // the one Markdown-aware agents request.
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  map: 'application/json',
  wasm: 'application/wasm',
  // PWA manifest. Chrome parses it whatever the type, which is why serving it as
  // application/octet-stream went unnoticed; stricter consumers reject that.
  webmanifest: 'application/manifest+json',
  jsonld: 'application/ld+json',
  // Fonts beyond woff/woff2 (a site may still ship legacy faces).
  ttf: 'font/ttf',
  otf: 'font/otf',
  // Media. Deliberately no `ts` entry (video/mp2t): in a site's build output a
  // .ts file is far more likely stray TypeScript than an HLS segment, and
  // mistyping source is worse than leaving a segment as octet-stream.
  mp4: 'video/mp4',
  webm: 'video/webm',
  m3u8: 'application/vnd.apple.mpegurl',
  mp3: 'audio/mpeg',
  vtt: 'text/vtt; charset=utf-8',
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
};

/** Served for any extension the map does not cover; see {@link contentType}. */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Whether a built file must be PUT again. Content-identical files are normally
 * skipped (that is what keeps a redeploy cheap and its invalidation narrow),
 * but S3 writes object metadata - content type, tags, Cache-Control - only on
 * a PUT, so a metadata fix would never reach them. `refresh` forces the upload.
 */
export function shouldUpload(
  existingEtag: string | undefined,
  md5: string,
  refresh: boolean | undefined,
): boolean {
  if (refresh) return true;
  return existingEtag !== md5;
}

/** What one site file is uploaded with. */
export interface SiteObjectMetadata {
  contentType: string;
  tags?: Record<string, string> | undefined;
  /** Omitted when no `cacheControl` rule matched the file. */
  cacheControl?: string | undefined;
}

/** True for the 403 a role without `s3:PutObjectTagging` gets on a tagged PUT. */
function isAccessDenied(err: unknown): boolean {
  return err instanceof AwsError && (err.statusCode === 403 || /AccessDenied/i.test(err.code));
}

/**
 * Upload the site files, degrading gracefully when the role may not tag.
 *
 * Object tags ride on the PUT (`x-amz-tagging`), but AWS still checks
 * `s3:PutObjectTagging` as a distinct action - a role granted only `s3:PutObject`
 * gets a 403 and the whole upload fails. Tags are metadata, not content: rather
 * than fail a deploy whose files are otherwise fine, drop the tags for the rest
 * of the run and say so. (A stack bootstrapped on a version that grants the
 * action never takes this path; one upgrading in place does, until it
 * re-bootstraps - and a CI deploy role cannot fix its own IAM.)
 */
export function createSiteUploader(s3: S3Client, log: LogFn) {
  let taggingDenied = false;
  return async function upload(
    bucket: string,
    key: string,
    content: Uint8Array,
    metadata: SiteObjectMetadata,
  ): Promise<void> {
    const { contentType: type, tags, cacheControl } = metadata;
    const wantsTags = tags !== undefined && Object.keys(tags).length > 0;
    if (wantsTags && !taggingDenied) {
      try {
        await s3.putObject(bucket, key, content, type, { tags, cacheControl });
        return;
      } catch (err) {
        // A plain PutObject denial re-throws below, from the untagged retry.
        if (!isAccessDenied(err)) throw err;
        taggingDenied = true;
        log(
          'warning: this role cannot tag objects (s3:PutObjectTagging denied) - ' +
            'uploading untagged. Run `blogwright bootstrap <env>` to grant it, then ' +
            'redeploy with --refresh to tag the existing objects.',
        );
      }
    }
    await s3.putObject(bucket, key, content, type, { cacheControl });
  };
}

/**
 * The lowercase extension of a key, or undefined when it has none (`LICENSE`,
 * `_headers`) - a leading dot is a dotfile, not an extension (`.nojekyll`).
 * Splitting the whole path would treat an extensionless *key* as its own
 * extension, which both mistypes files and produces nonsense diagnostics.
 */
export function extensionOf(path: string): string | undefined {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Content type for a key, or {@link DEFAULT_CONTENT_TYPE} when the extension is
 * unmapped or absent. The default is deliberate - it makes a browser download
 * rather than mis-render an unknown payload - but a *silently* wrong header is
 * how the .webmanifest gap survived, so runBuild logs unmapped extensions.
 */
export function contentType(path: string): string {
  const ext = extensionOf(path);
  if (ext === undefined) return DEFAULT_CONTENT_TYPE;
  // Object.hasOwn guards against inherited keys (e.g. a file named "x.constructor"
  // would otherwise resolve to Object.prototype.constructor - a truthy function).
  const type = Object.hasOwn(CONTENT_TYPES, ext) ? CONTENT_TYPES[ext] : undefined;
  return type ?? DEFAULT_CONTENT_TYPE;
}

/** Resolve a repo-relative dir, rejecting anything that escapes the work dir. */
export function resolveWithin(workDir: string, rel: string, label: string): string {
  const resolved = join(workDir, rel);
  if (resolved !== workDir && !resolved.startsWith(workDir + sep)) {
    throw new Error(`${label} "${rel}" escapes the work dir`);
  }
  return resolved;
}

/** Run a command, streaming combined output to the log. Rejects on non-zero exit. */
function exec(cmd: string, args: string[], cwd: string, log: LogFn): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`$ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { cwd, env: process.env });
    const onData = (buf: Buffer) => {
      for (const line of buf.toString('utf8').split('\n')) {
        if (line.trim()) log(line.trimEnd());
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(full)));
    else out.push(full);
  }
  return out;
}

/** The unzipped package size bound Lambda enforces. */
export const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;

/**
 * A package that must be self-contained: Lambda loads nothing outside the
 * archive, and pnpm's default `node_modules` is a symlink tree, so a symlink
 * anywhere in the package means the app cannot load once deployed. Fail the
 * build naming the path rather than archiving a tree that cannot run.
 */
async function walkPackageFiles(
  dir: string,
  prefix = '',
): Promise<{ path: string; rel: string; size: number }[]> {
  const out: { path: string; rel: string; size: number }[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  // Sorted so identical trees always produce identical archives.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(
        `SSR package contains a symbolic link at ${rel}: Lambda loads nothing that is not in ` +
          'the archive, so the package must be self-contained (copy production dependencies ' +
          "in as real files instead of relying on pnpm's symlinked node_modules)",
      );
    }
    if (entry.isDirectory()) {
      out.push(...(await walkPackageFiles(full, `${rel}/`)));
    } else if (entry.isFile()) {
      out.push({ path: full, rel, size: (await stat(full)).size });
    }
  }
  return out;
}

/**
 * Zip the built package with its contents at the archive root and a fixed
 * timestamp, so identical output produces identical bytes. A generated entry
 * shim is added to the archive only; the build output on disk is untouched.
 */
export async function packageWebFunction(
  packageDir: string,
  entryPoint: string,
  shim?: EntryShim,
): Promise<{ zip: Uint8Array; size: number }> {
  const entryPath = join(packageDir, ...entryPoint.split('/'));
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(entryPath);
  } catch {
    throw new Error(
      `SSR package entry point "${entryPoint}" does not exist under ${packageDir}; ` +
        (shim
          ? "the build must emit it (with ssr.shim set, it is the framework's server entry the " +
            'generated shim imports)'
          : 'the build must emit it (a consumer-owned entry shim, or ssr.shim, is the usual way)'),
    );
  }
  if (!entry.isFile()) {
    throw new Error(`SSR package entry point "${entryPoint}" is not a file`);
  }

  const files = await walkPackageFiles(packageDir);
  const shimBytes = shim ? new TextEncoder().encode(shim.source) : undefined;
  if (shim && files.some((file) => file.rel === shim.path)) {
    throw new Error(
      `SSR package already contains ${shim.path}, the path of the entry shim generated from ` +
        'config.ssr.shim: remove the build step that emits it, or drop ssr.shim and point ' +
        'ssr.entryPoint at your own shim',
    );
  }
  // Sized from the walk, before anything is read: an oversized package must
  // fail with this message, not by exhausting the builder's memory first.
  const unzipped =
    files.reduce((total, file) => total + file.size, 0) + (shimBytes?.byteLength ?? 0);
  if (unzipped > MAX_PACKAGE_BYTES) {
    throw new Error(
      `SSR package is ${(unzipped / (1024 * 1024)).toFixed(1)} MB unzipped, over Lambda's ` +
        `${MAX_PACKAGE_BYTES / (1024 * 1024)} MB limit`,
    );
  }
  const entries: Zippable = {};
  for (const file of files) {
    entries[file.rel] = new Uint8Array(await readFile(file.path));
  }
  if (shim && shimBytes) entries[shim.path] = shimBytes;
  const zip = zipSync(entries, { level: 6, mtime: REPRODUCIBLE_ZIP_MTIME });
  return { zip, size: unzipped };
}

/**
 * Upload the files under `rootDir` to the site prefix, comparing each file's
 * MD5 to the existing object's ETag so only genuinely changed content is
 * re-uploaded. Returns the keys this build wrote and - when `deleteStale` is
 * false, which is the SSR mode - the keys left behind, which only the CLI may
 * remove, after a revision is verified.
 */
async function publishFiles(opts: {
  s3: S3Client;
  log: LogFn;
  bucket: string;
  prefix: string;
  rootDir: string;
  files: string[];
  objectTags?: Record<string, string> | undefined;
  cacheControlFor: CacheControlLookup;
  refresh?: boolean | undefined;
  deleteStale: boolean;
}): Promise<{ changedKeys: Set<string>; staleKeys: string[]; count: number }> {
  const { s3, log } = opts;
  const existing = new Map(
    (await s3.listObjects(opts.bucket, opts.prefix)).map((o) => [o.key, o.etag]),
  );
  const uploadSiteFile = createSiteUploader(s3, log);
  const uploaded = new Set<string>();
  const changedKeys = new Set<string>();
  const unmapped = new Set<string>();
  if (opts.refresh) {
    log(
      'refresh: re-uploading every file (metadata - content type, tags, Cache-Control - may have changed)',
    );
  }
  for (const file of opts.files) {
    const sitePath = relative(opts.rootDir, file).split('\\').join('/');
    const key = opts.prefix + sitePath;
    uploaded.add(key);
    const content = await readFile(file);
    const md5 = createHash('md5').update(content).digest('hex');
    const type = contentType(key);
    // Only real extensions are worth warning about: for an extensionless file
    // (LICENSE, _headers) octet-stream is the correct answer, not a gap.
    const ext = extensionOf(key);
    if (type === DEFAULT_CONTENT_TYPE && ext !== undefined) unmapped.add(ext);
    if (!shouldUpload(existing.get(key), md5, opts.refresh)) continue;
    await uploadSiteFile(opts.bucket, key, content, {
      contentType: type,
      tags: opts.objectTags,
      // Matched on the URL path, not the key, so previews share production's rules.
      cacheControl: opts.cacheControlFor(`/${sitePath}`),
    });
    changedKeys.add(key);
  }
  if (unmapped.size > 0) {
    // A silently wrong header is how the .webmanifest gap survived; say it out loud.
    log(
      `warning: no content type mapped for extension(s) ${[...unmapped].sort().join(', ')} - ` +
        `serving them as ${DEFAULT_CONTENT_TYPE}`,
    );
  }
  const staleKeys: string[] = [];
  for (const key of existing.keys()) {
    if (uploaded.has(key)) continue;
    if (opts.deleteStale) {
      await s3.deleteObject(opts.bucket, key);
      changedKeys.add(key);
    } else {
      staleKeys.push(key);
    }
  }
  return { changedKeys, staleKeys, count: opts.files.length };
}

/** What a publish left behind for the CLI. */
export interface PublishResult {
  /** Keys this build uploaded, for the targeted invalidation. */
  changedKeys: Set<string>;
  count: number;
  /** The `cacheControl` rules every uploaded file was written with, as the agent parsed them. */
  cacheControl: CacheControlRule[];
}

/**
 * The changed-paths manifest the CLI reads for a targeted invalidation. It
 * also reports the `cacheControl` rules this agent applied: the CLI records a
 * target's rules only on that evidence, because an agent older than
 * `cacheControl` drops the rules and still finishes the build.
 */
export interface ChangedPathsManifest {
  /** URL paths to invalidate. */
  paths: string[];
  cacheControl: CacheControlRule[];
}

/** Build the {@link ChangedPathsManifest} for a publish to `prefix`. */
export function changedPathsManifest(
  published: PublishResult,
  prefix: string,
): ChangedPathsManifest {
  const paths = [
    ...new Set([...published.changedKeys].flatMap((k) => invalidationPaths(k, prefix))),
  ];
  return { paths, cacheControl: published.cacheControl };
}

/** Write the {@link ChangedPathsManifest}, the build's last step. */
async function writeChangedPaths(
  s3: S3Client,
  log: LogFn,
  bucket: string,
  hash: string,
  manifest: ChangedPathsManifest,
): Promise<void> {
  // If writing the manifest fails (e.g. the runtime role lacks build/changed/* PutObject),
  // the site is already published, so log and continue: the CLI falls back to a wildcard
  // invalidation, and treats the rules as unconfirmed so the next build re-applies them.
  try {
    await s3.putObject(
      bucket,
      `build/changed/${hash}.json`,
      JSON.stringify(manifest),
      'application/json',
    );
  } catch (err) {
    log(`warning: could not write changed-paths manifest (${(err as Error).message})`);
  }
}

/**
 * Publish the built static assets and, for an SSR environment, package the
 * server output and upload it as the revision artifact. Returns the number of
 * published static files and the changed keys.
 */
export async function publishBuild(
  s3: S3Client,
  payload: BuildPayload,
  workDir: string,
  distDir: string,
  log: LogFn,
): Promise<PublishResult> {
  const prefix = payload.sitePrefix.endsWith('/') ? payload.sitePrefix : `${payload.sitePrefix}/`;
  const cacheControl = parseCacheControlRules(payload.cacheControl ?? []);
  const cacheControlFor = createCacheControlLookup(cacheControl);
  const job = payload.webFunction;
  if (!job) {
    const built = await walkFiles(distDir);
    log(`uploading ${built.length} files to site/`);
    const published = await publishFiles({
      s3,
      log,
      bucket: payload.bucket,
      prefix,
      rootDir: distDir,
      files: built,
      objectTags: payload.objectTags,
      cacheControlFor,
      refresh: payload.refresh,
      deleteStale: true,
    });
    log(
      `published ${built.length} files (${published.changedKeys.size} changed) to s3://${payload.bucket}/${prefix}`,
    );
    return { changedKeys: published.changedKeys, count: published.count, cacheControl };
  }

  // SSR: package the server output first, then publish only `staticDir` (when
  // set) - upload-only, because the revision still serving references keys this
  // build would otherwise remove.
  const packageDir = resolveWithin(workDir, job.packageDir, 'packageDir');
  const { zip, size } = await packageWebFunction(packageDir, job.entryPoint, job.shim);
  if (job.shim) log(`added entry shim ${job.shim.path} (starts ${job.entryPoint})`);
  const digest = createHash('sha256').update(zip).digest('hex');
  const versionId = await s3.putObject(payload.bucket, job.artifactKey, zip, 'application/zip');
  log(
    `uploaded SSR package ${job.artifactKey} (${(zip.byteLength / 1024).toFixed(0)} KiB zipped, ` +
      `${(size / (1024 * 1024)).toFixed(1)} MB unzipped, sha256 ${digest.slice(0, 12)}…)`,
  );

  let changedKeys = new Set<string>();
  let staleKeys: string[] = [];
  if (job.staticDir) {
    const staticDir = resolveWithin(workDir, job.staticDir, 'staticDir');
    const assets = await walkFiles(staticDir);
    log(`publishing ${assets.length} static asset(s) from ${job.staticDir} to site/`);
    const published = await publishFiles({
      s3,
      log,
      bucket: payload.bucket,
      prefix,
      rootDir: staticDir,
      files: assets,
      objectTags: payload.objectTags,
      cacheControlFor,
      refresh: payload.refresh,
      deleteStale: false,
    });
    changedKeys = published.changedKeys;
    staleKeys = published.staleKeys;
    log(
      `published ${assets.length} static asset(s) (${changedKeys.size} changed) to ` +
        `s3://${payload.bucket}/${prefix}`,
    );
  } else {
    log('no ssr.staticDir configured - leaving site/ untouched');
  }

  // The result file, before the changed-paths manifest that signals completion.
  const result: WebFunctionBuildResult = {
    artifactKey: job.artifactKey,
    artifactVersionId: versionId ?? 'null',
    artifactSha256: digest,
    artifactSize: zip.byteLength,
    staleStaticKeys: staleKeys,
  };
  await s3.putObject(
    payload.bucket,
    job.resultKey,
    JSON.stringify(result, null, 2),
    'application/json',
  );
  log(`wrote ${job.resultKey} (${staleKeys.length} stale site key(s) left for the CLI)`);
  return { changedKeys, count: 0, cacheControl };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a standards-compliant sitemap.xml from the built HTML pages. Directory index
 * documents map to their clean directory URL (`posts/index.html` → `<base>/posts/`);
 * error pages are excluded. `base` is the site origin (no trailing slash).
 */
export async function generateSitemap(distDir: string, base: string): Promise<string> {
  const origin = base.replace(/\/+$/, '');
  const locs: string[] = [];
  for (const file of await walkFiles(distDir)) {
    const rel = relative(distDir, file).split(sep).join('/');
    if (!rel.endsWith('.html')) continue;
    if (rel === '404.html' || rel.endsWith('/404.html')) continue;
    if (rel === 'index.html') locs.push(`${origin}/`);
    else if (rel.endsWith('/index.html'))
      locs.push(`${origin}/${rel.slice(0, -'index.html'.length)}`);
    else locs.push(`${origin}/${rel}`);
  }
  locs.sort();
  const urls = locs.map((loc) => `  <url><loc>${escapeXml(loc)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * The build pipeline that runs inside the MicroVM: download the source zip, install
 * dependencies, build the site, and publish it. In SSR mode the built package is
 * zipped and uploaded as a revision artifact, `site/` receives only `staticDir`, and
 * robots.txt/sitemap.xml generation is skipped because the application owns those
 * routes.
 */
export async function runBuild(s3: S3Client, payload: BuildPayload, log: LogFn): Promise<void> {
  const workDir = join(tmpdir(), `build-${payload.hash}`);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  log(`downloading s3://${payload.bucket}/${payload.sourceKey}`);
  const zip = await s3.getObject(payload.bucket, payload.sourceKey);
  const files = unzipSync(zip);
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const dest = join(workDir, name);
    // Guard against zip-slip: a malicious entry name ("../etc/…") must not escape workDir.
    if (dest !== workDir && !dest.startsWith(workDir + sep)) {
      throw new Error(`unsafe zip entry escapes work dir: ${name}`);
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }
  log(`extracted ${Object.keys(files).length} files`);

  // A monorepo site (config paths.app/paths.dist) builds in a subdirectory and
  // publishes from wherever its toolchain emits; both must stay inside workDir.
  const appDir = resolveWithin(workDir, payload.appDir ?? '.', 'appDir');
  // --prod=false: the image bakes NODE_ENV=production (right for `pnpm run build`),
  // but under it pnpm skips devDependencies - where static sites keep their build
  // tooling (astro, vite, tailwind). The site build needs the full install.
  await exec('pnpm', ['install', '--frozen-lockfile', '--prod=false'], appDir, log);
  await exec('pnpm', ['run', 'build'], appDir, log);

  const distDir = resolveWithin(workDir, payload.distDir ?? 'dist', 'distDir');

  // Write SEO artifacts into the build output before the walk so they publish (and
  // invalidate) like any other page. robots.txt/sitemap.xml are the application's
  // routes in SSR mode, so the CLI sends nothing and the agent writes nothing.
  if (!payload.webFunction) {
    if (payload.robots !== undefined) {
      await writeFile(join(distDir, 'robots.txt'), payload.robots);
      log('wrote robots.txt');
    }
    if (payload.sitemapBaseUrl) {
      const xml = await generateSitemap(distDir, payload.sitemapBaseUrl);
      await writeFile(join(distDir, 'sitemap.xml'), xml);
      log('wrote sitemap.xml');
    }
  }

  const prefix = payload.sitePrefix.endsWith('/') ? payload.sitePrefix : `${payload.sitePrefix}/`;
  const published = await publishBuild(s3, payload, workDir, distDir, log);
  // The changed-paths manifest is the completion signal the CLI polls and reads.
  // It goes LAST: in SSR mode the result file the CLI's publish step reads must
  // already be in place when the manifest appears.
  await writeChangedPaths(
    s3,
    log,
    payload.bucket,
    payload.hash,
    changedPathsManifest(published, prefix),
  );
  await rm(workDir, { recursive: true, force: true });
}

/**
 * Map a changed S3 key to the CloudFront URL path(s) to invalidate. For directory
 * index documents, invalidate both the `index.html` key and the directory URL a viewer
 * would actually request (e.g. `site/posts/index.html` → `/posts/index.html` + `/posts/`).
 */
export function invalidationPaths(key: string, prefix: string): string[] {
  const rel = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const paths = [`/${rel}`];
  if (rel === 'index.html') paths.push('/');
  else if (rel.endsWith('/index.html')) paths.push(`/${rel.slice(0, -'index.html'.length)}`);
  return paths;
}
