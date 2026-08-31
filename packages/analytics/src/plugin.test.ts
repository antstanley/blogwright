/**
 * Tests for the package's `Plugin` default export, driven the way the CLI's
 * own discovery drives it wherever that is reachable from here.
 *
 * WHAT CANNOT BE DRIVEN FROM THIS PACKAGE, AND WHY. A plugin may not import
 * the CLI (§CLI → Plugin dispatch), and the CLI does not depend on
 * `blogwright-analytics` (this plugin is installed on demand, never
 * bundled), so no test anywhere can put THIS plugin object through the CLI's
 * real `runPlugin`/`runGenericInit`. What is reachable is split in two, and
 * both halves are covered:
 *
 *   - The plugin's side of each contract, asserted here against core's own
 *     `validatePlugin` and against the exact preconditions the CLI's
 *     dispatcher reads (`matchAction` finds no `init` command; `plugin.init`
 *     is a function; `plugin.configKey` names a block - the three things
 *     `runGenericInit` needs in order to be reached and to do its work).
 *   - The host's side, already pinned in the CLI against a contributor-only
 *     plugin: `packages/cli/src/plugin-commands.test.ts`, "splices a
 *     contributor-only plugin's answered block into config/<env>.jsonc, and
 *     the result re-parses cleanly".
 *
 * The seam between the two halves is covered here by composing this
 * contributor's real output through host STAND-INS - `createInitIo`,
 * `renderBlock` and `composeDocument` below - which restate `ask`/
 * `buildInitIo` (`packages/cli/src/init.ts`), `renderConfigBlock`
 * (`packages/cli/src/config-block.ts`) and `renderConfig`'s composition
 * (`packages/cli/src/init.ts`), and then handing the result to core's REAL
 * `parseConfigDocument` - the gate both host paths apply before anything
 * reaches disk. Those three functions are the only restated host code in
 * this file, and each says so.
 */

import { fileURLToPath } from 'node:url';

