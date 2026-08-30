import { parseArgs } from 'node:util';

import {
  FileNotFoundError,
  findRepoRoot,
  type Plugin,
  RepoRootNotFoundError,
  type Terminal,
} from 'blogwright-core';
import * as pds from 'blogwright-pds';

import * as commands from './commands.js';
import { cliPackageDir, type ContextOptions, type OpsContext } from './context.js';
import { initSite } from './init.js';
import { KNOWN_COMMANDS } from './known-commands.js';
import { createLogger, type Logger } from './logger.js';
import { runPlugin } from './plugin-commands.js';
import { discover, type DiscoveryResult } from './plugins.js';
import type { Ports } from './ports.js';

const USAGE = `blogwright - full operations for a blog site on AWS (S3 + CloudFront, MicroVM builds)

Usage:
  blogwright <command> [env] [options]

Commands:
  init                        First-run wizard: writes config/production.jsonc
  bootstrap   [env]           Create/reconcile the infrastructure graph
  deploy      [env]           Zip the repo, build in a MicroVM, publish to site/
  rollback    <hash> [env]    Re-deploy an existing build by hash
  delete      [env]           Empty the live site/ prefix
  destroy     [env] --yes     Tear down all infrastructure
  history     [env]           List deployment history
  logs        <hash> [env]    Show CloudWatch build logs for a hash
  status      [env]           Show planned graph vs. live state

  preview bootstrap           Provision the shared preview stack
  preview deploy <id>         Build + publish a PR preview (id like pr-42)
  preview destroy <id>        Remove one PR preview
  preview list                List active previews
  preview teardown --yes      Tear down the whole preview stack

  pds keygen                  Generate the OAuth client key: private JWK into
                              Secrets Manager, public documents into public/oauth/
                              (commit + release those before pds login)
  pds login --identifier <handle-or-did>
                              Interactive OAuth bootstrap: prints an authorize URL,
                              then expects the pasted /oauth/callback redirect URL;
                              the session is stored in Secrets Manager and refreshed
                              automatically on every sync
  pds secret status           Show secret metadata (never the value)
  pds secret delete --yes     Delete the secret (logs out and discards the key)
  pds init                    Create/update the standard.site publication record and
                              write the site verification files (commit them)
  pds sync                    Reconcile site.standard.document records with the
                              content collection (production only; also runs after
                              every successful production deploy)

Options:
  --env <name>      Environment (default: production; also accepted positionally)
  --domain <fqdn>   Custom domain (ACM cert + CloudFront alias)
  --config <path>   Path to a JSONC config file
  --endpoint <url>  AWS endpoint override (e.g. http://localhost:4566 for floci)
  --id <preview>    Preview id for preview deploy/destroy (also accepted positionally)
  --plain           Minimal machine-friendly output (no colour, no live status,
                    no prompts) - for CI systems and agents; also automatic when
                    output is piped. NO_COLOR disables colour only.
  --refresh         Re-upload every file on deploy, even unchanged ones, so
                    metadata fixes (content types, object tags) reach live
                    objects the ETag comparison would otherwise skip.
  --yes             Confirm destructive operations
  --help            Show this help
`;

/** One entry of a {@link DiscoveryResult}'s `failures` collection. */
type PluginFailure = DiscoveryResult['failures'][number];

/**
 * Render one discovered plugin's help section: its `description` as a
 * header, then one line per command built from that command's `action` and
 * `summary` (§CLI → Plugin dispatch: "`blogwright --help` appends one
 * section per discovered plugin, built from its `description` and its
 * commands' `summary` fields").
 */
function renderPluginSection(plugin: Plugin): string {
  const commandLines = plugin.commands.map(
    (command) => `    ${command.action} - ${command.summary}`,
  );
  return [`  ${plugin.name} - ${plugin.description}`, ...commandLines].join('\n');
}

/**
 * Render one plugin that failed to load: the package it came from and why,
 * with no stack trace, so one broken plugin's `Error` never leaks its
 * `.stack` into `--help` output.
 */
function renderPluginFailure(failure: PluginFailure): string {
  return `  ${failure.packageName}: ${failure.reason}`;
}

