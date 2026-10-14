/** Per-environment configuration and deterministic resource naming. */

export interface IdlePolicyConfig {
  autoResumeEnabled: boolean;
  maxIdleDurationSeconds: number;
  suspendedDurationSeconds: number;
}

/** robots.txt policy. `auto` = index in production, block crawlers everywhere else. */
export type RobotsMode = 'auto' | 'index' | 'noindex' | 'off';

export interface SeoConfig {
  /**
   * How the deploy pipeline writes robots.txt into the published site:
   * - `auto` (default): production → indexable; every other environment → blocked.
   * - `index` / `noindex`: force either regardless of environment.
   * - `off`: don't manage robots.txt at all (leave whatever the build produced).
   */
  robots: RobotsMode;
  /** Explicit robots.txt body; when set it overrides `robots` verbatim. */
  robotsContent?: string | undefined;
  /**
   * sitemap.xml generation (built from the site's HTML pages, absolute URLs):
   * `auto` (default) → on in production, off elsewhere; `on`/`off` force it.
   * Requires a resolvable site origin (custom domain or the CloudFront domain).
   */
  sitemap: 'auto' | 'on' | 'off';
}

/**
 * Server-rendered site mode (`ssr`). Its presence turns the environment into a
 * Lambda Web Function deployment: the MicroVM build's output directory is
 * packaged, stored in the site bucket and published as an immutable Web
 * Function revision that the site's CloudFront distribution serves as a
 * private origin. Site-owned config, like `microvm`, `seo` and `paths` - its
 * contract is the Web Functions spec page and `validateConfig` is its runtime
 * enforcement.
 */
export interface SsrConfig {
  /** Built output directory to package, repo-relative. Defaults to `paths.dist`. */
  packageDir: string;
  /** Entry file inside the package that starts the HTTP server. */
  entryPoint: string;
  /**
   * When set, Blogwright generates the entry shim: the package gains
   * `SSR_SHIM_FILE` beside `entryPoint`, which maps `AWS_LAMBDA_HTTP_ENDPOINT`
   * onto these variables before importing `entryPoint`, and the revision starts
   * the shim. Absent, `entryPoint` must listen on the endpoint itself.
   */
  shim?: SsrShimConfig | undefined;
  /**
   * Repo-relative directory of static browser assets to keep publishing to
   * `site/`. Supplied together with `staticPaths`; when absent the build leaves
   * `site/` untouched.
   */
  staticDir?: string | undefined;
  /** CloudFront path patterns (each beginning `/`) served from S3, in order. */
  staticPaths: string[];
  /**
   * Viewer header names included in the SSR cache key and forwarded to the
   * application. Empty by default; `Authorization` is the usual entry.
   */
  cacheKeyHeaders: string[];
  /**
   * Literal environment variables baked into every revision. Never secrets;
   * Lambda-reserved names are rejected at config load.
   */
  env: Record<string, string>;
  /** Revision timeout in seconds (3-900). */
  timeoutSeconds: number;
  /** Concurrent requests each execution environment handles (1-128). */
  maxConcurrencyPerEnvironment: number;
}

/** The variable names a generated entry shim sets from `AWS_LAMBDA_HTTP_ENDPOINT`. */
export interface SsrShimConfig {
  /** Variable the server reads its listen host from; omitted for servers that read only a port. */
  host?: string | undefined;
  /** Variable the server reads its listen port from. */
  port: string;
}

/**
 * File name of the generated entry shim, written beside `ssr.entryPoint` so
 * the entry's relative imports and directory lookups resolve as they would
 * when started directly.
 */
export const SSR_SHIM_FILE = 'blogwright-entry.mjs';

/** Lambda Web Function runtime id: Node.js 24 on Arm64, the only runtime offered. */
export const WEB_FUNCTION_RUNTIME = 'nodejs24.x';