import {
  createNodeFileSystem,
  createScriptedTerminal,
  parseConfigDocument,
  pluginBlock,
  PLUGIN_NAME_PATTERN,
  validatePlugin,
  type ConfigBlockEntry,
  type OpsConfig,
  type PluginInitIo,
  type PluginLogger,
  type PluginQuestion,
  type ScriptedTerminal,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { backfill, dashboard, status } from './commands.js';
import { resolveAnalyticsConfig, validateAnalyticsConfig, type AnalyticsConfig } from './config.js';
import * as analyticsModule from './index.js';
import { buildAnalyticsNodes } from './nodes.js';
import analyticsPlugin from './plugin.js';

/** This package's own `package.json` - the file CLI discovery reads the manifest field from. */
const PACKAGE_JSON_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

/** The plugin module's own source, read back to pin what it does NOT reach. */
const PLUGIN_SOURCE_PATH = fileURLToPath(new URL('./plugin.ts', import.meta.url));

/** The package name discovery resolves this plugin under, and the name every rejection carries. */
const PACKAGE_NAME = 'blogwright-analytics';

/**
 * Every action name the CLI reserves against a plugin's own command table,
 * listed in full rather than sampled:
 *
 *   - `bootstrap` and `destroy` - `RESERVED_LIFECYCLE_ACTIONS`
 *     (`packages/cli/src/plugins.ts`), rejected outright at discovery,
 *     because they run an engine a plugin may not import.
 *   - `init` - `GENERIC_INIT_ACTION` (`packages/cli/src/plugins.ts` and
 *     `packages/cli/src/plugin-commands.ts`). Rejected at discovery when
 *     paired with an `init(io)` contributor, which this plugin declares -
 *     and, worse than rejected, it would shadow the generic config-block
 *     splice if it were ever declared alone.
 *
 * `status` is deliberately NOT in this list: task 16 leaves it declarable,
 * and this plugin declares it.
 */
const RESERVED_ACTIONS = ['bootstrap', 'destroy', 'init'];

/** The actions this plugin declares, in table order. */
const DECLARED_ACTIONS = ['status', 'dashboard', 'backfill'];

/** The node count the change spec's §Analytics pipeline -> Resource nodes table states. */
const ANALYTICS_NODE_COUNT = 12;

/** `renderPluginSection` (`packages/cli/src/cli.ts`) indents an action line by four spaces. */
const HELP_LINE_INDENT = 4;

/** The same function indents the plugin's own name/description line by two. */
const PLUGIN_LINE_INDENT = 2;

/** The widest line the static `USAGE` block (`packages/cli/src/cli.ts`) renders is 86 columns; stay inside 80. */
const MAX_HELP_LINE_WIDTH = 80;

/** `ask`'s retry budget (`packages/cli/src/init.ts`), restated by the stand-in below. */
const MAX_ATTEMPTS = 3;

/** Read this package's `package.json` through the FileSystem port, as discovery does. */
async function readPackageManifest(): Promise<Record<string, unknown>> {
  const text = await createNodeFileSystem().readText(PACKAGE_JSON_PATH);
  return JSON.parse(text) as Record<string, unknown>;
}

/** Call the plugin's own `validateConfig`, failing loudly rather than casting when it is absent. */
function validateBlock(raw: unknown): AnalyticsConfig {
  const validateConfig = analyticsPlugin.validateConfig;
  if (!validateConfig) throw new Error('the analytics plugin declares no validateConfig');
  return validateConfig(raw);
}

/** A site config for the environment-carrying settings to resolve against. */
function siteConfig(): OpsConfig {
  return parseConfigDocument('{ "region": "us-east-1", "siteName": "example" }').config;
}

/** Collect a `PluginLogger`'s warnings, so a test can assert what was reported. */
function createRecordingLogger(): { logger: PluginLogger; warnings: string[] } {
  const warnings: string[] = [];
  const ignore = (): void => {};
  return {
    warnings,
    logger: {
      info: ignore,
      step: ignore,
      ok: ignore,
      warn: (msg) => warnings.push(msg),
      error: ignore,
    },
  };
}

/**
 * HOST STAND-IN. The `PluginInitIo` the CLI builds for a contributor, over a
 * scripted `Terminal`. Restates `buildInitIo` and `ask`
 * (`packages/cli/src/init.ts`, mirrored by `plugin-commands.ts`'s own
 * `buildInitIo`): the prompt carries ` [default]` when there is one, the
 * answer is trimmed, an empty answer falls back to the default, an
 * unanswered optional question resolves to the empty string, and a
 * `validate` problem re-prompts up to {@link MAX_ATTEMPTS} times before
 * throwing. It exists because this package may not import the CLI.
 */
function createInitIo(terminal: ScriptedTerminal): { io: PluginInitIo; warnings: string[] } {
  const { logger, warnings } = createRecordingLogger();
  async function ask(question: PluginQuestion): Promise<string> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const suffix = question.defaultValue ? ` [${question.defaultValue}]` : '';
      const answer =
        (await terminal.question(`${question.prompt}${suffix}: `)).trim() || question.defaultValue;
      if (!answer) {
        if (!question.required) return '';
        logger.warn('a value is required');
        continue;
      }
      const problem = question.validate?.(answer);
      if (problem) {
        logger.warn(problem);
        continue;
      }
      return answer;
    }
    throw new Error(`no valid answer after ${MAX_ATTEMPTS} attempts - giving up`);
  }
  return { io: { isInteractive: terminal.isInteractive, logger, ask }, warnings };
}

/**
 * HOST STAND-IN. Restates `renderConfigBlock`
 * (`packages/cli/src/config-block.ts`): two-space indent for the key, four
 * for each entry, a comma between entries and never after the last, an
 * optional ` // comment` suffix.
 */
function renderBlock(key: string, entries: readonly ConfigBlockEntry[]): string {
  if (entries.length === 0) return `  "${key}": {}`;
  const body = entries.map((entry, i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    const comment = entry.comment ? ` // ${entry.comment}` : '';
    return `    ${entry.property}${comma}${comment}`;
  });
  return [`  "${key}": {`, ...body, '  }'].join('\n');
}

/**
 * HOST STAND-IN. Restates `renderConfig`'s composition
 * (`packages/cli/src/init.ts`): the core entries first, then every plugin
 * block, each item carrying its own trailing comma except the last - the
 * comma discipline a declining contributor must not disturb.
 */
function composeDocument(blocks: readonly string[]): string {
  const items = ['  "region": "us-east-1"', '  "siteName": "example"', ...blocks];
  const body = items.map((item, i) => `${item}${i === items.length - 1 ? '' : ','}`);
  return ['{', ...body, '}', ''].join('\n');
}