/**
 * Build the full help text from the static `USAGE` base plus one section
 * per discovered plugin, and one line per plugin that failed to load.
 * Returns `base` completely UNCHANGED - not even a trailing blank line
 * added - when `discovered` carries neither a plugin nor a failure, so a
 * repo with no plugins installed sees byte-identical output to today's
 * constant (the pin `cli.test.ts` inherits from task 07).
 *
 * Plugin sections are ordered by `Plugin.name`, never by `discovered`'s own
 * array order: `discover`'s candidate set is built from two
 * `dependencies`/`devDependencies` maps (`plugins.ts`'s `collectCandidates`),
 * and object-key iteration order is an implementation detail of those
 * manifests, not something `--help` output should vary with.
 */
function buildHelp(base: string, discovered: DiscoveryResult): string {
  if (discovered.plugins.length === 0 && discovered.failures.length === 0) return base;

  const blocks: string[] = [];
  if (discovered.plugins.length > 0) {
    // Plain string comparison, not `localeCompare` (which would construct an
    // `Intl.Collator` on every call): plugin names are constrained to
    // `PLUGIN_NAME_PATTERN` (lowercase ASCII alphanumerics and dashes), so
    // code-unit ordering already sorts them the same way.
    const byName = [...discovered.plugins].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    blocks.push(['Plugins:', ...byName.map(renderPluginSection)].join('\n\n'));
  }
  if (discovered.failures.length > 0) {
    blocks.push(
      ['Plugins that failed to load:', ...discovered.failures.map(renderPluginFailure)].join('\n'),
    );
  }
  return `${base}\n${blocks.join('\n\n')}\n`;
}

/**
 * True for the exact failure {@link findRepoRoot} (`blogwright-core`)
 * raises when no `.git`/`.jj` is found above the start directory - the
 * ONLY error that function throws (see `repo-root.ts`). Matched by message
 * prefix, not merely `instanceof Error`, so a genuinely unexpected error
 * from a future change to that function still propagates instead of being
 * swallowed here.
 */
function isNoRepoRootError(err: unknown): boolean {
  return err instanceof RepoRootNotFoundError;
}

/**
 * True for the one discovery precondition `discover` (`plugins.ts`) throws
 * for that `helpText` chooses to tolerate: the repo's own (or the CLI's
 * own) `package.json` missing entirely -
 * `readDependencyManifest`'s `FileNotFoundError`-caused branch, the only
 * one of its three throw shapes wrapping that error as `cause`. An
 * unparseable or non-object `package.json` is deliberately NOT matched
 * here: unlike a missing file - the ordinary state of a checkout before
 * its first `npm init` - a malformed one is an actual defect in the repo
 * worth surfacing as an error, not a "nothing set up yet" state `--help`
 * should paper over.
 */
function isMissingPackageJsonError(err: unknown): boolean {
  return err instanceof Error && err.cause instanceof FileNotFoundError;
}

/**
 * Discover installed plugins and build the help text every USAGE print site
 * in this module now shows - the base `USAGE` constant unchanged when
 * nothing is discovered, plus a section per plugin and failure otherwise.
 *
 * Called fresh on every invocation, never memoised across print sites: each
 * of the five call sites below (`main`'s own `--help`/bare-invocation
 * branch and unknown-command default, `runPds`'s unknown-action branch, and
 * `runPreview`'s two) reaches this only on the specific path it is on, so a
 * command that never prints help - `deploy`, `bootstrap`, `status` among
 * them - never calls `discover` and never touches `ports.loader` at all.
 * `blogwright plugin list` (task 17) and `blogwright init` (task 14) are
 * the other two paths that pay for discovery; every other built-in command
 * does not. See `DiscoveryPortsFactory`'s doc comment for why the ports
 * themselves come from the caller rather than being built here.
 *
 * `findRepoRoot` and `discover` are documented to throw ONLY for their own
 * repo-level preconditions - `plugins.ts`'s own module comment names those
 * two (an unreadable repo root `package.json` or CLI `package.json`) as the
 * things it deliberately throws for, in contrast to every candidate-level
 * problem, which becomes a `failures` entry instead. `--help` running
 * outside any repo, or inside one with no root `package.json` yet, is
 * exactly the "nothing set up" state a first-time run looks like - so
 * BOTH calls are individually guarded to fall back to plain `USAGE` for
 * their own documented precondition failure, one precondition earlier than
 * `buildHelp` already does the same for a single broken plugin. Anything
 * else - a malformed `package.json`, or any error `findRepoRoot`/`discover`
 * are not documented to throw - still propagates to `bin.ts`'s error path,
 * exactly as it would have before this function existed.
 */
