/**
 * The SPI declaration this package default-exports: the `pds` namespace, the
 * six actions `blogwright pds <action>` has always answered, the `pds` config
 * key with this package's own validator, and the one resource node
 * (`nodes.ts`) the plugin contributes to the graph engine.
 *
 * Every command here is a WRAPPER and nothing more. It parses its own flags
 * out of the token array the host hands it and calls the matching function in
 * `commands.ts`, whose signature is unchanged and which stays individually
 * exported - `deploy` still calls `syncAfterDeploy(ctx)` with a plain
 * `OpsContext` and never goes through this table.
 *
 * The context boundary is a plain assignment, not a conversion: every command
 * function takes `PdsContext`, which `context.ts` declares as a `Pick` over
 * core's `PluginContext<PdsConfig>`, so handing this module's `ctx` straight
 * to `keygen`/`login`/… is an ordinary argument assignment the compiler
 * checks. `nodes` is the exception, and deliberately so: it takes the FULL
 * `PluginContext<PdsConfig>`, because its node reads `siteState`, `names`,
 * `accountId` and `record()` - members no command context carries, and which
 * only a lifecycle verb's dispatch boundary builds.
 *
 * `bootstrap`, `status` and `destroy` are absent on purpose. They are the
 * host's generic lifecycle verbs over `nodes`, and a plugin declaring
 * `bootstrap` or `destroy` is rejected at load
 * (`packages/cli/src/plugins.ts`); `status` would merely shadow the generic
 * one. So is `init` as a CONFIG CONTRIBUTOR (`Plugin.init`): `pds init` means
 * the publication-setup command below, and declaring a contributor would let
 * the host's generic `blogwright <plugin> init` shadow it.
 */

import type { PdsConfig, Plugin, PluginCommand } from 'blogwright-core';

import { init, keygen, login, secretDelete, secretStatus, sync } from './commands.js';
import { validatePdsConfig } from './config.js';
import { buildPdsNodes } from './nodes.js';

/**
 * The CLI namespace this plugin claims. Kept distinct from
 * {@link PDS_CONFIG_KEY} below even though the two strings coincide today: a
 * namespace is a dispatch label the host may have to disambiguate against
 * another plugin's, while the config key names a block in an operator's
 * committed config file that nothing may rename underneath them.
 */
const PDS_NAMESPACE = 'pds';

/** The single top-level config key this package owns end to end. */
const PDS_CONFIG_KEY = 'pds';

/** One line for `blogwright --help`, distilled from the CLI's own `pds` usage block. */
const PDS_DESCRIPTION =
  'standard.site (AT Protocol) publishing: OAuth client, publication setup and record sync';

/** The flag `pds login` reads the account to authorize from. */
const IDENTIFIER_FLAG = '--identifier';

/** The confirmation flag `pds secret delete` refuses to run without. */
const YES_FLAG = '--yes';

/**
 * The command functions the six declared actions wrap. Defaulted to the real
 * ones ({@link pdsCommandFunctions}) and injectable through
 * {@link createPdsPlugin}, which is the same default-parameter seam
 * `commands.ts` already uses for `generateClientKey`, `openPdsRepo` and
 * `oauthLogin`: the alternative for a test is patching the module, which
 * DEVELOPMENT.md §Hexagonal architecture bans, and no port exists that would
 * reveal what `login` was handed - it fetches the deployed `/oauth/`
 * documents through the global `fetch` before the identifier is ever used.
 * Nothing in production ever supplies this.
 */
export interface PdsCommandFunctions {
  keygen: typeof keygen;
  login: typeof login;
  init: typeof init;
  sync: typeof sync;
  secretStatus: typeof secretStatus;
  secretDelete: typeof secretDelete;
}

/** The real command functions - what the package's default export is built over. */
const pdsCommandFunctions: PdsCommandFunctions = {
  keygen,
  login,
  init,
  sync,
  secretStatus,
  secretDelete,
};

/**
 * The value of a `--flag value` pair in the tokens the host supplies, or
 * `undefined` when the flag is absent - which is what makes the wrapped
 * function's own refusal (`pds login requires --identifier <handle-or-did>`)
 * the single place that message lives.
 *
 * The next token is taken verbatim, with no "does it look like a flag?"
 * guard, because the host cannot produce a dangling flag: `serialiseFlags`
 * (`packages/cli/src/plugin-commands.ts`) emits a string flag only as the
 * pair `--name value`, and `parseArgs` has already consumed every `--flag` out
 * of the positionals before the remainder reaches a plugin.
 */
function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

/**
 * The six actions, with the exact action strings the CLI's own `pds` dispatch
 * accepts today - `secret status` and `secret delete` declared as the
 * two-word actions they are, which the host matches longest-first rather than
 * by the positional shifting `runPds` hand-rolls.
 */
function pdsCommands(fns: PdsCommandFunctions): PluginCommand<PdsConfig>[] {
  return [
    {
      action: 'keygen',
      summary:
        'generate the OAuth client key: private JWK into Secrets Manager, public documents into public/oauth/',
      async run(ctx) {
        await fns.keygen(ctx);
      },
    },
    {
      action: 'login',
      summary: `interactive OAuth bootstrap, storing the session in Secrets Manager (${IDENTIFIER_FLAG} <handle-or-did>)`,
      async run(ctx, args) {
        await fns.login(ctx, { identifier: flagValue(args, IDENTIFIER_FLAG) });
      },
    },
    {
      action: 'init',
      summary:
        'create or update the standard.site publication record and write the site verification files',
      async run(ctx) {
        await fns.init(ctx);
      },
    },
    {
      action: 'sync',
      summary:
        'reconcile site.standard.document records with the content collection (production only)',
      async run(ctx) {
        await fns.sync(ctx);
      },
    },
    {
      action: 'secret status',
      summary: 'show the secret metadata - never the value',
      async run(ctx) {
        await fns.secretStatus(ctx);
      },
    },
    {
      action: 'secret delete',
      summary: `delete the secret, logging out and discarding the key (${YES_FLAG})`,
      async run(ctx, args) {
        await fns.secretDelete(ctx, { yes: args.includes(YES_FLAG) });
      },
    },
  ];
}

/**
 * Build the plugin over a given set of command functions. Exported for tests
 * only - see {@link PdsCommandFunctions}; every consumer uses the package's
 * default export, which is {@link createPdsPlugin} called with the real ones.
 *
 * `validateConfig` and `nodes` are the imported functions THEMSELVES, not
 * wrappers around them: this package owns `validatePdsConfig` and
 * `buildPdsNodes` outright, and a wrapper is the one place a filter or a
 * re-ordering could later appear between the host and what those two return.
 */
export function createPdsPlugin(fns: PdsCommandFunctions = pdsCommandFunctions): Plugin<PdsConfig> {
  return {
    name: PDS_NAMESPACE,
    description: PDS_DESCRIPTION,
    commands: pdsCommands(fns),
    configKey: PDS_CONFIG_KEY,
    validateConfig: validatePdsConfig,
    nodes: buildPdsNodes,
  };
}

/**
 * The package's default export. Inert until `package.json` declares the
 * `blogwright.plugin` manifest field: discovery never imports a package
 * without it, so `blogwright pds <action>` still routes through the CLI's own
 * `runPds` branch.
 */
const pdsPlugin: Plugin<PdsConfig> = createPdsPlugin();

export default pdsPlugin;