/** Drive the contributor over a scripted answer set, exactly as a host would. */
async function runContributor(
  answers: string[],
  options: { interactive?: boolean } = {},
): Promise<{ entries: ConfigBlockEntry[]; terminal: ScriptedTerminal; warnings: string[] }> {
  const terminal = createScriptedTerminal({ answers, interactive: options.interactive ?? true });
  const { io, warnings } = createInitIo(terminal);
  const contributor = analyticsPlugin.init;
  if (!contributor) throw new Error('the analytics plugin declares no init(io) contributor');
  const entries = await contributor(io);
  return { entries, terminal, warnings };
}

describe('discovery: the manifest field and the default export', () => {
  it('declares the blogwright.plugin manifest field, matching the pattern core enforces', async () => {
    // Read the way discovery reads it - through the FileSystem port, off the
    // same `package.json` `ModuleLoader.packageJsonPathFor` resolves - rather
    // than through a JSON import, so the shipped file is what is asserted.
    const manifest = await readPackageManifest();
    expect(manifest['name']).toBe(PACKAGE_NAME);
    expect(manifest['blogwright']).toEqual({ plugin: 'analytics' });
    const declared = (manifest['blogwright'] as { plugin: string }).plugin;
    expect(PLUGIN_NAME_PATTERN.test(declared)).toBe(true);
    expect(declared).toBe(analyticsPlugin.name);
  });

  it('names the CLI package in neither dependencies nor devDependencies', async () => {
    const manifest = await readPackageManifest();
    for (const field of ['dependencies', 'devDependencies']) {
      expect(Object.keys((manifest[field] ?? {}) as Record<string, string>)).not.toContain(
        'blogwright',
      );
    }
  });

  it('passes validatePlugin when loaded as discovery loads it: the module, then its default', () => {
    // `loadCandidate` (`packages/cli/src/plugins.ts`) hands the whole loaded
    // MODULE to `validatePlugin`, not the default export, and names the
    // package so a rejection says which one is broken.
    const plugin = validatePlugin(analyticsModule, PACKAGE_NAME);
    expect(plugin).toBe(analyticsPlugin);
    expect(plugin.name).toBe('analytics');
    expect(plugin.configKey).toBe('analytics');
    expect(plugin.description.length).toBeGreaterThan(0);
  });
});

describe('the command table', () => {
  it('declares exactly status, dashboard and backfill, in table order', () => {
    expect(analyticsPlugin.commands.map((command) => command.action)).toEqual(DECLARED_ACTIONS);
  });

  it('declares none of the action names the CLI reserves', () => {
    const declared = analyticsPlugin.commands.map((command) => command.action);
    for (const reserved of RESERVED_ACTIONS) {
      expect(declared).not.toContain(reserved);
    }
  });

  it('declares no init command, so the generic config-block splice is what `analytics init` reaches', () => {
    // The three preconditions `runPlugin`/`runGenericInit`
    // (`packages/cli/src/plugin-commands.ts`) read, restated as assertions:
    // `matchAction` must find no `init` command, `plugin.init` must be a
    // function, and `plugin.configKey` must name the block the answers are
    // filed under. A declared `init` command would satisfy `matchAction`
    // first and then write nothing at all.
    expect(analyticsPlugin.commands.some((command) => command.action === 'init')).toBe(false);
    expect(typeof analyticsPlugin.init).toBe('function');
    expect(analyticsPlugin.configKey).toBe('analytics');
  });

  it('contributes the node graph, which is the single gate all three generic lifecycle verbs share', () => {
    // `genericLifecycleCommand`/`genericLifecycleActions`
    // (`packages/cli/src/plugin-commands.ts`) both return nothing for a
    // plugin with no `nodes`, so `analytics bootstrap`/`destroy` were
    // neither answered nor advertised until task 54 wired this. `analytics
    // status` is answered either way, because it is declared rather than
    // generic.
    //
    // Identity, not merely presence, and for `validateConfig`'s reason one
    // block down: a wrapper could filter or re-order the set on its way to
    // the engine and no other assertion in this file would see it. The set
    // itself - the twelve ids, their edges and their titles - belongs to
    // `commands.test.ts`, which owns the graph-shape suite.
    expect(analyticsPlugin.nodes).toBe(buildAnalyticsNodes);
    expect(buildAnalyticsNodes()).toHaveLength(ANALYTICS_NODE_COUNT);
  });

  it('points each action at its named body in commands.ts', () => {
    const runners = new Map(
      analyticsPlugin.commands.map((command) => [command.action, command.run]),
    );
    expect(runners.get('status')).toBe(status);
    expect(runners.get('dashboard')).toBe(dashboard);
    expect(runners.get('backfill')).toBe(backfill);
  });

  it('refuses from each body that has not landed yet, naming the task that lands it', async () => {
    // `dashboard` is deliberately absent from this list: task 56 landed its
    // body, so it no longer refuses - it starts a listener, and
    // `commands.test.ts` drives it. The table entry above still points at it,
    // which is the half of task 47's contract this file keeps pinning.
    await expect(status()).rejects.toThrow(
      'blogwright analytics status is not implemented yet - task 55 lands this command',
    );
    await expect(backfill()).rejects.toThrow(
      'blogwright analytics backfill is not implemented yet - task 61 lands this command',
    );
  });

  it('gives the plugin and every action a one-line summary that fits a `blogwright --help` line', () => {
    // `renderPluginSection` renders `  <name> - <description>` and then
    // `    <action> - <summary>` per command. The description is a help line
    // like any other, so it is held to the same width - the cap belongs to
    // the terminal, not to the kind of line.
    expect(analyticsPlugin.description).not.toContain('\n');
    const heading = `${' '.repeat(PLUGIN_LINE_INDENT)}${analyticsPlugin.name} - ${analyticsPlugin.description}`;
    expect(heading.length).toBeLessThanOrEqual(MAX_HELP_LINE_WIDTH);

    for (const command of analyticsPlugin.commands) {
      expect(command.summary.length).toBeGreaterThan(0);
      expect(command.summary).not.toContain('\n');
      const rendered = `${' '.repeat(HELP_LINE_INDENT)}${command.action} - ${command.summary}`;
      expect(rendered.length).toBeLessThanOrEqual(MAX_HELP_LINE_WIDTH);
    }
  });

  it('states no --yes, because precedence left it no destructive action', () => {
    // `--yes` belongs in the summary of any destructive action precedence
    // left to the plugin. It left none: `destroy` is always generic, so no
    // summary here may claim a flag its action does not read.
    for (const command of analyticsPlugin.commands) {
      expect(command.summary).not.toContain('--yes');
    }
  });
});

