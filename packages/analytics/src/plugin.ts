/**
 * The package's `Plugin` default export: the object the CLI's discovery
 * loads once `package.json`'s `{ "blogwright": { "plugin": "analytics" } }`
 * manifest field marks this package as a plugin. Everything the host learns
 * about this plugin - its namespace, its help text, the config key it owns,
 * its validator, its actions and its `init` contributor - it learns from
 * here.
 *
 * **The command table, and what is deliberately missing from it.** Task 16's
 * precedence rules (`packages/cli/src/plugin-commands.ts`, its TASK 13 and
 * TASK 16 PRECEDENCE sections) decide which verbs a plugin may declare:
 *
 *   - `bootstrap` and `destroy` are ALWAYS the CLI's generic verbs. They run
 *     `applyGraph`/`destroyGraph` over `nodes(ctx)`, and a plugin may not
 *     import the CLI, so a plugin cannot run that engine itself. Declaring
 *     either is not merely redundant, it is rejected at discovery -
 *     `rejectDeclaredLifecycleCollisions` (`packages/cli/src/plugins.ts`)
 *     turns the whole package into a load failure naming the colliding
 *     action. They are absent here for that reason, not for tidiness.
 *   - `status` is the generic verb UNLESS the plugin declares its own, and
 *     this one does: `analytics status` reports strictly more than the
 *     generic verb can - the stream's delivery health and the table's
 *     current row count on top of the node listing - and needs no engine
 *     call to do it, because `read()` lives on the plugin's own nodes.
 *   - `init` is ABSENT from the table on purpose, and this is the trap
 *     worth stating plainly: a declared command takes precedence over the
 *     generic action, so an `init` entry here would shadow the generic
 *     config-block splice. `blogwright analytics init` would then ask the
 *     operator every question below and write nothing at all. The `init`
 *     contributor ({@link Plugin.init}) is the ONLY way this plugin supplies
 *     `init`. (pds is the opposite case: it declares a real `init` command
 *     that creates the publication record and writes no config block, which
 *     precedence permits - a declared `init` owns the action, not an
 *     obligation to write config.) Declaring both is itself a discovery
 *     rejection, `rejectDeclaredInitCollisions` in the same collision pass.
 *   - `backfill` is legal to declare precisely because only `bootstrap` and
 *     `destroy` are reserved; it is the spec's optional, run-by-hand,
 *     one-shot action.
 *
 * None of the three declared actions is destructive, so no summary here
 * states `--yes`. The one destructive verb this namespace answers is
 * `analytics destroy --yes`, which is generic: its refusal without `--yes`
 * is `runGenericDestroy`'s, and its summary is the CLI's own.
 *
 * **`nodes` is not declared yet.** Task 54 assembles `buildAnalyticsNodes`
 * and wires it to `nodes(ctx)`. Until it does, `genericLifecycleCommand` and
 * `genericLifecycleActions` (`packages/cli/src/plugin-commands.ts`) both
 * gate on `plugin.nodes` being declared at all, so `analytics bootstrap` and
 * `analytics destroy` are not answered and are not advertised in
 * `blogwright --help`; `analytics status` is answered anyway, because it is
 * declared here rather than generic. That is the correct intermediate state:
 * the generic verbs would otherwise reconcile an empty graph and report
 * success having provisioned nothing.
 *
 * **`validateConfig` is task 44's validator, bound - not wrapped.** The
 * property below is `validateAnalyticsConfig` itself. That matters twice
 * over. It is the function that applies the four literal defaults and stamps
 * the module-private symbol `resolveAnalyticsConfig` unseals
 * (`config.ts`'s `unsealEnvDerivedOverrides`), so any wrapper that reshaped
 * or re-defaulted the block would produce one the resolver rejects at
 * runtime. And the CLI calls it with `undefined` when the operator's config
 * carries no `analytics` key at all (`resolvePluginConfig`,
 * `packages/cli/src/plugins.ts`, over `pluginBlock`'s plain property read),
 * so the plugin's own defaults - not a bare `{}` - are what such an operator
 * gets; `validateAnalyticsConfig` treats an absent block as an empty one for
 * exactly that reason. Passing the function by reference keeps both
 * properties instead of restating them.
 */

import type { ConfigBlockEntry, Plugin, PluginInitIo } from 'blogwright-core';

import { backfill, dashboard, status } from './commands.js';
import { validateAnalyticsConfig, type AnalyticsConfig } from './config.js';

/**
 * The CLI namespace this plugin claims (`blogwright analytics <action>`),
 * and - deliberately the same string - the single top-level config key it
 * owns (`config.analytics`), the way pds's namespace and key coincide too.
 * Re-exported from `index.ts`, where it lived before the default export
 * existed to consume it.
 */
export const ANALYTICS_NAMESPACE = 'analytics';

/** The answers {@link isYes} accepts, matching `confirm`'s (`packages/cli/src/logger.ts`). */
const YES_ANSWERS = new Set(['y', 'yes']);

/** True when the operator agreed. Empty input never reaches here - `ask` substitutes the default first. */
function isYes(answer: string): boolean {
  return YES_ANSWERS.has(answer.trim().toLowerCase());
}

/**
 * Run `block` past {@link validateAnalyticsConfig} and return the message it
 * raised, or `undefined` when it holds - the shape `PluginQuestion.validate`
 * asks for. Every prompt below validates through this, so the wizard rejects
 * exactly what the config validator rejects, with the validator's own
 * message, and neither list of rules nor set of messages has a second home.
 *
 * These validators are also the only thing standing between a typed answer
 * and the JSON text the entries below interpolate it into. An answer carrying
 * a quote would close its own string and open a setting the wizard never
 * asked about - `tableBucket` above all, the field task 44 sealed behind a
 * module-private symbol precisely so that no code path can produce an
 * env-less bucket name (`config.ts`, and what an env-less one destroys). Such
 * a splice would survive the host's re-parse AND `validateAnalyticsConfig`,
 * because the key it opens is a legitimate one; what refuses it is the
 * `table` prompt's own rule, that an Iceberg identifier has no quote in it.
 */