/** Regions where Lambda Web Functions are available at launch. */
export const WEB_FUNCTION_REGIONS: readonly string[] = [
  'us-east-1',
  'us-east-2',
  'us-west-2',
  'ap-northeast-1',
  'eu-west-1',
];

/**
 * Environment variable names Lambda reserves on a Web Function revision. A
 * config that tries to set one is rejected at load, naming the key, rather
 * than by the API at deploy time.
 */
export const WEB_FUNCTION_RESERVED_ENV: readonly string[] = [
  'AWS_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SECRET_KEY',
  'AWS_SECURITY_TOKEN',
  'AWS_SESSION_TOKEN',
  'AWS_DEFAULT_REGION',
  'AWS_REGION',
  'AWS_LAMBDA_HTTP_ENDPOINT',
  'AWS_LAMBDA_RUNTIME_API',
  'AWS_LAMBDA_INITIALIZATION_TYPE',
  'AWS_LAMBDA_FUNCTION_MEMORY_SIZE',
  'AWS_LAMBDA_METADATA_API',
  'AWS_LAMBDA_METADATA_TOKEN',
  'AWS_LAMBDA_NODEJS_ENTRYPOINT',
];

/**
 * Headers CloudFront owns or strips before the application sees a request, so
 * listing one in `cacheKeyHeaders` cannot distinguish viewers (lowercased;
 * matched case-insensitively). Names beginning `lambda-web-` are rejected too,
 * by prefix.
 */
export const WEB_FUNCTION_CACHE_KEY_DENYLIST: readonly string[] = [
  'host',
  'accept-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'expect',
  'te',
  'trailer',
  'transfer-encoding',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'x-real-ip',
  'x-http-method',
  'x-http-method-override',
  'x-method-override',
];

/** CloudFront's default quota for headers in one cache policy (confirmed live). */
export const WEB_FUNCTION_CACHE_KEY_MAX_COUNT = 10;
/** CloudFront's maximum length for one header name in a cache policy (confirmed live). */
export const WEB_FUNCTION_CACHE_KEY_NAME_MAX_LENGTH = 128;
/**
 * CloudFront's cache-policy header-list quota, measured as the names joined by
 * a comma. The API rejects a list whose joined length REACHES this number (a
 * 1,023-character list is accepted, 1,024 is not), so validation rejects at
 * the quota rather than above it - both confirmed against the live API.
 */
export const WEB_FUNCTION_CACHE_KEY_MAX_LENGTH = 1_024;

/** `ssr.entryPoint` default: the runtime's own default entry file. */
export const SSR_DEFAULT_ENTRY_POINT = 'index.js';
/** `ssr.timeoutSeconds` default. */
export const SSR_DEFAULT_TIMEOUT_SECONDS = 30;
/** `ssr.maxConcurrencyPerEnvironment` default. */
export const SSR_DEFAULT_MAX_CONCURRENCY = 64;

/**
 * AT Protocol / standard.site publishing (see `blogwright pds`). Inert when
 * absent.
 *
 * A *shape*, not a contract core enforces: `blogwright-pds` owns this key end
 * to end - it validates the block (`validatePdsConfig`) and derives the
 * `<siteName>/atproto` default `secretName` (`resolvePdsSecretName`). Core
 * parses the block through untouched. The CLI's own resource graph no longer
 * reads the block at all: its deploy-role statement for the secret is gone,
 * and that grant is now the plugin's own named inline policy
 * (`buildPdsNodes`, `packages/pds/src/nodes.ts`). The type stays here because
 * `OpsConfig.pds` is still a declared member, and it is through
 * `ctx.config.pds` that the plugin itself reads the block.
 */
export interface PdsConfig {
  /** Publication display name (site.standard.publication `name`). */
  name: string;
  /** Optional publication description. */
  description?: string | undefined;
  /**
   * Resolver used by `pds login` to turn a handle into a DID (unused when
   * logging in with a bare DID). The PDS endpoint itself is discovered from
   * the DID document during OAuth.
   */
  handleResolver?: string | undefined;
  /**
   * Secrets Manager secret holding the OAuth client key + session. Optional
   * because core no longer defaults it: `blogwright-pds` resolves an absent
   * one to `<siteName>/atproto`.
   */
  secretName?: string | undefined;
}