async function helpText(ports: Pick<Ports, 'fs' | 'loader'>): Promise<string> {
  let repoRoot: string;
  try {
    repoRoot = await findRepoRoot(ports.fs);
  } catch (err) {
    if (isNoRepoRootError(err)) return USAGE;
    throw err;
  }
  let discovered: DiscoveryResult;
  try {
    discovered = await discover(repoRoot, cliPackageDir(), ports);
  } catch (err) {
    if (isMissingPackageJsonError(err)) return USAGE;
    throw err;
  }
  return buildHelp(USAGE, discovered);
}

const HASH_COMMANDS = new Set(['rollback', 'logs']);

/** Builds the Terminal after flag parsing, so --plain shapes the whole session. */
export type TerminalFactory = (opts: { plain: boolean }) => Terminal;

/**
 * Builds the OpsContext for a dispatched command. `bin.ts` defaults this to
 * `createContext` (the real, AWS- and disk-reaching composition root); tests
 * supply `createTestContext` instead so dispatch can be asserted without a
 * module mock or an env-var override.
 */
export type ContextFactory = (opts: ContextOptions) => Promise<OpsContext>;

/**
 * Builds the `fs`/`loader` ports plugin dispatch needs for discovery -
 * BEFORE any environment is known and therefore before any `OpsContext`
 * exists at all. `bin.ts` defaults this to the real Node adapters
 * (`createNodeFileSystem`/`createNodeModuleLoader`). Declared as a required
 * parameter, not defaulted inside this module, for the same reason
 * `ContextFactory` is: the composition root (`bin.ts`) is the only place
 * real adapters get constructed.
 *
 * Only four kinds of path ever call this factory, and therefore ever run
 * `discover` (`plugins.ts`) or touch `ports.loader` at all:
 *
 *   1. Generic plugin dispatch (`runPlugin`, `plugin-commands.ts`) - a
 *      command that is neither a built-in nor `plugin` itself.
 *   2. `blogwright --help` and a bare invocation, plus every other USAGE
 *      print site in this module (`helpText`, below) - `main`'s own
 *      unknown-command default, `runPds`'s unknown-action branch, and
 *      `runPreview`'s two - so an error path never shows help that is
 *      stale about what is installed.
 *   3. `blogwright plugin list` (task 17), which names plugins that failed
 *      to load - only a load attempt can discover that.
 *   4. `blogwright init`, whose wizard asks each discovered plugin's
 *      questions and writes their blocks into the config file it produces
 *      - but only on an interactive terminal. A non-interactive invocation
 *      still calls this factory (it needs the `FileSystem` half to build
 *      `initSite`'s arguments) but refuses before ever calling `discover`,
 *      so it never resolves or imports a single plugin module for a
 *      command that was always going to decline (see the `init` branch's
 *      own comment, below).
 *
 * Every other built-in command pays nothing for discovery - `deploy`,
 * `bootstrap` and `status` among them (the three a laziness test in
 * `cli.test.ts` pins directly), and likewise `rollback`, `delete`,
 * `destroy`, `history`, `logs` and `preview`/`pds` dispatched successfully.
 * This becomes load-bearing once task 26 strips the static `pds` block out
 * of `USAGE`: with `--help` and its error-path echoes exempted from
 * discovery, there would be no commit at which `blogwright --help` (or
 * `blogwright pds bogus`) could list all six pds actions again before task
 * 29 finishes the migration.
 */
export type DiscoveryPortsFactory = () => Pick<Ports, 'fs' | 'loader'>;