function rejectionOf(block: Record<string, unknown>): string | undefined {
  try {
    validateAnalyticsConfig(block);
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * Validate a typed port answer. A non-numeric answer is handed to the
 * validator as the string it is, so the rejection quotes what the operator
 * typed rather than `NaN`.
 */
function portRejection(answer: string): string | undefined {
  const numeric = Number(answer);
  return rejectionOf({ dashboard: { port: Number.isNaN(numeric) ? answer : numeric } });
}

/**
 * Ask the operator for this plugin's config block and return it as the
 * property/comment entries `renderConfigBlock` (`packages/cli/src/config-block.ts`)
 * renders - the entry shape `renderConfig` (`packages/cli/src/init.ts`)
 * mirrors at the top level. Both paths that reach a contributor - the
 * first-run wizard (`blogwright init`) and the generic per-plugin action
 * (`blogwright analytics init`) - call this one function.
 *
 * Only the four settings whose defaults are plain literals are asked. The
 * other two the block accepts - `tableBucket` and `saltSecretName` - are
 * deliberately not asked: their defaults carry the environment (`config.ts`),
 * a contributor is handed no environment (`PluginInitIo` is terminal-shaped
 * and nothing more), and a prompt whose default is wrong for every
 * environment but one is worse than no prompt at all. An operator overriding
 * either writes it into the block by hand, where the validator still checks
 * it.
 *
 * The defaults offered come from `validateAnalyticsConfig(undefined)` -
 * task 44's validator applied to an absent block - rather than from
 * constants restated here, so the value the wizard offers is by construction
 * the value an operator gets by leaving the setting out. That is also the
 * exact call the CLI makes for an operator with no `analytics` key.
 *
 * No question carries `required`. Every default below is a non-empty string,
 * and `ask` (`packages/cli/src/init.ts`) substitutes the default before it
 * consults `required`, so the flag has no reachable effect on any of them.
 *
 * Returns an empty array - never `undefined` - when the operator declines or
 * the session cannot ask, so the composing caller writes no key, no block
 * and no stray comma. Touches no filesystem: `PluginInitIo` carries no `fs`,
 * and writing the answers is the host's job on both paths.
 */
async function askAnalyticsBlock(io: PluginInitIo): Promise<ConfigBlockEntry[]> {
  if (!io.isInteractive) {
    io.logger.warn(
      'analytics: not an interactive session - skipping the analytics block; run `blogwright analytics init` later, or write it by hand',
    );
    return [];
  }

  const defaults = validateAnalyticsConfig(undefined);

  const enable = await io.ask({
    prompt: 'set up analytics now? CloudFront access logs into an Iceberg table (y/n)',
    defaultValue: 'y',
  });
  if (!isYes(enable)) return [];

  const namespace = await io.ask({
    prompt: 'Iceberg namespace holding the table',
    defaultValue: defaults.namespace,
    validate: (answer) => rejectionOf({ namespace: answer }),
  });
  const table = await io.ask({
    prompt: 'Iceberg table the page views land in',
    defaultValue: defaults.table,
    validate: (answer) => rejectionOf({ table: answer }),
  });
  const bots = await io.ask({
    prompt: 'bot traffic in dashboard queries - flag (keep, marked) or filter (excluded)',
    defaultValue: defaults.bots,
    validate: (answer) => rejectionOf({ bots: answer }),
  });
  const port = await io.ask({
    prompt: 'port the local dashboard listens on',
    defaultValue: String(defaults.dashboard.port),
    validate: portRejection,
  });

  return [
    { property: `"namespace": "${namespace}"`, comment: 'Iceberg namespace holding the table' },
    { property: `"table": "${table}"`, comment: 'Iceberg table the page views land in' },
    {
      property: `"bots": "${bots}"`,
      comment: 'flag keeps bot rows and marks them; filter excludes them from queries',
    },
    // The number is rendered from the parsed value, not the typed text: a
    // `04317` an operator types validates fine as a number but is not legal
    // JSON, and this block is re-parsed before it reaches disk.
    {
      property: `"dashboard": { "port": ${Number(port)} }`,
      comment: 'the dashboard binds 127.0.0.1 on this port',
    },
  ];
}

/**
 * The plugin the CLI discovers. `Plugin<AnalyticsConfig>` names the block
 * `validateConfig` returns, which is what the host puts on
 * `ctx.pluginConfig` - the only route to this plugin's settings, and (for
 * the two environment-carrying ones) only through
 * `resolveAnalyticsConfig(ctx)`.
 */
const analyticsPlugin: Plugin<AnalyticsConfig> = {
  name: ANALYTICS_NAMESPACE,
  description: 'CloudFront access logs in an Iceberg table, with a local dashboard',
  configKey: ANALYTICS_NAMESPACE,
  validateConfig: validateAnalyticsConfig,
  init: askAnalyticsBlock,
  commands: [
    {
      action: 'status',
      summary: "show resources, stream delivery health and the table's row count",
      run: status,
    },
    {
      action: 'dashboard',
      summary: 'serve the local dashboard over the table on 127.0.0.1',
      run: dashboard,
    },
    {
      action: 'backfill',
      summary: "one-shot fill of pre-Firehose days from the site's logs",
      run: backfill,
    },
  ],
};

export default analyticsPlugin;