/**
 * Repo-relative paths the pds commands read/write in the consuming site.
 * The OAuth client documents and the standard.site well-known file live at
 * protocol-fixed locations under `publicDir` (their URL paths are part of the
 * OAuth client id / standard.site spec), so only the directory roots vary.
 */
export interface PathsConfig {
  /** The static-asset directory served at the site root (Astro's `public/`). */
  publicDir: string;
  /** Content-collection directory the pds sync enumerates for posts. */
  content: string;
  /** JSON file the site imports to render its document <link> tags. */
  atprotoJson: string;
  /**
   * Directory the MicroVM builds in (`pnpm install && pnpm build` runs here).
   * "." for an app at the repo root; "web" for a monorepo subdirectory.
   */
  app: string;
  /** Built output directory the MicroVM publishes, relative to the repo root. */
  dist: string;
}

export interface OpsConfig {
  /** Primary region for S3 / MicroVM / logs. ACM+CloudFront are always us-east-1. */
  region: string;
  /** Stable slug used in every derived AWS resource name. Required. */
  siteName: string;
  /**
   * Value of the `app` tag applied to every created AWS resource. Falls back
   * to the domain, then the repo directory name, when unset.
   */
  app?: string | undefined;
  /** Custom domain; may also be supplied via --domain. */
  domain?: string | undefined;
  /** MicroVM builder sizing / lifecycle. */
  microvm: {
    memory: number;
    maxDurationSeconds: number;
    idle: IdlePolicyConfig;
  };
  /** CloudWatch retention (days). */
  retention: {
    microvmDays: number;
    cloudfrontDays: number;
    /** Retention for the Web Function's own two log groups. */
    webFunctionDays: number;
  };
  /** Extra path prefixes excluded from the source zip (on top of .gitignore). */
  sourceIgnore: string[];
  /**
   * Paths zipped into the deploy source even when gitignored - for artifacts a
   * pre-deploy step builds outside the MicroVM (a wasm bundle, generated
   * assets). Each entry must exist and be non-empty at deploy time, so a
   * forgotten pre-build fails fast instead of shipping a broken site.
   */
  sourceInclude: string[];
  /** CloudFront default root object. */
  defaultRootObject: string;
  /** If more than this many paths change in a deploy, invalidate `/*` instead. */
  invalidationMaxPaths: number;
  /** GitHub `owner/repo`, used to scope the preview stack's OIDC deploy role. */
  githubRepo?: string | undefined;
  /**
   * Single-page app mode: CloudFront serves /index.html with a 200 for
   * unknown paths (client-side routing) instead of the 404 page. Applies to
   * the main distribution at creation; previews are unaffected (their error
   * responses cannot be host-routed).
   */
  spa: boolean;
  /** robots.txt / sitemap.xml behaviour (environment-aware defaults). */
  seo: SeoConfig;
  /** standard.site publishing to the owner's AT Protocol PDS; disabled when absent. */
  pds?: PdsConfig | undefined;
  /**
   * Server-rendering mode. When present the environment is built and served as
   * a Lambda Web Function instead of a purely static site; absent, every
   * existing static contract applies unchanged.
   */
  ssr?: SsrConfig | undefined;
  /** Site-repo layout; the defaults match a stock Astro project. */
  paths: PathsConfig;
}

