/**
 * This package owns the `analytics` config key end to end: its shape, its
 * defaults, and the validator core's `parseConfig` deliberately does not run
 * (`packages/core/src/config.ts:242` merges an `analytics` block through
 * untouched, so a config carrying one is valid and inert when the plugin is
 * not installed).
 *
 * **Two shapes, and why the seam between them is where it is.**
 * `validateAnalyticsConfig` is the function this package's
 * `Plugin.validateConfig` hands core's raw block to, so whatever it returns is
 * what the host puts on `ctx.pluginConfig` (`packages/core/src/plugin.ts:85-93`).
 * It applies every default it can: `namespace`, `table`, `bots` and
 * `dashboard.port` default to plain literals, so they come back total and no
 * reader downstream re-checks them for `undefined`.
 *
 * `tableBucket` and `saltSecretName` cannot be defaulted there. Both carry the
 * environment, and the SPI hands `validateConfig` the block and nothing else -
 * no `env`, no `siteName`. So an operator's overrides for those two are
 * carried under {@link ENV_DERIVED}, a symbol this module does not export, and
 * {@link resolveAnalyticsConfig} - which takes the plugin context, and
 * therefore always has the environment - is the only way to a bucket name or a
 * salt name.
 *
 * That sealing is load-bearing, not tidiness. Were `tableBucket` merely
 * optional on the validated block, a node downstream could write
 * ``ctx.pluginConfig.tableBucket ?? `${ctx.config.siteName}-analytics` `` and
 * it would compile, typecheck and pass its own tests - and staging would then
 * resolve to production's bucket. With the field absent from the type, that
 * read is `TS2339: Property 'tableBucket' does not exist on type
 * 'AnalyticsConfig'`, which `pnpm typecheck` fails on; `config.test.ts` pins
 * the diagnostic so the seal cannot be opened silently.
 *
 * **Every derived default carries the environment**, matching `deriveNames`'
 * `<env>-<siteName>` prefix (`packages/core/src/config.ts:352`):
 * `tableBucket` is `<env>-<siteName>-analytics` and `saltSecretName` is
 * `<siteName>/<env>/analytics-salt`. Do not "simplify" the environment out of
 * either one. Without it staging and production resolve to the *same* Iceberg
 * table and the same salt, and `blogwright analytics destroy --yes` run in
 * staging issues `DeleteTableBucket` against production's data. Nothing in the
 * system catches that: state is scoped per environment
 * (`state/<env>.analytics.json`), so each environment's state file correctly
 * records the bucket it was told to use and neither can see the collision.
 * AWS gives a second, quieter reason - it "does not recommend using multiple
 * Firehose streams to write data to the same Apache Iceberg table", because
 * Iceberg's optimistic concurrency makes the streams contend.
 *
 * Pure data and pure functions only: no `node:` builtin, no vendor SDK, no
 * `fetch`. See [the change spec's §Configuration → The `analytics`
 * block](../../../.specs/changes/2026-07-26-analytics_plugin.md).
 */

import type { PluginContext } from 'blogwright-core';

/**
 * Whether bot traffic is excluded from dashboard queries. Records are stored
 * either way. Not exported: no consumer needs the bare union today - one can
 * reach the same type as `AnalyticsConfig['bots']`. Export it once a real
 * consumer needs the union by name.
 */
type BotHandling = 'flag' | 'filter';

/**
 * The `dashboard` sub-block as an operator writes it - the raw shape
 * {@link validateDashboardPort} narrows, not the shape it returns. Not
 * exported: it exists to give {@link DASHBOARD_KEYS} a `keyof` to be pinned
 * against, so the allowed-key list and the type cannot drift apart.
 */
interface RawDashboardConfig {
  /** Port the local dashboard listens on. See {@link DEFAULT_DASHBOARD_PORT}. */
  port?: number | undefined;
}

/**
 * The `analytics` block exactly as an operator writes it, mirroring the change
 * spec's `$defs.AnalyticsConfig`: every field optional, because every one has
 * a derived or literal default, so a block of `{}` is valid. Not exported - no
 * consumer ever holds one, since `Plugin.validateConfig` takes `unknown` and
 * returns the *validated* {@link AnalyticsConfig}. It exists to give
 * {@link ANALYTICS_KEYS} a `keyof` to be pinned against, which is what makes
 * the schema's `additionalProperties: false` and this module's allowed-key
 * list one rule rather than two.
 */
