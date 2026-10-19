/*
 * `blogwright init` - the first-run wizard. Asks the four core questions a
 * new site needs, whether it is server-rendered (and with which framework,
 * which picks its `ssr` block and entry shim), then each already-discovered
 * plugin's own `init(io)`
 * questions (in deterministic, name-sorted order), and writes ONE commented
 * config/production.jsonc carrying every answered block. Runs before any
 * context exists (there is no config to load yet), so it takes its ports
 * directly. Plugin discovery itself is the composition root's job
 * (`cli.ts`), never this module's: `initSite` takes the already-discovered
 * plugins as a plain array, never a `ModuleLoader`, so this stays a domain
 * module.
 */

import {
  colors,
  findRepoRoot,
  parseConfig,
  readAwsProfiles,
  shortIdentity,
  type AwsConfig,
  type ConfigBlockEntry,
  type FileSystem,
  type Plugin,
  type PluginInitIo,
  type Terminal,
  WEB_FUNCTION_REGIONS,
} from 'blogwright-core';

import { resolveAwsProfile, resolveAwsSession, type AwsHost } from './aws-session.js';
import { renderConfigBlock, type ConfigBlockEntry as BlockEntry } from './config-block.js';
import { confirm, type Logger } from './logger.js';
import type { AwsLogin } from './ports.js';

const SITE_NAME_PATTERN = /^[a-z0-9-]+$/;
const GITHUB_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const MAX_ATTEMPTS = 3;

/**
 * One question, and how to ask it: shown text, a prefilled default, whether
 * an empty answer must re-prompt, and an optional validator. Exported - and
 * `ask` below along with it - because `plugin-commands.ts`'s `io.ask` (the
 * surface an `init?(io)` contributor asks its own questions through) reuses
 * this exact prompt/validate/retry loop rather than writing a second one; no
 * plugin path may reach `node:readline` itself. Structurally the same shape
 * as core's `PluginQuestion` (`blogwright-core`'s `plugin.ts`), so a
 * contributor's question passes straight through with no conversion.
 */
export interface Question {
  prompt: string;
  defaultValue?: string | undefined;
  required?: boolean | undefined;
  validate?: ((answer: string) => string | undefined) | undefined;
}

/**
 * Ask `q.prompt` over `terminal`, retrying up to `MAX_ATTEMPTS` times on a
 * required-but-empty answer or a `validate` failure, and resolving with
 * `undefined` for an unanswered optional question. Throws once every attempt
 * is spent. The one prompt/validate/retry loop every wizard-shaped question -
 * `blogwright init`'s own four and any plugin's `init?(io)` contributor -
 * asks through.
 */
export async function ask(
  terminal: Terminal,
  logger: Logger,
  q: Question,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const suffix = q.defaultValue ? ` [${q.defaultValue}]` : '';
    const answer = (await terminal.question(`${q.prompt}${suffix}: `)).trim() || q.defaultValue;
    if (!answer) {
      if (!q.required) return undefined;
      logger.warn('a value is required');
      continue;
    }
    const problem = q.validate?.(answer);
    if (problem) {
      logger.warn(problem);
      continue;
    }
    return answer;
  }
  throw new Error(`no valid answer after ${MAX_ATTEMPTS} attempts - giving up`);
}

/**
 * Build the `io` an `init?(io)` contributor asks its own questions through,
 * entirely over the `ask` loop above - never a second prompt/validate/retry
 * loop. Mirrors `plugin-commands.ts`'s own `buildInitIo` (the other path
 * that reaches a plugin's contributor, `blogwright <plugin> init`) rather
 * than importing it: that module already imports `ask` from here, so the
 * reverse import would be a cycle between the two (see `known-commands.ts`'s
 * module comment for what that class of cycle already broke once in this
 * package). `ask` resolves `undefined` for an unanswered optional question;
 * `PluginInitIo.ask` promises a `string` always, per the no-null rule, so
 * the empty string stands in for "declined" here too.
 */
function buildInitIo(terminal: Terminal, logger: Logger): PluginInitIo {
  return {
    isInteractive: terminal.isInteractive,
    logger,
    ask: async (question) => (await ask(terminal, logger, question)) ?? '',
  };
}