/** Every setting except the required `siteName`. */
export const DEFAULT_CONFIG: Omit<OpsConfig, 'siteName'> = {
  region: 'us-east-1',
  microvm: {
    memory: 4,
    maxDurationSeconds: 1800,
    idle: {
      autoResumeEnabled: false,
      maxIdleDurationSeconds: 300,
      suspendedDurationSeconds: 120,
    },
  },
  retention: {
    microvmDays: 365,
    cloudfrontDays: 90,
    webFunctionDays: 90,
  },
  sourceIgnore: ['.jj/', '.git/', 'node_modules/', 'dist/', '.astro/'],
  sourceInclude: [],
  defaultRootObject: 'index.html',
  invalidationMaxPaths: 1000,
  spa: false,
  seo: { robots: 'auto', sitemap: 'auto' },
  paths: {
    publicDir: 'public',
    content: 'src/content/blog',
    atprotoJson: 'src/data/atproto.json',
    app: '.',
    dist: 'dist',
  },
};

/** Strip // and /* *\/ comments from a JSONC string, respecting string literals. */
export function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Remove trailing commas before a closing `}`/`]`, respecting string literals.
 * JSONC editors accept them (and hand-written configs grow them), but
 * JSON.parse does not. Run after comment stripping.
 */
export function stripTrailingCommas(input: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += input[i + 1] ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      // A comma directly followed (across whitespace) by a closer is dropped.
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j]!)) j++;
      if (input[j] === '}' || input[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Parse a JSONC config document into both its validated `OpsConfig` and the
 * raw parsed document. `raw` carries every top-level property the file has,
 * including a plugin's own key - `OpsConfig` has no index signature to read
 * one off `config`, so a plugin's block survives the parse only here.
 * `parseConfig` keeps its existing signature as this function's `config`
 * half, so no existing caller changes.
 */
export function parseConfigDocument(text: string): {
  config: OpsConfig;
  raw: Readonly<Record<string, unknown>>;
} {
  const raw = JSON.parse(stripTrailingCommas(stripJsonComments(text))) as Record<string, unknown>;
  const config = mergeConfig(raw as ConfigInput);
  return { config, raw };
}

/** Parse + validate a JSONC config document, merged over defaults. */
export function parseConfig(text: string): OpsConfig {
  return parseConfigDocument(text).config;
}

/**
 * Read a plugin's own block out of a config document's raw form - the
 * `unknown` the CLI hands straight to that plugin's `validateConfig`. Not a
 * function a plugin calls itself; only the CLI's dispatch path reads a
 * block this way, over the `raw` half {@link parseConfigDocument} returns.
 */
export function pluginBlock(raw: Readonly<Record<string, unknown>>, key: string): unknown {
  return raw[key];
}

/**
 * What `mergeConfig` accepts: a partial `OpsConfig` whose `ssr` block may be
 * spelled only as far as the operator wrote it - `normalizeSsrConfig` fills
 * the defaults and enforces every field rule.
 */
export type ConfigInput = Omit<Partial<OpsConfig>, 'ssr'> & {
  ssr?: Partial<SsrConfig> | undefined;
};

export function mergeConfig(raw: ConfigInput): OpsConfig {
  if (!raw.siteName) {
    throw new Error(
      'config.siteName is required - a stable lowercase slug used in every derived AWS resource name',
    );
  }
  const paths: PathsConfig = { ...DEFAULT_CONFIG.paths, ...raw.paths };
  // `ssr` is pulled out of the spread so its raw, partial block never reaches
  // `OpsConfig` un-normalised.
  const { ssr: rawSsr, ...rest } = raw;
  const cfg: OpsConfig = {
    ...DEFAULT_CONFIG,
    ...rest,
    siteName: raw.siteName,
    microvm: {
      ...DEFAULT_CONFIG.microvm,
      ...raw.microvm,
      idle: { ...DEFAULT_CONFIG.microvm.idle, ...raw.microvm?.idle },
    },
    retention: { ...DEFAULT_CONFIG.retention, ...raw.retention },
    seo: { ...DEFAULT_CONFIG.seo, ...raw.seo },
    paths,
  };
  // Normalised after `paths`, because `packageDir` defaults to `paths.dist`;
  // assigned rather than spread so a malformed block cannot leak raw fields
  // past validation.
  const ssr = normalizeSsrConfig(rawSsr, paths.dist);
  if (ssr) cfg.ssr = ssr;
  validateConfig(cfg);
  return cfg;
}

/** RFC 7230 token characters - what an HTTP header name may contain. */
const HEADER_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Environment variable name shape `ssr.env` accepts. */
const ENV_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Every key `ssr` declares; anything else in the block is a typo, not a setting. */
const SSR_KEYS = new Set<string>([
  'packageDir',
  'entryPoint',
  'shim',
  'staticDir',
  'staticPaths',
  'cacheKeyHeaders',
  'env',
  'timeoutSeconds',
  'maxConcurrencyPerEnvironment',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Repo-relative path shape shared by `ssr.packageDir`/`ssr.staticDir`. */
function repoRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`config.${label} must be a non-empty repo-relative path`);
  }
  if (value.startsWith('/') || value.split('/').includes('..')) {
    throw new Error(`config.${label} must be repo-relative without "..", got "${value}"`);
  }
  return value;
}

/** Keys `ssr.shim` declares. */
const SSR_SHIM_KEYS = new Set<string>(['host', 'port']);

/**
 * The listen variable names of `ssr.shim`. Each must be a variable name the
 * runtime does not reserve, the two must differ, and neither may also be set in
 * `ssr.env`: the shim overwrites it at start, so the literal value would never
 * be seen.
 */
function normalizeShimConfig(raw: unknown, env: Record<string, string>): SsrShimConfig {
  if (!isRecord(raw)) {
    throw new Error('config.ssr.shim must be an object naming the "host" and "port" variables');
  }
  for (const key of Object.keys(raw)) {
    if (!SSR_SHIM_KEYS.has(key)) throw new Error(`config.ssr.shim has unknown key "${key}"`);
  }
  if (raw.port === undefined) throw new Error('config.ssr.shim.port is required');
  const port = shimVariable(raw.port, 'port', env);
  if (raw.host === undefined) return { port };
  const host = shimVariable(raw.host, 'host', env);
  if (host === port) {
    throw new Error(`config.ssr.shim.host and ssr.shim.port must differ, both are "${host}"`);
  }
  return { host, port };
}

function shimVariable(value: unknown, field: string, env: Record<string, string>): string {
  if (typeof value !== 'string' || !ENV_KEY_PATTERN.test(value)) {
    throw new Error(
      `config.ssr.shim.${field} must be an environment variable name matching ` +
        `[A-Za-z][A-Za-z0-9_]*, got ${JSON.stringify(value)}`,
    );
  }
  if (WEB_FUNCTION_RESERVED_ENV.includes(value)) {
    throw new Error(`config.ssr.shim.${field} cannot be "${value}": it is reserved by Lambda`);
  }
  if (Object.hasOwn(env, value)) {
    throw new Error(
      `config.ssr.shim.${field} names "${value}", which ssr.env also sets: the shim ` +
        'overwrites it at start, so remove it from ssr.env',
    );
  }
  return value;
}

function integerInRange(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`config.${label} must be an integer in ${min}..${max}, got ${String(value)}`);
  }
  return value;
}