interface RawAnalyticsConfig {
  /** S3 Tables bucket name. Defaults to `<env>-<siteName>-analytics`. */
  tableBucket?: string | undefined;
  /** Iceberg namespace holding the table. Defaults to {@link DEFAULT_NAMESPACE}. */
  namespace?: string | undefined;
  /** Iceberg table name. Defaults to {@link DEFAULT_TABLE}. */
  table?: string | undefined;
  /** Bot handling for dashboard queries. Defaults to {@link DEFAULT_BOTS}. */
  bots?: BotHandling | undefined;
  /**
   * Secrets Manager secret holding the `visitor_key` salt. Defaults to
   * `<siteName>/<env>/analytics-salt`, mirroring how `pds.secretName` names
   * its secret.
   */
  saltSecretName?: string | undefined;
  /** Local dashboard settings. */
  dashboard?: RawDashboardConfig | undefined;
}

/**
 * The settings whose defaults are plain literals - the ones needing no
 * environment to resolve, and so total on both the validated block and the
 * resolved config.
 */
interface EnvIndependentSettings {
  /** Iceberg namespace holding the table. */
  namespace: string;
  /** Iceberg table name. */
  table: string;
  /** Bot handling for dashboard queries. */
  bots: BotHandling;
  /** Local dashboard settings. */
  dashboard: { port: number };
}

/**
 * The two settings whose defaults carry the environment. Never readable off a
 * validated block - see {@link ENV_DERIVED}.
 */
interface EnvDerivedOverrides {
  tableBucket?: string | undefined;
  saltSecretName?: string | undefined;
}

/**
 * The key an operator's `tableBucket`/`saltSecretName` overrides ride on. A
 * module-private `unique symbol`: TypeScript emits it into `config.d.ts`
 * unexported, so no module outside this one can name it, and neither
 * `ctx.pluginConfig.tableBucket` nor `ctx.pluginConfig[ENV_DERIVED]` compiles
 * anywhere else. That is the point - see this module's doc comment for the
 * `?? <env-less fallback>` line it exists to make unwritable.
 */
const ENV_DERIVED = Symbol('analytics env-derived overrides');

/**
 * A validated `analytics` block: what {@link validateAnalyticsConfig} returns,
 * and therefore what the host puts on `ctx.pluginConfig` for this plugin. The
 * four settings whose defaults are literals are already applied and total; the
 * two that need the environment are sealed under {@link ENV_DERIVED} and reach
 * a reader only through {@link resolveAnalyticsConfig}.
 */
export interface AnalyticsConfig extends EnvIndependentSettings {
  readonly [ENV_DERIVED]: EnvDerivedOverrides;
}

/**
 * An `analytics` block with every default applied, the environment-carrying
 * ones included: the shape every reader downstream keeps a total type on, so
 * no call site re-applies a default or re-checks for `undefined`.
 */
export interface ResolvedAnalyticsConfig extends EnvIndependentSettings {
  tableBucket: string;
  saltSecretName: string;
}

/** Default Iceberg namespace. */
const DEFAULT_NAMESPACE = 'web';

/** Default Iceberg table - the one `schema.ts` describes. */
const DEFAULT_TABLE = 'page_views';

/** Default bot handling: keep bot rows, mark them, and leave filtering to the query. */
const DEFAULT_BOTS: BotHandling = 'flag';

/**
 * Default port for the local dashboard server. Exported because the dashboard
 * server binds this exact number: it imports the constant rather than
 * restating it, so the default has one home.
 */
export const DEFAULT_DASHBOARD_PORT = 4317;

/** Lowest port the dashboard may bind - anything below it needs root on Unix. */
const MIN_DASHBOARD_PORT = 1024;

/** Highest port there is. */
const MAX_DASHBOARD_PORT = 65535;

/** Shortest S3 bucket name S3 accepts. */
const TABLE_BUCKET_MIN_LENGTH = 3;

/** Longest S3 bucket name S3 accepts - the same limit `deriveNames` enforces. */
const TABLE_BUCKET_MAX_LENGTH = 63;