/**
 * Ask one plugin's `init(io)` contributor its questions and render what it
 * returns as a `"key": { ... }` block in `renderConfigBlock`'s style, or
 * `undefined` when the operator answered nothing (an empty array). A
 * contributor with no `configKey` to file its answers under is a
 * plugin-authoring bug, not an operator refusal - raised naming the plugin,
 * the same check `plugin-commands.ts`'s `runGenericInit` makes for the other
 * path that reaches a contributor, so both refuse identically.
 *
 * This DOES abort the whole wizard - a misconfigured plugin among several
 * stops every other plugin's block (and the core entries) from being
 * written at all, unlike a candidate-level `plugins.ts` discovery failure,
 * which is collected and never blocks an unrelated command. The
 * inconsistency is deliberate, not overlooked: this is a plugin-authoring
 * bug the operator cannot fix by re-running (unlike a transient discovery
 * failure), `runGenericInit` - the sibling path - has no "continue past it"
 * option either, since it operates on exactly one plugin, and this task's
 * own contract is for the two paths to reach a contributor identically.
 * Diverging here would need `plugin-commands.ts` to diverge too, which is
 * outside this module's ownership.
 */
async function askPluginBlock(
  plugin: Plugin,
  contributor: (io: PluginInitIo) => Promise<ConfigBlockEntry[]>,
  io: PluginInitIo,
): Promise<string | undefined> {
  const configKey = plugin.configKey;
  if (!configKey) {
    throw new Error(
      `plugin "${plugin.name}" declares an init(io) contributor but no configKey - there is ` +
        'nothing to file its answered block under',
    );
  }
  const entries = await contributor(io);
  if (entries.length === 0) return undefined;
  return renderConfigBlock(
    configKey,
    entries.map((entry) => ({ prop: entry.property, comment: entry.comment })),
  );
}

/**
 * Ask every plugin in `plugins` that declares an `init(io)` contributor, in
 * deterministic order - sorted by `name`, never discovery or argument order
 * - and return each answered block. A plugin declining (an empty array) or
 * carrying no contributor at all contributes nothing: never a stray entry,
 * never a stray comma once `renderConfig` composes the result.
 */
async function collectPluginBlocks(
  plugins: readonly Plugin[],
  terminal: Terminal,
  logger: Logger,
): Promise<string[]> {
  const io = buildInitIo(terminal, logger);
  const sorted = [...plugins].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const blocks: string[] = [];
  for (const plugin of sorted) {
    const contributor = plugin.init;
    if (!contributor) continue;
    const block = await askPluginBlock(plugin, contributor, io);
    if (block) blocks.push(block);
  }
  return blocks;
}

/** A server-rendering framework `init` can configure, and the `ssr` block it writes for it. */
interface SsrFramework {
  /** Name shown in the next steps. */
  label: string;
  /** Anchor in the Server-rendered sites guide covering the build settings it needs. */
  anchor: string;
  entries: BlockEntry[];
}

const SSR_GUIDE_URL = 'https://blogwright.iamstan.dev/guides/server-rendered-sites/';

/**
 * The `ssr` block per framework, matching the guide's recipes: where the build
 * puts the server, the variables that server reads its listen address from
 * (so Blogwright generates the entry shim), and the browser assets kept on S3.
 * `other` writes the defaults for the operator to fill in.
 */