describe('validateConfig is the task 44 validator, bound', () => {
  it('is validateAnalyticsConfig itself, not a wrapper around it', () => {
    // Identity, not behaviour. A wrapper that reshaped or re-defaulted the
    // block would drop the module-private symbol `resolveAnalyticsConfig`
    // unseals, and the failure would surface far downstream, at the first
    // node to resolve a bucket name.
    expect(analyticsPlugin.validateConfig).toBe(validateAnalyticsConfig);
  });

  it('rejects a bad block with the message the validator raises', () => {
    expect(() => validateBlock({ bots: 'ignore' })).toThrow(
      'config.analytics.bots must be one of flag, filter, got "ignore"',
    );
  });

  it('resolves end to end for an operator whose config carries no analytics key', () => {
    // `resolvePluginConfig` (`packages/cli/src/plugins.ts`) reads the block
    // with `pluginBlock`, a plain property read, so an absent key arrives as
    // `undefined` - not `{}`. The binding has to survive that, or an operator
    // who never wrote an `analytics` block gets one the resolver refuses.
    const resolved = resolveAnalyticsConfig({
      env: 'staging',
      config: siteConfig(),
      pluginConfig: validateBlock(undefined),
    });
    expect(resolved).toEqual({
      tableBucket: 'staging-example-analytics',
      namespace: 'web',
      table: 'page_views',
      bots: 'flag',
      saltSecretName: 'example/staging/analytics-salt',
      dashboard: { port: 4317 },
    });
  });
});