export async function main(
  argv: string[],
  makeTerminal: TerminalFactory,
  makeContext: ContextFactory,
  makeDiscoveryPorts: DiscoveryPortsFactory,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      env: { type: 'string' },
      domain: { type: 'string' },
      config: { type: 'string' },
      endpoint: { type: 'string' },
      hash: { type: 'string' },
      id: { type: 'string' },
      identifier: { type: 'string' },
      plain: { type: 'boolean', default: false },
      refresh: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  const terminal = makeTerminal({ plain: values.plain });
  const logger = createLogger(terminal);

  const command = positionals[0];
  if (!command || values.help) {
    logger.info(await helpText(makeDiscoveryPorts()));
    // Asking for help is success; invoking with no command at all is not.
    return values.help || command ? 0 : 1;
  }
  if (command === 'init') {
    const discoveryPorts = makeDiscoveryPorts();
    if (!terminal.isInteractive) {
      // `initSite`'s own first check refuses immediately on a
      // non-interactive terminal, before it ever touches `fs` or `plugins`.
      // Skip discovery entirely here rather than resolving - and dynamically
      // importing - every installed plugin's module for a command that was
      // always going to decline; `makeDiscoveryPorts()` above is cheap
      // (adapter construction only, no I/O), unlike `discover` itself.
      return initSite(discoveryPorts.fs, terminal, logger, []);
    }
    // Runs before any context exists - there is no config to load yet.
    // `init` is one of the four discovery-running paths `DiscoveryPortsFactory`
    // enumerates above: the wizard asks each discovered plugin's questions
    // too, so discovery runs over the SAME factory plugin dispatch uses
    // below, not a second, ad hoc seam. `blogwright init` is also exactly
    // the situation `helpText` above already tolerates a discovery
    // precondition failure for: a resolved repo root, a readable
    // package.json there, may not hold at all, since this is the wizard
    // that BOOTSTRAPS a repo. Mirrors `helpText`'s two-step try/catch
    // exactly, narrowed the same way with the same two helpers: a missing
    // repo root or a missing package.json is tolerated - a real first-run
    // state, not a defect - and treated as "no plugins installed" so the
    // plain four-question flow still completes; anything else - a
    // malformed package.json, say, which IS a defect worth surfacing -
    // propagates unchanged rather than silently discarding a plugin's
    // config block.
    let repoRoot: string;
    try {
      repoRoot = await findRepoRoot(discoveryPorts.fs);
    } catch (err) {
      if (!isNoRepoRootError(err)) throw err;
      repoRoot = process.cwd();
    }
    let plugins: readonly Plugin[] = [];
    try {
      plugins = (await discover(repoRoot, cliPackageDir(), discoveryPorts)).plugins;
    } catch (err) {
      if (!isMissingPackageJsonError(err)) throw err;
      logger.warn(`${(err as Error).message} - continuing with no plugins discovered`);
    }
    return initSite(discoveryPorts.fs, terminal, logger, plugins, repoRoot);
  }
  if (command === 'preview') {
    return runPreview(positionals, values, terminal, logger, makeContext, makeDiscoveryPorts);
  }
  if (command === 'pds') {
    return runPds(positionals, values, terminal, logger, makeContext, makeDiscoveryPorts);
  }
  if (!KNOWN_COMMANDS.has(command)) {
    // Not a built-in and not `plugin` itself: the only remaining possibility
    // is an installed plugin's namespace. `runPlugin` runs discovery itself
    // (built-in commands below never call `makeDiscoveryPorts` or trigger
    // it) and reports an unknown plugin or action on its own, so there is no
    // further fallback here.
    return runPlugin(
      command,
      positionals.slice(1),
      values,
      terminal,
      logger,
      makeContext,
      makeDiscoveryPorts(),
    );
  }

  // Positional layout: rollback/logs take <hash> first, then optional env.
  let hash: string | undefined;
  let envPositional: string | undefined;
  if (HASH_COMMANDS.has(command)) {
    hash = values.hash ?? positionals[1];
    envPositional = positionals[2];
  } else {
    envPositional = positionals[1];
  }
  const env = values.env ?? envPositional ?? 'production';

  const ctx = await makeContext({
    env,
    configPath: values.config,
    domain: values.domain,
    endpointOverride: values.endpoint,
    ports: { terminal },
  });

  switch (command) {
    case 'bootstrap':
      await commands.bootstrap(ctx);
      break;
    case 'deploy':
      await commands.deploy(ctx, { refresh: values.refresh });
      break;
    case 'rollback':
      if (!hash) throw new Error('rollback requires a <hash>');
      await commands.rollback(ctx, hash, { refresh: values.refresh });
      break;
    case 'delete':
      await commands.deleteSite(ctx);
      break;
    case 'destroy':
      await commands.destroy(ctx, { yes: values.yes });
      break;
    case 'history':
      await commands.history(ctx);
      break;
    case 'logs':
      if (!hash) throw new Error('logs requires a <hash>');
      await commands.logs(ctx, hash);
      break;
    case 'status':
      await commands.status(ctx);
      break;
    default:
      logger.error(`unknown command: ${command}`);
      logger.info(await helpText(makeDiscoveryPorts()));
      return 1;
  }
  return 0;
}