const SSR_FRAMEWORKS: Readonly<Record<string, SsrFramework>> = {
  astro: {
    label: 'Astro (@astrojs/node standalone)',
    anchor: 'astro-node-standalone',
    entries: [
      { prop: '"packageDir": "dist"', comment: 'all of dist/: the adapter looks for server/' },
      { prop: '"entryPoint": "server/entry.mjs"' },
      {
        prop: '"shim": { "host": "HOST", "port": "PORT" }',
        comment: 'generated entry shim: the server reads HOST and PORT',
      },
      { prop: '"staticDir": "dist/client"' },
      { prop: '"staticPaths": ["/_astro/*", "/favicon.svg", "/robots.txt"]' },
    ],
  },
  sveltekit: {
    label: 'SvelteKit (adapter-node)',
    anchor: 'sveltekit-adapter-node',
    entries: [
      { prop: '"packageDir": "build"' },
      { prop: '"entryPoint": "index.js"' },
      {
        prop: '"shim": { "host": "HOST", "port": "PORT" }',
        comment: 'generated entry shim: the server reads HOST and PORT',
      },
      { prop: '"staticDir": "build/client"' },
      { prop: '"staticPaths": ["/_app/*", "/favicon.png"]' },
    ],
  },
  nuxt: {
    label: 'Nuxt (Nitro node-server)',
    anchor: 'nuxt-nitro-node-server-preset',
    entries: [
      { prop: '"packageDir": ".output/server"' },
      { prop: '"entryPoint": "index.mjs"' },
      {
        prop: '"shim": { "host": "NITRO_HOST", "port": "NITRO_PORT" }',
        comment: 'generated entry shim: Nitro reads NITRO_HOST and NITRO_PORT',
      },
      { prop: '"staticDir": ".output/public"' },
      { prop: '"staticPaths": ["/_nuxt/*", "/favicon.ico"]' },
    ],
  },
  'tanstack-start': {
    label: 'TanStack Start (Nitro node-server)',
    anchor: 'tanstack-start-nitro',
    entries: [
      { prop: '"packageDir": ".output/server"' },
      { prop: '"entryPoint": "index.mjs"' },
      {
        prop: '"shim": { "host": "NITRO_HOST", "port": "NITRO_PORT" }',
        comment: 'generated entry shim: Nitro reads NITRO_HOST and NITRO_PORT',
      },
      { prop: '"staticDir": ".output/public"' },
      { prop: '"staticPaths": ["/assets/*", "/favicon.svg"]' },
    ],
  },
  nextjs: {
    label: 'Next.js (standalone output)',
    anchor: 'nextjs-standalone-output',
    entries: [
      { prop: '"packageDir": ".next/standalone"', comment: 'Next serves its own static assets' },
      { prop: '"entryPoint": "server.js"' },
      {
        prop: '"shim": { "host": "HOSTNAME", "port": "PORT" }',
        comment: 'generated entry shim: the server reads HOSTNAME and PORT',
      },
    ],
  },
  other: {
    label: 'your framework',
    anchor: 'the-entry-shim',
    entries: [
      { prop: '"packageDir": "dist"', comment: 'the built server output, repo-relative' },
      {
        prop: '"entryPoint": "index.js"',
        comment: 'starts the server; add "shim" unless it listens on AWS_LAMBDA_HTTP_ENDPOINT',
      },
    ],
  },
};

/**
 * Ask whether the site is server-rendered and, if so, which framework, and
 * return that framework's recipe; `undefined` for a static site.
 */
async function askSsrFramework(
  terminal: Terminal,
  logger: Logger,
): Promise<SsrFramework | undefined> {
  const wanted = await ask(terminal, logger, {
    prompt: 'server-rendered (SSR) app on a Lambda Web Function? (y/n)',
    defaultValue: 'n',
    validate: (v) => (/^(y|yes|n|no)$/i.test(v) ? undefined : 'answer y or n'),
  });
  if (!/^y/i.test(wanted ?? '')) return undefined;
  const names = Object.keys(SSR_FRAMEWORKS);
  const choice = await ask(terminal, logger, {
    prompt: `framework (${names.join(', ')})`,
    required: true,
    validate: (v) =>
      Object.hasOwn(SSR_FRAMEWORKS, v.toLowerCase()) ? undefined : `expected ${names.join(', ')}`,
  });
  return SSR_FRAMEWORKS[choice!.toLowerCase()];
}

/** What `init`'s AWS questions need from the composition root. */
export interface InitAwsOptions {
  /** `--profile`, the first default for the profile question. */
  profile?: string | undefined;
  host: AwsHost;
  awsLogin: AwsLogin;
}

/** Where the wizard writes, relative to the repo root - also how AWS messages name it. */
const INIT_CONFIG_FILE = 'config/production.jsonc';

/** The answer that chooses default credentials when the profile question has a default. */
const NO_PROFILE_ANSWER = 'none';

