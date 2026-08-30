/*
 * `blogwright init` - the first-run wizard. Asks the four core questions a
 * new site needs, then each already-discovered plugin's own `init(io)`
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
  type ConfigBlockEntry,
  type FileSystem,
  type Plugin,
  type PluginInitIo,
  type Terminal,
} from 'blogwright-core';

import { renderConfigBlock } from './config-block.js';
import type { Logger } from './logger.js';

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

/** One core `"key": value` entry, or a plugin's pre-rendered `"key": { ... }` block, at the top level. */
type TopLevelItem = { prop: string; comment?: string } | { block: string };

/** Render one top-level item with its own trailing comma, or none when it is last. */
function renderTopLevelItem(item: TopLevelItem, last: boolean): string {
  const comma = last ? '' : ',';
  if ('block' in item) return `${item.block}${comma}`;
  return `  ${item.prop}${comma}${item.comment ? ` // ${item.comment}` : ''}`;
}

/**
 * Render the whole `config/production.jsonc` body: the four core entries in
 * their fixed, commented style, followed by every plugin block already
 * rendered by `collectPluginBlocks` - each its own top-level property, comma
 * discipline shared with the core entries via `renderTopLevelItem` so no
 * block ever leaves (or follows) a stray comma. `pluginBlocks` empty
 * reproduces exactly the entries-only output this wizard has always
 * written - byte for byte, pinned by `init.test.ts`.
 */
function renderConfig(opts: {
  region: string;
  siteName: string;
  domain?: string | undefined;
  githubRepo?: string | undefined;
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
  root?: string,
): Promise<number> {
  if (!terminal.isInteractive) {
    logger.error(
      'init is an interactive wizard; in CI or plain mode create config/production.jsonc ' +
        'by hand instead (see README - only "region" and "siteName" are required)',
    );
    return 1;
  }
  const repoRoot = root ?? (await findRepoRoot(fs).catch(() => process.cwd()));
  const configPath = `${repoRoot}/config/production.jsonc`;
  if (await fs.exists(configPath)) {
    logger.error(`${configPath} already exists - edit it directly, or pass --config elsewhere`);
    return 1;
  }

  logger.info(colors.bold('Welcome to blogwright - four questions and you are live.'));
  const siteName = await ask(terminal, logger, {
    prompt: 'site name (lowercase slug, names every AWS resource)',
    required: true,
    validate: (v) =>
      SITE_NAME_PATTERN.test(v) ? undefined : 'must be lowercase letters, digits, or dashes',
  });
  const region = await ask(terminal, logger, {
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
  const pluginBlocks = await collectPluginBlocks(plugins, terminal, logger);

  const rendered = renderConfig({
    region: region!,
    siteName: siteName!,
    domain,
    githubRepo,
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
  logger.step(`blogwright bootstrap${domain ? '' : '   # add --domain later if you get one'}`);
  logger.step('blogwright deploy');
  logger.info(colors.dim('   (bootstrap prints ACM validation CNAMEs when a domain is set)'));
  return 0;
}