/**
 * Validate a raw `ssr` block and fill its defaults, or return undefined when
 * the key is absent. Runs before `OpsConfig` is assembled so a malformed block
 * (`null`, an array, an unknown key) cannot survive the merge.
 */
function normalizeSsrConfig(raw: unknown, distDir: string): SsrConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new Error('config.ssr must be an object');
  for (const key of Object.keys(raw)) {
    if (!SSR_KEYS.has(key)) throw new Error(`config.ssr has unknown key "${key}"`);
  }

  const packageDir =
    raw.packageDir === undefined ? distDir : repoRelativePath(raw.packageDir, 'ssr.packageDir');

  let entryPoint = SSR_DEFAULT_ENTRY_POINT;
  if (raw.entryPoint !== undefined) {
    const value = raw.entryPoint;
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error('config.ssr.entryPoint must be a non-empty relative path');
    }
    if (value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
      throw new Error(
        `config.ssr.entryPoint must be a "/"-separated relative path inside the package ` +
          `without "..", got "${value}"`,
      );
    }
    entryPoint = value;
  }

  let staticDir: string | undefined;
  if (raw.staticDir !== undefined) {
    staticDir = repoRelativePath(raw.staticDir, 'ssr.staticDir');
  }

  let staticPaths: string[] = [];
  if (raw.staticPaths !== undefined) {
    if (!Array.isArray(raw.staticPaths)) {
      throw new Error('config.ssr.staticPaths must be an array of CloudFront path patterns');
    }
    staticPaths = raw.staticPaths.map((pattern: unknown, i: number) => {
      if (typeof pattern !== 'string' || !pattern.startsWith('/')) {
        throw new Error(
          `config.ssr.staticPaths[${i}] must be a CloudFront path pattern beginning "/", ` +
            `got ${JSON.stringify(pattern)}`,
        );
      }
      return pattern;
    });
  }
  if (staticDir !== undefined && staticPaths.length === 0) {
    throw new Error('config.ssr.staticPaths is required when ssr.staticDir is set');
  }
  if (staticDir === undefined && staticPaths.length > 0) {
    throw new Error('config.ssr.staticDir is required when ssr.staticPaths is set');
  }

  let cacheKeyHeaders: string[] = [];
  if (raw.cacheKeyHeaders !== undefined) {
    if (!Array.isArray(raw.cacheKeyHeaders)) {
      throw new Error('config.ssr.cacheKeyHeaders must be an array of HTTP header names');
    }
    const seen = new Set<string>();
    cacheKeyHeaders = raw.cacheKeyHeaders.map((name: unknown, i: number) => {
      if (typeof name !== 'string' || !HEADER_TOKEN_PATTERN.test(name)) {
        throw new Error(
          `config.ssr.cacheKeyHeaders[${i}] must be an HTTP header name (RFC 7230 token), ` +
            `got ${JSON.stringify(name)}`,
        );
      }
      if (name.length > WEB_FUNCTION_CACHE_KEY_NAME_MAX_LENGTH) {
        throw new Error(
          `config.ssr.cacheKeyHeaders[${i}] is longer than CloudFront's ` +
            `${WEB_FUNCTION_CACHE_KEY_NAME_MAX_LENGTH}-character header-name limit`,
        );
      }
      const lower = name.toLowerCase();
      if (seen.has(lower)) {
        throw new Error(`config.ssr.cacheKeyHeaders lists "${name}" more than once`);
      }
      seen.add(lower);
      const denied = lower.startsWith('lambda-web-')
        ? lower
        : WEB_FUNCTION_CACHE_KEY_DENYLIST.find((entry) => entry === lower);
      if (denied !== undefined) {
        throw new Error(
          `config.ssr.cacheKeyHeaders cannot list "${name}": CloudFront owns or strips that ` +
            'header before the application sees the request',
        );
      }
      return name;
    });
    if (cacheKeyHeaders.length > WEB_FUNCTION_CACHE_KEY_MAX_COUNT) {
      throw new Error(
        `config.ssr.cacheKeyHeaders accepts at most ${WEB_FUNCTION_CACHE_KEY_MAX_COUNT} headers, ` +
          `got ${cacheKeyHeaders.length}`,
      );
    }
    if (cacheKeyHeaders.join(',').length >= WEB_FUNCTION_CACHE_KEY_MAX_LENGTH) {
      throw new Error(
        `config.ssr.cacheKeyHeaders exceeds CloudFront's ` +
          `${WEB_FUNCTION_CACHE_KEY_MAX_LENGTH}-character cache-policy quota`,
      );
    }
  }

  let env: Record<string, string> = {};
  if (raw.env !== undefined) {
    if (!isRecord(raw.env)) throw new Error('config.ssr.env must be an object of string values');
    env = {};
    for (const [key, value] of Object.entries(raw.env)) {
      if (!ENV_KEY_PATTERN.test(key)) {
        throw new Error(
          `config.ssr.env key "${key}" must match [A-Za-z][A-Za-z0-9_]* (no dashes or dots)`,
        );
      }
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`config.ssr.env.${key} must be a non-empty string`);
      }
      if (WEB_FUNCTION_RESERVED_ENV.includes(key)) {
        const hint =
          key === 'AWS_LAMBDA_NODEJS_ENTRYPOINT'
            ? ' - set config.ssr.entryPoint instead, so the two can never disagree'
            : '';
        throw new Error(`config.ssr.env.${key} is reserved by Lambda${hint}`);
      }
      env[key] = value;
    }
  }

  const shim = raw.shim === undefined ? undefined : normalizeShimConfig(raw.shim, env);
  if (shim !== undefined && entryPoint.split('/').at(-1) === SSR_SHIM_FILE) {
    throw new Error(
      `config.ssr.entryPoint cannot be named "${SSR_SHIM_FILE}" when ssr.shim is set: that is ` +
        "the generated shim's own file name - point entryPoint at the framework's server entry",
    );
  }

  const timeoutSeconds =
    raw.timeoutSeconds === undefined
      ? SSR_DEFAULT_TIMEOUT_SECONDS
      : integerInRange(raw.timeoutSeconds, 'ssr.timeoutSeconds', 3, 900);
  const maxConcurrencyPerEnvironment =
    raw.maxConcurrencyPerEnvironment === undefined
      ? SSR_DEFAULT_MAX_CONCURRENCY
      : integerInRange(
          raw.maxConcurrencyPerEnvironment,
          'ssr.maxConcurrencyPerEnvironment',
          1,
          128,
        );

  return {
    packageDir,
    entryPoint,
    ...(shim !== undefined ? { shim } : {}),
    ...(staticDir !== undefined ? { staticDir } : {}),
    staticPaths,
    cacheKeyHeaders,
    env,
    timeoutSeconds,
    maxConcurrencyPerEnvironment,
  };
}