/** The profile `--profile`, then `AWS_PROFILE`, suggests - with which of the two it came from. */
function suggestedProfile(aws: InitAwsOptions): { name: string; source: string } | undefined {
  const flag = aws.profile?.trim();
  if (flag) return { name: flag, source: '--profile' };
  const env = aws.host.processEnv.AWS_PROFILE?.trim();
  return env ? { name: env, source: 'AWS_PROFILE' } : undefined;
}

/**
 * Ask which named profile this environment uses - only when the shared AWS
 * files define at least one. Defaults to `--profile`, then `AWS_PROFILE`,
 * but only when the files define it: a stale suggestion is dropped with a
 * warning rather than offered as an answer that can never validate. Blank
 * means default credentials when there is no default; with a default, blank
 * takes it and `none` chooses default credentials. A nonblank answer must be
 * a listed profile. Undefined means default credentials.
 */
async function askAwsProfile(
  fs: FileSystem,
  terminal: Terminal,
  logger: Logger,
  aws: InitAwsOptions,
): Promise<string | undefined> {
  const profiles = await readAwsProfiles(fs, aws.host.processEnv, aws.host.home);
  if (profiles.names.length === 0) return undefined;
  const suggested = suggestedProfile(aws);
  if (suggested && !profiles.has(suggested.name)) {
    logger.warn(
      `profile "${suggested.name}" from ${suggested.source} is not in your AWS config files - ` +
        'not offering it as the default',
    );
  }
  const defaultValue = suggested && profiles.has(suggested.name) ? suggested.name : undefined;
  const choice = defaultValue
    ? `"${NO_PROFILE_ANSWER}" for default credentials`
    : 'blank for default credentials';
  const answer = await ask(terminal, logger, {
    prompt: `AWS profile for this environment (${choice})`,
    defaultValue,
    validate: (v) =>
      profiles.has(v) || v === NO_PROFILE_ANSWER
        ? undefined
        : `no profile "${v}" - expected one of ${profiles.names.join(', ')}, or "${NO_PROFILE_ANSWER}"`,
  });
  return answer === NO_PROFILE_ANSWER && !profiles.has(answer) ? undefined : answer;
}

/**
 * Warn when this shell would override what the config is about to say: the
 * pin is detected for the config's credentials, so a command run here under
 * a different `AWS_PROFILE` or exported credentials could be refused.
 */
function warnShellOverride(
  logger: Logger,
  processEnv: NodeJS.ProcessEnv,
  profile: string | undefined,
): void {
  const shell = resolveAwsProfile({ processEnv, config: { profile } });
  const advice = 'unset it before running blogwright in this shell';
  if (shell.source === 'env' && shell.name !== profile) {
    const saved = profile === undefined ? 'is not saved to the config' : 'overrides aws.profile';
    logger.warn(`AWS_PROFILE=${shell.name} is set in this shell and ${saved} - ${advice}`);
  } else if (shell.source === 'env-keys' && profile !== undefined) {
    logger.warn('AWS credentials exported in this shell override aws.profile - unset them first');
  }
}

/** The environment without `AWS_PROFILE`, so detection sees what a config with no profile uses. */
function withoutAwsProfile(processEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { AWS_PROFILE: _ignored, ...rest } = processEnv;
  return rest;
}

/**
 * Offer to detect the account the chosen credentials belong to and pin it.
 * The credentials are the ones the written config selects: the chosen
 * profile, or - with none - exported credentials or the default chain, never
 * this shell's `AWS_PROFILE`, which the config does not record. A shell that
 * would override the config is warned about. Runs the same session
 * resolution every command does - login offer included - against real AWS,
 * so the pin is a real account. With `AWS_ENDPOINT_URL`
 * exported it is not offered at all: the SDK's own SSO and STS clients that
 * resolve a profile read that variable too, so detection would ask the
 * emulator. An AWS failure never fails `init`: every error the session
 * raises is an AWS or sign-in failure, so it warns and leaves the account
 * unpinned.
 */