/**
 * S3 bucket naming, narrowed to what an S3 Tables bucket takes: lowercase
 * alphanumerics and dashes, {@link TABLE_BUCKET_MIN_LENGTH} to
 * {@link TABLE_BUCKET_MAX_LENGTH} characters. Composed from those two
 * constants rather than hard-coded inside the pattern, so the bounds have one
 * home and the rejection message quotes the same numbers the pattern enforces.
 */
const TABLE_BUCKET_PATTERN = new RegExp(
  `^[0-9a-z-]{${TABLE_BUCKET_MIN_LENGTH},${TABLE_BUCKET_MAX_LENGTH}}$`,
);

/** Iceberg identifier: an S3 Tables catalog rejects anything else. */
const IDENTIFIER_PATTERN = /^[a-z0-9_]+$/;

/** Characters permitted in a Secrets Manager secret name - the class `pds.secretName` uses. */
const SECRET_NAME_PATTERN = /^[\w/+=.@-]+$/;

/** The `bots` union, as data, so the validator and its message read one list. */
const BOTS_MODES = ['flag', 'filter'] as const satisfies readonly BotHandling[];

/** Every key the block allows - the schema's `additionalProperties: false`, as data. */
const ANALYTICS_KEYS = [
  'tableBucket',
  'namespace',
  'table',
  'bots',
  'saltSecretName',
  'dashboard',
] as const satisfies readonly (keyof RawAnalyticsConfig)[];

/** Every key the `dashboard` sub-block allows. */
const DASHBOARD_KEYS = ['port'] as const satisfies readonly (keyof RawDashboardConfig)[];

/** The site identity the environment-carrying defaults are derived from. */
interface AnalyticsSite {
  /** The environment name, as `deriveNames` receives it (e.g. `production`). */
  env: string;
  /** `config.siteName`. */
  siteName: string;
}

/**
 * The slice of a plugin context {@link resolveAnalyticsConfig} reads, taken as
 * a `Pick` of core's own `PluginContext` rather than a restatement of it, so
 * the three members cannot drift from the SPI. Any
 * `PluginContext<AnalyticsConfig>` satisfies it, so a node passes `ctx`
 * straight through. Not exported: a caller passes its context and never names
 * this type.
 */
type AnalyticsConfigContext = Pick<
  PluginContext<AnalyticsConfig>,
  'env' | 'config' | 'pluginConfig'
>;

/**
 * Narrow an `unknown` to an object. The `!== null` is the `typeof` guard's
 * usual companion, not a domain value: nothing in this module returns or
 * accepts `null` for a setting - absence is `undefined`.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Render a rejected value for a message: strings quoted, as core's messages quote them. */
function formatValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (isRecord(value) || Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

function isBotHandling(value: unknown): value is BotHandling {
  return BOTS_MODES.some((mode) => mode === value);
}

/**
 * The `tableBucket` default. Carries `env` first, matching `deriveNames`'
 * `<env>-<siteName>` prefix - see this module's doc comment for what dropping
 * it destroys.
 */
function defaultTableBucket(site: AnalyticsSite): string {
  return `${site.env}-${site.siteName}-analytics`;
}

/**
 * The `saltSecretName` default. Carries `env` as a path segment, so two
 * environments hash `visitor_key` with two different salts.
 */
function defaultSaltSecretName(site: AnalyticsSite): string {
  return `${site.siteName}/${site.env}/analytics-salt`;
}

/**
 * Validate a raw `analytics` config block, boundary-checked as `unknown`
 * because it comes off `parseConfigDocument`'s `raw` half (a plugin's block
 * has no type until its own package narrows it). An absent block validates as
 * an empty one, so installing the plugin without writing an `analytics` key is
 * valid.
 *
 * Applies the four literal defaults, so `namespace`, `table`, `bots` and
 * `dashboard.port` are total on the returned block. `tableBucket` and
 * `saltSecretName` are validated here too, but sealed under
 * {@link ENV_DERIVED}: their defaults carry the environment, which this
 * signature does not, so {@link resolveAnalyticsConfig} is where they resolve.
 *
 * Raises in the repo's vocabulary (`packages/core/src/config.ts:274-340`),
 * naming the offending key and value.
 */
export function validateAnalyticsConfig(raw: unknown): AnalyticsConfig {
  const block = raw === undefined ? {} : raw;
  if (!isRecord(block)) {
    throw new Error(`config.analytics must be an object, got ${formatValue(block)}`);
  }
  for (const key of Object.keys(block)) {
    if (!ANALYTICS_KEYS.some((known) => known === key)) {
      throw new Error(
        `config.analytics.${key} is not a known setting - allowed keys are ${ANALYTICS_KEYS.join(', ')}`,
      );
    }
  }

  return {
    namespace: validateIdentifier(block['namespace'], 'namespace') ?? DEFAULT_NAMESPACE,
    table: validateIdentifier(block['table'], 'table') ?? DEFAULT_TABLE,
    bots: validateBots(block['bots']) ?? DEFAULT_BOTS,
    dashboard: { port: validateDashboardPort(block['dashboard']) },
    [ENV_DERIVED]: validateEnvDerivedOverrides(block),
  };
}

/**
 * Validate the two settings whose defaults need the environment, returning
 * them as the sealed overrides {@link resolveAnalyticsConfig} later reads. An
 * absent setting stays absent: this function has no environment to default it
 * with, which is the whole reason the seal exists.
 */
function validateEnvDerivedOverrides(raw: Record<string, unknown>): EnvDerivedOverrides {
  const overrides: EnvDerivedOverrides = {};

  const tableBucket = raw['tableBucket'];
  if (tableBucket !== undefined) {
    if (typeof tableBucket !== 'string' || !TABLE_BUCKET_PATTERN.test(tableBucket)) {
      throw new Error(
        `config.analytics.tableBucket must be ${TABLE_BUCKET_MIN_LENGTH}..${TABLE_BUCKET_MAX_LENGTH} lowercase alphanumeric/dash characters, got ${formatValue(tableBucket)}`,
      );
    }
    overrides.tableBucket = tableBucket;
  }

  const saltSecretName = raw['saltSecretName'];
  if (saltSecretName !== undefined) {
    // Same character class and same message shape as `config.pds.secretName`
    // (`packages/core/src/config.ts:337`): both name a Secrets Manager secret,
    // so an operator who has hit one message recognises the other.
    if (typeof saltSecretName !== 'string' || !SECRET_NAME_PATTERN.test(saltSecretName)) {
      throw new Error(
        `config.analytics.saltSecretName has invalid characters: ${formatValue(saltSecretName)}`,
      );
    }
    overrides.saltSecretName = saltSecretName;
  }

  return overrides;
}

/**
 * Validate an Iceberg identifier (`namespace`, `table`), returning `undefined`
 * when the setting is absent so the caller applies its own named default.
 */
function validateIdentifier(raw: unknown, key: 'namespace' | 'table'): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !IDENTIFIER_PATTERN.test(raw)) {
    throw new Error(
      `config.analytics.${key} must be lowercase alphanumeric/underscores, got ${formatValue(raw)}`,
    );
  }
  return raw;
}

/** Validate the `bots` setting, returning `undefined` when it is absent. */
function validateBots(raw: unknown): BotHandling | undefined {
  if (raw === undefined) return undefined;
  if (!isBotHandling(raw)) {
    throw new Error(
      `config.analytics.bots must be one of ${BOTS_MODES.join(', ')}, got ${formatValue(raw)}`,
    );
  }
  return raw;
}

/**
 * Validate the `dashboard` sub-block and return the port it settles on -
 * {@link DEFAULT_DASHBOARD_PORT} when the sub-block or the setting is absent.
 * Split out to keep the validator at one level of detail.
 */
