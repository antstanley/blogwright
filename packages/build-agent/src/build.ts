import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import {
  S3Client,
  SigningClient,
  type AwsCredentials,
  type CredentialProvider,
} from 'blogwright-core';
import { unzipSync } from 'fflate';

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
}

export type LogFn = (line: string) => void;

let credCache: { creds: AwsCredentials; exp: number } | undefined;

/**
 * Resolve the MicroVM's execution-role credentials. Tries standard env vars first
 * (Lambda-style), then the ECS/container credentials endpoint — covering both ways
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
};

export function contentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  // Object.hasOwn guards against inherited keys (e.g. a file named "x.constructor"
  // would otherwise resolve to Object.prototype.constructor — a truthy function).
  const type = Object.hasOwn(CONTENT_TYPES, ext) ? CONTENT_TYPES[ext] : undefined;
  return type ?? 'application/octet-stream';
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
 * dependencies, build the Astro site, and sync dist/ to the bucket's site/ prefix.
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
  // but under it pnpm skips devDependencies — where static sites keep their build
  // tooling (astro, vite, tailwind). The site build needs the full install.
  await exec('pnpm', ['install', '--frozen-lockfile', '--prod=false'], appDir, log);
  await exec('pnpm', ['run', 'build'], appDir, log);

  const distDir = resolveWithin(workDir, payload.distDir ?? 'dist', 'distDir');

  // Write SEO artifacts into dist/ before the walk so they publish (and invalidate) like
  // any other page. robots.txt/sitemap.xml policy is decided by the CLI per environment.
  if (payload.robots !== undefined) {
    await writeFile(join(distDir, 'robots.txt'), payload.robots);
    log('wrote robots.txt');
  }
  if (payload.sitemapBaseUrl) {
    const xml = await generateSitemap(distDir, payload.sitemapBaseUrl);
    await writeFile(join(distDir, 'sitemap.xml'), xml);
    log('wrote sitemap.xml');
  }

  const built = await walkFiles(distDir);
  log(`uploading ${built.length} files to site/`);

  const prefix = payload.sitePrefix.endsWith('/') ? payload.sitePrefix : `${payload.sitePrefix}/`;
  // Compare each new file's MD5 to the existing object's ETag so only genuinely changed
  // content is re-uploaded, and only changed URL paths get invalidated. Publish first,
  // then delete stale keys, so the live site never has an empty/partial window.
  const existing = new Map(
    (await s3.listObjects(payload.bucket, prefix)).map((o) => [o.key, o.etag]),
  );
  const uploaded = new Set<string>();
  const changedKeys = new Set<string>();
  for (const file of built) {
    const key = prefix + relative(distDir, file).split('\\').join('/');
    uploaded.add(key);
    const content = await readFile(file);
    const md5 = createHash('md5').update(content).digest('hex');
    if (existing.get(key) === md5) continue; // unchanged — skip upload + invalidation
    await s3.putObject(payload.bucket, key, content, contentType(key));
    changedKeys.add(key);
  }
  for (const key of existing.keys()) {
    if (!uploaded.has(key)) {
      await s3.deleteObject(payload.bucket, key);
      changedKeys.add(key);
    }
  }

  const changedPaths = [...new Set([...changedKeys].flatMap((k) => invalidationPaths(k, prefix)))];
  // The changed-paths manifest is only an invalidation optimization: if writing it fails
  // (e.g. the runtime role lacks build/changed/* PutObject), the site is already published,
  // so log and continue — the CLI falls back to a wildcard invalidation.
  try {
    await s3.putObject(
      payload.bucket,
      `build/changed/${payload.hash}.json`,
      JSON.stringify({ paths: changedPaths }),
      'application/json',
    );
  } catch (err) {
    log(`warning: could not write changed-paths manifest (${(err as Error).message})`);
  }
  log(
    `published ${built.length} files (${changedKeys.size} changed) to s3://${payload.bucket}/${prefix}`,
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