async function askAccountPin(
  fs: FileSystem,
  terminal: Terminal,
  logger: Logger,
  opts: { region: string; profile: string | undefined; aws: InitAwsOptions },
): Promise<string | undefined> {
  if (opts.aws.host.processEnv.AWS_ENDPOINT_URL?.trim()) {
    logger.warn('AWS_ENDPOINT_URL is set, so the AWS account cannot be detected');
    logger.warn(ACCOUNT_NOT_PINNED);
    return undefined;
  }
  if (!(await confirm(terminal, 'Detect the AWS account and pin it to this config?'))) {
    return undefined;
  }
  const { host } = opts.aws;
  warnShellOverride(logger, host.processEnv, opts.profile);
  try {
    const session = await resolveAwsSession({
      region: opts.region,
      endpointOverride: undefined,
      flag: opts.profile,
      configLabel: INIT_CONFIG_FILE,
      host:
        opts.profile === undefined
          ? { ...host, processEnv: withoutAwsProfile(host.processEnv) }
          : host,
      ports: { fs, terminal, awsLogin: opts.aws.awsLogin },
      logger,
    });
    const { account, arn } = session.identity;
    logger.ok(`AWS account ${account} (${shortIdentity(arn)}) - pinned as aws.accountId`);
    return account;
  } catch (err) {
    logger.warn(err instanceof Error ? err.message : String(err));
    logger.warn(ACCOUNT_NOT_PINNED);
    return undefined;
  }
}

const ACCOUNT_NOT_PINNED = 'account not pinned - add aws.accountId later';

/**
 * The `aws` block, or undefined when there is nothing to write. Rendered in
 * `renderConfigBlock`'s style; the pin carries its own explanatory comment.
 */
function renderAwsBlock(aws: AwsConfig): string | undefined {
  const entries: BlockEntry[] = [];
  if (aws.profile) entries.push({ prop: `"profile": ${JSON.stringify(aws.profile)}` });
  if (aws.accountId) {
    entries.push({
      prop: `"accountId": "${aws.accountId}"`,
      comment: 'deploys refuse credentials for any other account',
    });
  }
  return entries.length > 0 ? renderConfigBlock('aws', entries) : undefined;
}

/** One core `"key": value` entry, or a plugin's pre-rendered `"key": { ... }` block, at the top level. */
type TopLevelItem = { prop: string; comment?: string } | { block: string };

/** Render one top-level item with its own trailing comma, or none when it is last. */
function renderTopLevelItem(item: TopLevelItem, last: boolean): string {
  const comma = last ? '' : ',';
  if ('block' in item) return `${item.block}${comma}`;
  return `  ${item.prop}${comma}${item.comment ? ` // ${item.comment}` : ''}`;
}

/**
 * Render the whole `config/production.jsonc` body: the core entries in
 * their fixed, commented style, then the `ssr` block when the site is
 * server-rendered, followed by every plugin block already
 * rendered by `collectPluginBlocks` - each its own top-level property, comma
 * discipline shared with the core entries via `renderTopLevelItem` so no
 * block ever leaves (or follows) a stray comma. With no `ssr` and
 * `pluginBlocks` empty this reproduces exactly the entries-only output this
 * wizard has always written - byte for byte, pinned by `init.test.ts`.
 */
function renderConfig(opts: {
  region: string;
  siteName: string;
  domain?: string | undefined;
  githubRepo?: string | undefined;
  ssr?: SsrFramework | undefined;
  aws?: AwsConfig | undefined;
  pluginBlocks: readonly string[];
}): string {
  const items: TopLevelItem[] = [
    { prop: `"region": "${opts.region}"` },
    {
      prop: `"siteName": "${opts.siteName}"`,
      comment: 'stable slug in every AWS resource name - never change it',
    },
  ];
  if (opts.domain) items.push({ prop: `"domain": "${opts.domain}"` });
  if (opts.githubRepo) {
    items.push({
      prop: `"githubRepo": "${opts.githubRepo}"`,
      comment: 'enables the GitHub OIDC deploy role',
    });
  }
  if (opts.ssr) items.push({ block: renderConfigBlock('ssr', opts.ssr.entries) });
  const awsBlock = opts.aws ? renderAwsBlock(opts.aws) : undefined;
  if (awsBlock) items.push({ block: awsBlock });
  for (const block of opts.pluginBlocks) items.push({ block });

  const body = items.map((item, i) => renderTopLevelItem(item, i === items.length - 1));
  return ['// config/production.jsonc - created by `blogwright init`', '{', ...body, '}', ''].join(
    '\n',
  );
}