function validateConfig(cfg: OpsConfig): void {
  if (!/^[a-z0-9-]+$/.test(cfg.siteName)) {
    throw new Error(`config.siteName must be lowercase alphanumeric/dashes, got "${cfg.siteName}"`);
  }
  if (!cfg.region) throw new Error('config.region is required');
  const memories = [0.5, 1, 2, 4, 8];
  if (!memories.includes(cfg.microvm.memory)) {
    throw new Error(`config.microvm.memory must be one of ${memories.join(', ')} GB`);
  }
  if (cfg.microvm.maxDurationSeconds < 1 || cfg.microvm.maxDurationSeconds > 28_800) {
    throw new Error('config.microvm.maxDurationSeconds must be in 1..28800');
  }
  if (
    cfg.retention.microvmDays < 1 ||
    cfg.retention.cloudfrontDays < 1 ||
    cfg.retention.webFunctionDays < 1
  ) {
    throw new Error('config retention days must be positive');
  }
  if (cfg.ssr) {
    if (cfg.spa) {
      throw new Error(
        'config.spa cannot be combined with config.ssr: a client-side-routed SPA has no ' +
          'server to render it, so the two modes are mutually exclusive',
      );
    }
    if (!WEB_FUNCTION_REGIONS.includes(cfg.region)) {
      throw new Error(
        `config.region must be one of ${WEB_FUNCTION_REGIONS.join(', ')} for a site with an ` +
          `"ssr" block (Lambda Web Functions launch regions), got "${cfg.region}"`,
      );
    }
  }
  const robotsModes: RobotsMode[] = ['auto', 'index', 'noindex', 'off'];
  if (!robotsModes.includes(cfg.seo.robots)) {
    throw new Error(`config.seo.robots must be one of ${robotsModes.join(', ')}`);
  }
  const sitemapModes = ['auto', 'on', 'off'];
  if (!sitemapModes.includes(cfg.seo.sitemap)) {
    throw new Error(`config.seo.sitemap must be one of ${sitemapModes.join(', ')}`);
  }
  for (const entry of cfg.sourceInclude) {
    if (entry.startsWith('/') || entry.split('/').includes('..')) {
      throw new Error(
        `config.sourceInclude entries must be repo-relative without "..", got "${entry}"`,
      );
    }
  }
  for (const [key, value] of [
    ['app', cfg.paths.app],
    ['dist', cfg.paths.dist],
  ] as const) {
    if (!value || value.startsWith('/') || value.split('/').includes('..')) {
      throw new Error(`config.paths.${key} must be repo-relative without "..", got "${value}"`);
    }
  }
  // No plugin-block branch here, by design: a plugin's block is that plugin's
  // own to judge. Core validates only the keys it declares, so an unknown - or
  // malformed - plugin block parses through untouched and is checked by that
  // plugin's `validateConfig`, off `parseConfigDocument`'s raw half.
}