describe('the init contributor', () => {
  it('offers the task 44 defaults and returns the block an all-defaults answer set produces', async () => {
    const { entries, terminal } = await runContributor(['', '', '', '', '']);
    expect(terminal.prompts).toEqual([
      'set up analytics now? CloudFront access logs into an Iceberg table (y/n) [y]: ',
      'Iceberg namespace holding the table [web]: ',
      'Iceberg table the page views land in [page_views]: ',
      'bot traffic in dashboard queries - flag (keep, marked) or filter (excluded) [flag]: ',
      'port the local dashboard listens on [4317]: ',
    ]);
    expect(entries).toEqual([
      { property: '"namespace": "web"', comment: 'Iceberg namespace holding the table' },
      { property: '"table": "page_views"', comment: 'Iceberg table the page views land in' },
      {
        property: '"bots": "flag"',
        comment: 'flag keeps bot rows and marks them; filter excludes them from queries',
      },
      {
        property: '"dashboard": { "port": 4317 }',
        comment: 'the dashboard binds 127.0.0.1 on this port',
      },
    ]);
  });

  it('offers defaults read off the validator, rather than literals restated here', async () => {
    // The offered VALUES are pinned by the test above. The mechanism cannot
    // be pinned by behaviour - restating the four literals here produces the
    // same prompts by construction, which is exactly why drift would be
    // invisible - so it is pinned on the source: the defaults come from
    // `validateAnalyticsConfig(undefined)`, the same call the CLI makes for
    // an operator whose config carries no `analytics` key, and every prompt
    // but the set-up-now question reads its default off that result.
    const source = await createNodeFileSystem().readText(PLUGIN_SOURCE_PATH);
    expect(source).toContain('const defaults = validateAnalyticsConfig(undefined)');
    const offered = source.split('\n').filter((line) => line.includes('defaultValue:'));
    expect(offered).toHaveLength(5);
    expect(offered.filter((line) => line.includes('defaults.'))).toHaveLength(4);
  });

  it('returns the customised block when the operator answers every question', async () => {
    const { entries } = await runContributor(['yes', 'blog', 'hits', 'filter', '8080']);
    expect(entries.map((entry) => entry.property)).toEqual([
      '"namespace": "blog"',
      '"table": "hits"',
      '"bots": "filter"',
      '"dashboard": { "port": 8080 }',
    ]);
  });

  it('re-prompts with the message the config validator raises', async () => {
    const { entries, warnings } = await runContributor([
      'y',
      'Not Valid',
      'web',
      'page_views',
      'flag',
      '4317',
    ]);
    expect(warnings).toEqual([
      'config.analytics.namespace must be lowercase alphanumeric/underscores, got "Not Valid"',
    ]);
    expect(entries[0]).toEqual({
      property: '"namespace": "web"',
      comment: 'Iceberg namespace holding the table',
    });
  });

  it('re-prompts a table name the validator rejects, and the typed text reaches no entry', async () => {
    // The `table` prompt's own pin. Each answer is interpolated into JSON
    // text, so the validator is not merely a convenience: what it lets
    // through is what the composed document says. Hence the consequence is
    // asserted first, and the operator-facing message second.
    const { entries, warnings } = await runContributor([
      'y',
      'web',
      'Page Views',
      'page_views',
      'flag',
      '4317',
    ]);
    expect(entries[1]).toEqual({
      property: '"table": "page_views"',
      comment: 'Iceberg table the page views land in',
    });
    expect(composeDocument([renderBlock('analytics', entries)])).not.toContain('Page Views');
    expect(warnings).toEqual([
      'config.analytics.table must be lowercase alphanumeric/underscores, got "Page Views"',
    ]);
  });

  it('re-prompts a bots mode the validator rejects, and the typed text reaches no entry', async () => {
    // The `bots` prompt's own pin. `flag` and `filter` are the only two modes
    // the dashboard's queries know how to read, and the block reaches disk
    // without the validator ever running again on this path.
    const { entries, warnings } = await runContributor([
      'y',
      'web',
      'page_views',
      'ignore',
      'filter',
      '4317',
    ]);
    expect(entries[2]).toEqual({
      property: '"bots": "filter"',
      comment: 'flag keeps bot rows and marks them; filter excludes them from queries',
    });
    expect(composeDocument([renderBlock('analytics', entries)])).not.toContain('ignore');
    expect(warnings).toEqual(['config.analytics.bots must be one of flag, filter, got "ignore"']);
  });

  it('quotes a non-numeric port back to the operator rather than NaN', async () => {
    const { warnings } = await runContributor(['y', 'web', 'page_views', 'flag', 'eighty', '4317']);
    expect(warnings).toEqual([
      'config.analytics.dashboard.port must be in 1024..65535, got "eighty"',
    ]);
  });

  it('renders the port from the parsed number, so a padded answer stays legal JSON', async () => {
    const { entries } = await runContributor(['y', 'web', 'page_views', 'flag', '04317']);
    expect(entries.at(-1)?.property).toBe('"dashboard": { "port": 4317 }');
  });

  it('returns an empty array - never undefined - when the operator declines', async () => {
    const { entries, terminal } = await runContributor(['n']);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toEqual([]);
    expect(terminal.prompts).toHaveLength(1);
  });

  it('declines without asking anything when the session is not interactive', async () => {
    const { entries, terminal, warnings } = await runContributor([], { interactive: false });
    expect(entries).toEqual([]);
    expect(terminal.prompts).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('blogwright analytics init');
  });

  it('performs no filesystem write of its own', async () => {
    // The module reaches no filesystem at all. Adding a `ctx.ports.fs` read,
    // an `fs.writeText` call or a `node:fs` import to `plugin.ts` fails this
    // immediately (`node:fs` is separately barred for this package by
    // `.oxlintrc.json`'s `no-restricted-imports`).
    //
    // Handing the contributor an in-memory `FileSystem` and asserting it was
    // left unwritten is deliberately NOT done: `PluginInitIo` carries no
    // `fs`, so such an assertion could not fail whatever `plugin.ts` did.
    // That clause is discharged by the type, and this grep is the part of it
    // a change to this module can still break.
    const source = await createNodeFileSystem().readText(PLUGIN_SOURCE_PATH);
    for (const forbidden of ['node:fs', 'ports.fs', 'writeText']) {
      expect(source).not.toContain(forbidden);
    }
  });
});