function validateDashboardPort(raw: unknown): number {
  if (raw === undefined) return DEFAULT_DASHBOARD_PORT;
  if (!isRecord(raw)) {
    throw new Error(`config.analytics.dashboard must be an object, got ${formatValue(raw)}`);
  }
  for (const key of Object.keys(raw)) {
    if (!DASHBOARD_KEYS.some((known) => known === key)) {
      throw new Error(
        `config.analytics.dashboard.${key} is not a known setting - allowed keys are ${DASHBOARD_KEYS.join(', ')}`,
      );
    }
  }
  const port = raw['port'];
  if (port === undefined) return DEFAULT_DASHBOARD_PORT;
  // One message for one validity condition: an integer inside the range. A
  // fractional or non-numeric port is outside that range as much as `80` is.
  // The `typeof` does the narrowing `Number.isInteger` does not - its lib
  // signature returns `boolean`, not a predicate - so at runtime it is
  // redundant with the next clause, which already rejects every non-number.
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < MIN_DASHBOARD_PORT ||
    port > MAX_DASHBOARD_PORT
  ) {
    throw new Error(
      `config.analytics.dashboard.port must be in ${MIN_DASHBOARD_PORT}..${MAX_DASHBOARD_PORT}, got ${formatValue(port)}`,
    );
  }
  return port;
}

/**
 * Unseal the environment-carrying overrides off a validated block, rejecting a
 * block that never went through {@link validateAnalyticsConfig}.
 *
 * The type says that cannot happen and the runtime says otherwise, because the
 * one seam that fills `ctx.pluginConfig` erases `TConfig`: the CLI dispatches
 * over `Plugin<unknown>` and `toPluginContext(ops)` returns
 * `PluginContext<unknown>` (`packages/cli/src/plugin-commands.ts:241,466`), so
 * an unvalidated block passes the compiler exactly there - and
 * {@link resolveAnalyticsConfig} is exported, so a caller can hand one over
 * directly too. Such a block carries neither this symbol nor the four literal
 * defaults, and without this check the first read raised `TypeError: Cannot
 * read properties of undefined (reading 'tableBucket')` - an internal field
 * name and no fix.
 *
 * Nothing is recovered here, deliberately. The literal defaults are missing on
 * that block as well, so a fabricated one would carry `undefined` at runtime
 * for `namespace`, `table`, `bots` and `dashboard.port` - fields whose type
 * says total - and every reader downstream trusts that type. A throw naming
 * the function that must run first is loud; a recovered block is silently
 * wrong.
 */
function unsealEnvDerivedOverrides(block: AnalyticsConfig): EnvDerivedOverrides {
  // Justified by the line below, which is the validation: the declared type
  // has no `undefined` here precisely because a validated block always has it.
  const overrides = (block as Partial<AnalyticsConfig>)[ENV_DERIVED];
  if (overrides === undefined) {
    throw new Error(
      'analytics config was not validated: ctx.pluginConfig must come from validateAnalyticsConfig, which applies the defaults this resolver reads',
    );
  }
  return overrides;
}

/**
 * Resolve the environment-carrying settings a validated block sealed, giving
 * the total config every reader downstream holds. Takes the plugin context
 * rather than a `{ env, siteName }` pair, so the site identity is read out of
 * `ctx` in one place instead of at each call site and no caller can supply an
 * environment other than the one it is running in.
 *
 * Raises when handed a block the validator did not produce - see
 * {@link unsealEnvDerivedOverrides}.
 *
 * The derived bucket name is length-checked here, where it is derived, exactly
 * as `deriveNames` checks the site bucket it derives
 * (`packages/core/src/config.ts:355`). Only the length is checked: `env` and
 * `siteName` are already held to `^[a-z0-9-]+$` by `deriveNames` and
 * `validateConfig`, and a second character check here would be a second home
 * for a rule core already owns.
 */
export function resolveAnalyticsConfig(ctx: AnalyticsConfigContext): ResolvedAnalyticsConfig {
  const site: AnalyticsSite = { env: ctx.env, siteName: ctx.config.siteName };
  const block = ctx.pluginConfig;
  const overrides = unsealEnvDerivedOverrides(block);
  const tableBucket = overrides.tableBucket ?? defaultTableBucket(site);
  if (tableBucket.length > TABLE_BUCKET_MAX_LENGTH) {
    throw new Error(
      `derived analytics table bucket "${tableBucket}" exceeds S3's ${TABLE_BUCKET_MAX_LENGTH}-char limit; shorten env or siteName`,
    );
  }
  return {
    tableBucket,
    namespace: block.namespace,
    table: block.table,
    bots: block.bots,
    saltSecretName: overrides.saltSecretName ?? defaultSaltSecretName(site),
    dashboard: { port: block.dashboard.port },
  };
}
