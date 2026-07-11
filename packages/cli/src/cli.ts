import { parseArgs } from 'node:util';

import { createNodeFileSystem, type Terminal } from 'blogwright-core';
import * as pds from 'blogwright-pds';

import * as commands from './commands.js';
import { createContext } from './context.js';
import { initSite } from './init.js';
import { createLogger, type Logger } from './logger.js';

const USAGE = `blogwright — full operations for a blog site on AWS (S3 + CloudFront, MicroVM builds)

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
                    no prompts) — for CI systems and agents; also automatic when
                    output is piped. NO_COLOR disables colour only.
  --yes             Confirm destructive operations
  --help            Show this help
`;

const HASH_COMMANDS = new Set(['rollback', 'logs']);
const KNOWN_COMMANDS = new Set([
  'bootstrap',
  'deploy',
  'rollback',
  'delete',
  'destroy',
  'history',
  'logs',
  'status',
]);

/** Builds the Terminal after flag parsing, so --plain shapes the whole session. */
export type TerminalFactory = (opts: { plain: boolean }) => Terminal;

export async function main(argv: string[], makeTerminal: TerminalFactory): Promise<number> {
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
      yes: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  const terminal = makeTerminal({ plain: values.plain });
  const logger = createLogger(terminal);

  const command = positionals[0];
  if (!command || values.help) {
    logger.info(USAGE);
    // Asking for help is success; invoking with no command at all is not.
    return values.help || command ? 0 : 1;
  }
  if (command === 'init') {
    // Runs before any context exists — there is no config to load yet.
    return initSite(createNodeFileSystem(), terminal, logger);
  }
  if (command === 'preview') {
    return runPreview(positionals, values, terminal, logger);
  }
  if (command === 'pds') {
    return runPds(positionals, values, terminal, logger);
  }
  if (!KNOWN_COMMANDS.has(command)) {
    logger.error(`unknown command: ${command}`);
    logger.info(USAGE);
    return 1;
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

  const ctx = await createContext({
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
      await commands.deploy(ctx);
      break;
    case 'rollback':
      if (!hash) throw new Error('rollback requires a <hash>');
      await commands.rollback(ctx, hash);
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
      logger.info(USAGE);
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
): Promise<number> {
  // `pds secret set production` — the secret sub-action shifts positionals by one.
  const secret = positionals[1] === 'secret';
  const action = secret ? `secret ${positionals[2] ?? ''}`.trim() : positionals[1];
  const envPositional = positionals[secret ? 3 : 2];
  const known = new Set(['keygen', 'login', 'init', 'sync', 'secret status', 'secret delete']);
  if (!action || !known.has(action)) {
    logger.error(`unknown pds action: ${action ?? '(none)'}`);
    logger.info(USAGE);
    return 1;
  }
  const ctx = await createContext({
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
  yes: boolean;
}

/** Handle `blogwright preview <action> [id]` (always the shared `preview` stack). */
const PREVIEW_ACTIONS = new Set(['bootstrap', 'deploy', 'destroy', 'list', 'teardown']);

async function runPreview(
  positionals: string[],
  values: PreviewValues,
  terminal: Terminal,
  logger: Logger,
): Promise<number> {
  const action = positionals[1];
  const id = values.id ?? positionals[2];
  if (!action || !PREVIEW_ACTIONS.has(action)) {
    logger.error(`unknown preview action: ${action ?? '(none)'}`);
    logger.info(USAGE);
    return 1;
  }
  const ctx = await createContext({
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
      await commands.previewDeploy(ctx, id);
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
      logger.error(`unknown preview action: ${action ?? '(none)'}`);
      logger.info(USAGE);
      return 1;
  }
  return 0;
}