describe('the answered block, composed the way a host composes it', () => {
  it('re-parses cleanly and validates back through the plugin validator', async () => {
    const { entries } = await runContributor(['y', 'blog', 'hits', 'filter', '8080']);
    const document = composeDocument([renderBlock('analytics', entries)]);

    // The gate both host paths apply before anything reaches disk: `initSite`
    // and `runGenericInit` each re-parse the composed text first, so a
    // malformed block never becomes an unloadable config file.
    const parsed = parseConfigDocument(document);
    expect(parsed.config.siteName).toBe('example');

    // Round trip: the block this contributor answered is one this plugin's
    // own validator accepts and the resolver completes.
    const resolved = resolveAnalyticsConfig({
      env: 'production',
      config: parsed.config,
      pluginConfig: validateBlock(pluginBlock(parsed.raw, 'analytics')),
    });
    expect(resolved).toEqual({
      tableBucket: 'production-example-analytics',
      namespace: 'blog',
      table: 'hits',
      bots: 'filter',
      saltSecretName: 'example/production/analytics-salt',
      dashboard: { port: 8080 },
    });
  });

  it('refuses an answer that would splice a second, unasked setting into the block', async () => {
    // What the `table` validator is really holding shut. The answer below
    // closes its own JSON string and opens `tableBucket` - a legitimate key,
    // so a spliced one survives BOTH the host's re-parse and
    // `validateAnalyticsConfig` and lands on disk. That is the field task 44
    // sealed behind a module-private symbol so that no code path could
    // produce an env-less bucket name, and an env-less one is staging and
    // production sharing a single Iceberg table: `blogwright analytics
    // destroy --yes` run in staging then issues `DeleteTableBucket` against
    // production's data. The wizard must not be the path that writes past a
    // seal the rest of this package cannot bypass.
    const splice = 'x", "tableBucket": "evil';
    const { entries, warnings } = await runContributor([
      'y',
      'web',
      splice,
      'page_views',
      'flag',
      '4317',
    ]);
    // Asserted on the document the host would write, not on the prompt's
    // return: it is the document that reaches disk.
    const document = composeDocument([renderBlock('analytics', entries)]);
    expect(document).not.toContain('tableBucket');

    // And the seal still holds where it is read: the bucket the resolver
    // derives carries the environment, because the block names none.
    const parsed = parseConfigDocument(document);
    const resolved = resolveAnalyticsConfig({
      env: 'staging',
      config: parsed.config,
      pluginConfig: validateBlock(pluginBlock(parsed.raw, 'analytics')),
    });
    expect(resolved.tableBucket).toBe('staging-example-analytics');

    expect(warnings).toEqual([
      `config.analytics.table must be lowercase alphanumeric/underscores, got "${splice}"`,
    ]);
  });

  it('leaves no stray comma and no key behind when the operator declines', async () => {
    const { entries } = await runContributor(['n']);
    // A declining contributor contributes no block at all - both host paths
    // skip an empty array before `renderConfigBlock` is reached - so the
    // document is byte-identical to the one with no plugin installed.
    const blocks = entries.length === 0 ? [] : [renderBlock('analytics', entries)];
    const document = composeDocument(blocks);
    expect(document).toBe(composeDocument([]));
    expect(document).not.toContain('analytics');
    expect(parseConfigDocument(document).raw['analytics']).toBeUndefined();
  });
});