export interface Names {
  env: string;
  bucket: string;
  prefix: string;
  buildRole: string;
  execRole: string;
  /**
   * The GitHub Actions OIDC deploy role. Derived here rather than inside the
   * CLI's own `githubOidcRoleNode` because it has two readers: that node, and
   * `blogwright-pds`, whose resource node attaches its own named inline policy
   * to the same role (`packages/pds/src/nodes.ts`). Only the role's ARN reaches
   * the site's state, so a plugin cannot recover the name from there - and a
   * second, private derivation is exactly the duplication DEVELOPMENT.md
   * §Limits and bounds bans for a derived AWS name.
   */
  githubRole: string;
  microvmImage: string;
  microvmLogGroup: string;
  cloudfrontLogGroup: string;
  oac: string;
  deliverySource: string;
  deliveryDestination: string;
  /** Lambda Web Function serving the SSR app (SSR mode only). */
  webFunction: string;
  /** Execution role the Web Function assumes. */
  webRole: string;
  /** CloudWatch log group the Web Function's centralised logs land in. */
  webLogGroup: string;
  /** In-Region companion log group the runtime writes to first. */
  webLocalLogGroup: string;
  /** Origin access control signing CloudFront's requests to the endpoint. */
  webOac: string;
  /** CloudFront cache policy for the SSR default behavior. */
  ssrCachePolicy: string;
}