/**
 * Run the wizard. Returns a process exit code; never throws for expected
 * refusals (non-interactive, an existing config file). `plugins` is every
 * plugin the caller has ALREADY discovered (`cli.ts`, over
 * `DiscoveryPortsFactory`) - this function asks their questions and writes
 * their blocks but never runs discovery itself. A plugin's `init(io)`
 * contributor throwing propagates unchanged, rejecting this call before the
 * single `fs.writeText` below ever runs, so the config file stays exactly
 * what it was - absent, on this path - rather than a partial write.
 */
export async function initSite(
  fs: FileSystem,
  terminal: Terminal,
  logger: Logger,
  plugins: readonly Plugin[],
  options: { aws: InitAwsOptions; root?: string | undefined },
): Promise<number> {
  if (!terminal.isInteractive) {
    logger.error(
      'init is an interactive wizard; in CI or plain mode create config/production.jsonc ' +
        'by hand instead (see README - only "region" and "siteName" are required)',
    );
    return 1;
  }
  const repoRoot = options.root ?? (await findRepoRoot(fs).catch(() => process.cwd()));
  const configPath = `${repoRoot}/${INIT_CONFIG_FILE}`;
  if (await fs.exists(configPath)) {
    logger.error(`${configPath} already exists - edit it directly, or pass --config elsewhere`);
    return 1;
  }

  logger.info(colors.bold('Welcome to blogwright - a few questions and you are live.'));
  const siteName = await ask(terminal, logger, {
    prompt: 'site name (lowercase slug, names every AWS resource)',
    required: true,
    validate: (v) =>
      SITE_NAME_PATTERN.test(v) ? undefined : 'must be lowercase letters, digits, or dashes',
  });
  let region = await ask(terminal, logger, {
    prompt: 'AWS region',
    defaultValue: 'us-east-1',
    required: true,
  });
  const domain = await ask(terminal, logger, {
    prompt: 'custom domain (blank to use the CloudFront domain)',
  });
  const githubRepo = await ask(terminal, logger, {
    prompt: 'GitHub repo for CI deploys, owner/repo (blank to skip)',
    validate: (v) => (GITHUB_REPO_PATTERN.test(v) ? undefined : 'expected owner/repo'),
  });
  const ssr = await askSsrFramework(terminal, logger);
  if (ssr && !WEB_FUNCTION_REGIONS.includes(region!)) {
    const regions = WEB_FUNCTION_REGIONS.join(', ');
    logger.warn(`server-rendered sites run on Lambda Web Functions, available in ${regions}`);
    region = await ask(terminal, logger, {
      prompt: 'AWS region',
      defaultValue: 'us-east-1',
      required: true,
      validate: (v) => (WEB_FUNCTION_REGIONS.includes(v) ? undefined : `expected ${regions}`),
    });
  }
  const profile = await askAwsProfile(fs, terminal, logger, options.aws);
  const accountId = await askAccountPin(fs, terminal, logger, {
    region: region!,
    profile,
    aws: options.aws,
  });
  const pluginBlocks = await collectPluginBlocks(plugins, terminal, logger);

  const rendered = renderConfig({
    region: region!,
    siteName: siteName!,
    domain,
    githubRepo,
    ssr,
    aws: { profile, accountId },
    pluginBlocks,
  });
  // Re-parsed before it is trusted onto disk, mirroring `plugin-commands.ts`'s
  // `runGenericInit` (the sibling path composing a plugin's block into an
  // existing file): a bug in this composition must never reach the operator
  // as an unloadable config file, which is the one thing this whole feature
  // promises never to do.
  parseConfig(rendered);
  await fs.writeText(configPath, rendered);
  logger.ok(`wrote ${configPath}`);
  logger.info('');
  logger.info(colors.bold('Next steps:'));
  if (ssr) logger.step(`set up the build for ${ssr.label}: ${SSR_GUIDE_URL}#${ssr.anchor}`);
  logger.step(`blogwright bootstrap${domain ? '' : '   # add --domain later if you get one'}`);
  logger.step('blogwright deploy');
  logger.info(colors.dim('   (bootstrap prints ACM validation CNAMEs when a domain is set)'));
  return 0;
}