interface PdsValues {
  env?: string | undefined;
  config?: string | undefined;
  domain?: string | undefined;
  endpoint?: string | undefined;
  identifier?: string | undefined;
  yes: boolean;
}

/** Handle `blogwright pds <action> [env]` (and `pds secret <action> [env]`). */
async function runPds(
  positionals: string[],
  values: PdsValues,
  terminal: Terminal,
  logger: Logger,
  makeContext: ContextFactory,
  makeDiscoveryPorts: DiscoveryPortsFactory,
): Promise<number> {
  // `pds secret set production` - the secret sub-action shifts positionals by one.
  const secret = positionals[1] === 'secret';
  const action = secret ? `secret ${positionals[2] ?? ''}`.trim() : positionals[1];
  const envPositional = positionals[secret ? 3 : 2];
  const known = new Set(['keygen', 'login', 'init', 'sync', 'secret status', 'secret delete']);
  if (!action || !known.has(action)) {
    logger.error(`unknown pds action: ${action ?? '(none)'}`);
    // Wired deliberately, unlike `runPlugin`'s fall-through: task 26 strips
    // the static `pds` block from `USAGE` before task 29 deletes this whole
    // branch, and an unwired print here would answer `blogwright pds bogus`
    // with help listing no pds actions at all for that span.
    logger.info(await helpText(makeDiscoveryPorts()));
    return 1;
  }
  const ctx = await makeContext({
    env: values.env ?? envPositional ?? 'production',
    configPath: values.config,
    domain: values.domain,
    endpointOverride: values.endpoint,
    ports: { terminal },
  });

  switch (action) {
    case 'keygen':
      await pds.keygen(ctx);
      break;
    case 'login':
      await pds.login(ctx, { identifier: values.identifier });
      break;
    case 'secret status':
      await pds.secretStatus(ctx);
      break;
    case 'secret delete':
      await pds.secretDelete(ctx, { yes: values.yes });
      break;
    case 'init':
      await pds.init(ctx);
      break;
    case 'sync':
      await pds.sync(ctx);
      break;
  }
  return 0;
}

interface PreviewValues {
  domain?: string | undefined;
  config?: string | undefined;
  endpoint?: string | undefined;
  id?: string | undefined;
  refresh: boolean;
  yes: boolean;
}

/** Handle `blogwright preview <action> [id]` (always the shared `preview` stack). */
const PREVIEW_ACTIONS = new Set(['bootstrap', 'deploy', 'destroy', 'list', 'teardown']);

async function runPreview(
  positionals: string[],
  values: PreviewValues,
  terminal: Terminal,
  logger: Logger,
  makeContext: ContextFactory,
  makeDiscoveryPorts: DiscoveryPortsFactory,
): Promise<number> {
  const action = positionals[1];
  const id = values.id ?? positionals[2];
  if (!action || !PREVIEW_ACTIONS.has(action)) {
    logger.error(`unknown preview action: ${action ?? '(none)'}`);
    logger.info(await helpText(makeDiscoveryPorts()));
    return 1;
  }
  const ctx = await makeContext({
    env: 'preview',
    preview: true,
    configPath: values.config,
    domain: values.domain,
    endpointOverride: values.endpoint,
    ports: { terminal },
  });

  switch (action) {
    case 'bootstrap':
      await commands.previewBootstrap(ctx);
      break;
    case 'deploy':
      if (!id) throw new Error('preview deploy requires an <id> (e.g. pr-42)');
      await commands.previewDeploy(ctx, id, { refresh: values.refresh });
      break;
    case 'destroy':
      if (!id) throw new Error('preview destroy requires an <id>');
      await commands.previewDestroy(ctx, id);
      break;
    case 'list':
      await commands.previewList(ctx);
      break;
    case 'teardown':
      await commands.previewTeardown(ctx, { yes: values.yes });
      break;
    default:
      // Unreachable - `action` is guaranteed to be a `PREVIEW_ACTIONS` member
      // past the guard above, which already returns for anything else. Kept
      // wired to the same help text as every other USAGE print site so it
      // stays correct if that guarantee is ever loosened.
      logger.error(`unknown preview action: ${action ?? '(none)'}`);
      logger.info(await helpText(makeDiscoveryPorts()));
      return 1;
  }
  return 0;
}