/** Derive deterministic, environment-prefixed resource names. */
export function deriveNames(env: string, accountId: string, cfg: OpsConfig): Names {
  if (!/^[a-z0-9-]+$/.test(env)) {
    throw new Error(`environment must be lowercase alphanumeric/dashes, got "${env}"`);
  }
  const prefix = `${env}-${cfg.siteName}`;
  const bucket = `${prefix}-${accountId}`;
  const microvmImage = `${prefix}-builder`;
  if (bucket.length > 63) {
    throw new Error(
      `derived bucket name "${bucket}" exceeds S3's 63-char limit; shorten env or siteName`,
    );
  }
  return {
    env,
    bucket,
    prefix,
    buildRole: `${prefix}-build-role`,
    execRole: `${prefix}-exec-role`,
    githubRole: `${prefix}-gh`,
    microvmImage,
    microvmLogGroup: `/aws/lambda/microvms/${microvmImage}`,
    cloudfrontLogGroup: `/${cfg.siteName}/${env}/cloudfront`,
    oac: `${prefix}-oac`,
    deliverySource: `${prefix}-cf-source`,
    deliveryDestination: `${prefix}-cf-dest`,
    webFunction: `${prefix}-web`,
    webRole: `${prefix}-web-role`,
    webLogGroup: `/${cfg.siteName}/${env}/web`,
    webLocalLogGroup: `/${cfg.siteName}/${env}/web.local`,
    webOac: `${prefix}-web-oac`,
    ssrCachePolicy: `${prefix}-ssr`,
  };
}
