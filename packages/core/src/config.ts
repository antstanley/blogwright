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

/** AT Protocol / standard.site publishing (see `blogwright pds`). Inert when absent. */
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
  /** Secrets Manager secret holding the OAuth client key + session. */
  secretName: string;
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
  };
  /** Extra path prefixes excluded from the source zip (on top of .gitignore). */
  sourceIgnore: string[];
  /**
   * Paths zipped into the deploy source even when gitignored — for artifacts a
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

/** Parse + validate a JSONC config document, merged over defaults. */
export function parseConfig(text: string): OpsConfig {
  const raw = JSON.parse(stripTrailingCommas(stripJsonComments(text))) as Partial<OpsConfig>;
  return mergeConfig(raw);
}

export function mergeConfig(raw: Partial<OpsConfig>): OpsConfig {
  if (!raw.siteName) {
    throw new Error(
      'config.siteName is required — a stable lowercase slug used in every derived AWS resource name',
    );
  }
  const cfg: OpsConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    siteName: raw.siteName,
    microvm: {
      ...DEFAULT_CONFIG.microvm,
      ...raw.microvm,
      idle: { ...DEFAULT_CONFIG.microvm.idle, ...raw.microvm?.idle },
    },
    retention: { ...DEFAULT_CONFIG.retention, ...raw.retention },
    seo: { ...DEFAULT_CONFIG.seo, ...raw.seo },
    paths: { ...DEFAULT_CONFIG.paths, ...raw.paths },
  };
  if (raw.pds) {
    cfg.pds = {
      ...raw.pds,
      secretName: raw.pds.secretName ?? `${cfg.siteName}/atproto`,
    };
  }
  validateConfig(cfg);
  return cfg;
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
  if (cfg.retention.microvmDays < 1 || cfg.retention.cloudfrontDays < 1) {
    throw new Error('config retention days must be positive');
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
  if (cfg.pds) {
    if (!cfg.pds.name?.trim()) throw new Error('config.pds.name is required');
    if (cfg.pds.handleResolver !== undefined) {
      let resolver: URL;
      try {
        resolver = new URL(cfg.pds.handleResolver);
      } catch {
        throw new Error(`config.pds.handleResolver must be a URL, got "${cfg.pds.handleResolver}"`);
      }
      if (resolver.protocol !== 'https:') {
        throw new Error(`config.pds.handleResolver must be https, got "${cfg.pds.handleResolver}"`);
      }
    }
    if (!/^[\w/+=.@-]+$/.test(cfg.pds.secretName)) {
      throw new Error(`config.pds.secretName has invalid characters: "${cfg.pds.secretName}"`);
    }
  }
}

export interface Names {
  env: string;
  bucket: string;
  prefix: string;
  buildRole: string;
  execRole: string;
  microvmImage: string;
  microvmLogGroup: string;
  cloudfrontLogGroup: string;
  oac: string;
  deliverySource: string;
  deliveryDestination: string;
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
    microvmImage,
    microvmLogGroup: `/aws/lambda/microvms/${microvmImage}`,
    cloudfrontLogGroup: `/${cfg.siteName}/${env}/cloudfront`,
    oac: `${prefix}-oac`,
    deliverySource: `${prefix}-cf-source`,
    deliveryDestination: `${prefix}-cf-dest`,
  };
}
