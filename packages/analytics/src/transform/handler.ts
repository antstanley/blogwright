/**
 * The Firehose transform Lambda's envelope: the batch handler that wraps
 * `mapRecord`. This is step 5 of
 * [§Record transformation](../../../../.specs/changes/2026-07-26-analytics_plugin.md) -
 * "drops records the schema cannot accept, emitting them to the Firehose error
 * prefix rather than failing the batch" - plus the cold-start secret read step
 * 3 calls for.
 *
 * It owns four things and nothing else: the envelope types, the base64 and
 * JSON boundary, the cold-start read of the long-lived salt secret, and the
 * translation of one `MapRecordResult` into one Firehose response entry. Every
 * decision about *what a row is* - which field fills which column, which
 * values are unusable, how `visitor_key` is derived and under which day's salt
 * - belongs to `map-record.ts` and is forwarded here, never re-decided.
 *
 * ## The two outcomes, and why they are different
 *
 * Firehose's per-record vocabulary distinguishes them and so does this module:
 *
 * - **`Ok`** carries the mapped row, re-encoded. Firehose writes it.
 * - **`ProcessingFailed`** carries no data. Firehose writes the *original*
 *   record to the error prefix and delivers the rest of the batch. That is the
 *   visible data-quality signal a record the schema cannot accept should
 *   produce.
 *
 * Firehose's third result, `Dropped`, is deliberately unused: it discards the
 * record silently, which is the failure mode this whole pipeline is written
 * against. A record that cannot be mapped must end up somewhere an operator
 * can read it.
 *
 * `recordId` is echoed verbatim onto every entry, `Ok` and `ProcessingFailed`
 * alike. Firehose discards a response whose ids do not match the request's -
 * not the mismatched entry, the response - so an id dropped from a failed
 * entry loses the whole batch.
 *
 * ## Why there is no try/catch around the mapping
 *
 * `dailySalt` and `visitorKey` throw on an empty secret, day, IP or salt
 * (`visitor-key.ts`), because an unsalted digest that looks protected is worse
 * than a failed batch: the table stores `user_agent` in the clear beside
 * `visitor_key`, and an unsalted SHA-256 of an IPv4 address is a lookup table
 * over a 2^32 space. A blanket catch around `mapRecord` would convert those
 * throws into `ProcessingFailed` for every record - the whole batch to the
 * error prefix, no error anywhere, an empty dashboard, and nothing to say why.
 * So the only `try` in this module is the one around `JSON.parse`, which is
 * this module's own boundary. A throw from the mapping propagates, the
 * invocation fails, and Firehose retries the batch and raises its own error
 * metric. Loudly is the point.
 *
 * The same reasoning governs the secret: a failed or empty read fails the
 * batch. There is no unsalted or date-only fallback, because a fallback would
 * write unprotected data that looks protected, and no reprocessing could
 * repair rows already written under it.
 *
 * ## No AWS SDK, no network, no clock
 *
 * The envelope types below are repo-owned declarations, not `@types/aws-lambda`
 * - the package takes no dependency for a shape this small and this stable.
 * The one thing this module cannot do without is the secret, and it reaches it
 * through {@link SaltSecretStore}, a structural slice of core's own client
 * (the `packages/pds/src/secret.ts` precedent). That import is type-only, so it
 * erases at compile: this module carries no client, no signer and no transport,
 * and its tests stub the store with a plain object rather than mocking a module
 * or reaching a cloud.
 *
 * Which also means this module is not a composition root. Binding a real
 * `SecretsManagerClient` - built over the us-east-1 signer, since the function
 * and its secret both live there - is the bundle entry's job, and it is the
 * caller that hands the constructed handler to Lambda.
 */

import type { SecretsManagerClient } from 'blogwright-core';

import { type CloudFrontRecord, mapRecord } from './map-record.js';

/**
 * One record as Firehose sends it. The event carries more - `invocationId`,
 * `deliveryStreamArn`, `region`, and per-record source metadata - and this
 * handler reads none of it, so none of it is declared: a field spelled here
 * and never read is a field a later reader would believe is load-bearing.
 */
interface FirehoseTransformRecord {
  /** Firehose's id for this record. Echoed onto the response entry unchanged. */
  readonly recordId: string;
  /** The record's payload, base64-encoded. */
  readonly data: string;
}

/** The transform invocation's payload: one buffer of records to translate. */
export interface FirehoseTransformRequest {
  readonly records: readonly FirehoseTransformRecord[];
}

/**
 * What Firehose does with one record. `Dropped` exists in the API and is not
 * offered here - see the module comment.
 */
type FirehoseRecordResult = 'Ok' | 'ProcessingFailed';

/** Firehose writes the record. */
const OK: FirehoseRecordResult = 'Ok';

/** Firehose writes the *original* record to the error prefix and carries on. */
const PROCESSING_FAILED: FirehoseRecordResult = 'ProcessingFailed';

/** One record's outcome, in Firehose's vocabulary. */
interface FirehoseTransformedRecord {
  /** The request entry's id, unchanged. */
  readonly recordId: string;
  readonly result: FirehoseRecordResult;
  /** The transformed payload, base64-encoded. Present only for `Ok`. */
  readonly data?: string | undefined;
}

/** The transform's response: one entry per request record, in request order. */
export interface FirehoseTransformResponse {
  readonly records: readonly FirehoseTransformedRecord[];
}

/**
 * The read this handler needs, as a structural slice of core's client rather
 * than a hand-rolled function type, so the seam is checked against the real
 * `SecretsManagerClient` and a test satisfies it with a plain object.
 */
export type SaltSecretStore = Pick<SecretsManagerClient, 'getSecretValue'>;

/**
 * The environment variable naming the Secrets Manager secret behind
 * `visitor_key`, set on the function by the `analytics-transform-function`
 * node (task 50). The *name* travels in the environment; the value never does,
 * so it cannot be read off the function's configuration.
 */
export const SALT_SECRET_NAME_ENV = 'ANALYTICS_SALT_SECRET_NAME';

/** The environment as the runtime hands it over. */
type Environment = Readonly<Record<string, string | undefined>>;

/** The secret's name, or a failure naming the variable that should carry it. */
function requireSaltSecretName(env: Environment): string {
  const name = env[SALT_SECRET_NAME_ENV]?.trim();
  if (name === undefined || name === '') {
    throw new Error(
      `the analytics transform needs the salt secret's name in ${SALT_SECRET_NAME_ENV}: without it every visitor_key would be unsalted, so the function refuses to start`,
    );
  }
  return name;
}

/**
 * The stored secret, or a failure. Never the empty string and never a
 * substitute: `dailySalt` would throw on a blank secret anyway, and this says
 * which secret is blank and how to fix it.
 *
 * The value is returned untrimmed. It is opaque key material, and trimming it
 * would derive a different salt from the same secret - orphaning every
 * `visitor_key` already written.
 */
async function loadSaltSecret(secrets: SaltSecretStore, secretName: string): Promise<string> {
  const secret = await secrets.getSecretValue(secretName);
  if (secret === undefined || secret.trim() === '') {
    throw new Error(
      `the analytics salt secret "${secretName}" holds no value: an unsalted visitor_key would identify the visitor it exists to hide, so this batch fails instead - run \`blogwright analytics bootstrap\` to create the secret`,
    );
  }
  return secret;
}

/**
 * The record's payload as an object, or `undefined` when it is not one.
 *
 * `Buffer.from(data, 'base64')` never throws - it ignores what it cannot
 * decode - so a corrupt payload surfaces here as JSON that will not parse.
 * `mapRecord` documents that it trusts its record to be an object and that
 * parsing is this module's boundary, which is why a non-object payload (a
 * bare number, `null`, an array) is rejected here rather than there.
 *
 * This `try` covers `JSON.parse` and nothing else. Widening it to cover the
 * mapping would turn `visitor-key.ts`'s deliberate throws into silent drops.
 */
function decodePayload(data: string): CloudFrontRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return parsed as CloudFrontRecord;
}

/**
 * One record in, one response entry out. The record is mapped with the whole
 * batch's secret but under its *own* day's salt, which `mapRecord` derives
 * from the record's own `timestamp(ms)` - a buffer that straddles midnight
 * carries records of two days, and one salt chosen per invocation would be the
 * wrong day's for every record on the far side of it.
 */
function transformRecord(
  record: FirehoseTransformRecord,
  saltSecret: string,
): FirehoseTransformedRecord {
  const payload = decodePayload(record.data);
  if (payload === undefined) return { recordId: record.recordId, result: PROCESSING_FAILED };

  const mapped = mapRecord(payload, saltSecret);
  if (!mapped.mapped) return { recordId: record.recordId, result: PROCESSING_FAILED };

  return {
    recordId: record.recordId,
    result: OK,
    data: Buffer.from(JSON.stringify(mapped.row), 'utf8').toString('base64'),
  };
}

/**
 * Build the Lambda entry point over a Secrets Manager read.
 *
 * The secret's name is resolved now, so a function deployed without
 * {@link SALT_SECRET_NAME_ENV} fails at initialisation rather than once per
 * batch. Its *value* is read on the first invocation and cached for the life
 * of the execution environment: a 60-second Firehose buffer is roughly 43,000
 * invocations a month, so reading per invocation would spend more than half
 * the price of the secret itself again on `GetSecretValue` calls, for nothing.
 *
 * A failed read is not cached. Caching the failure would let one throttled
 * call disable an execution environment for its whole life, failing every
 * batch it ever sees; leaving it uncached means the next invocation retries.
 */
export function createTransformHandler(
  secrets: SaltSecretStore,
  env: Environment = process.env,
): (request: FirehoseTransformRequest) => Promise<FirehoseTransformResponse> {
  const secretName = requireSaltSecretName(env);
  let cached: string | undefined;

  async function readSaltSecret(): Promise<string> {
    if (cached === undefined) cached = await loadSaltSecret(secrets, secretName);
    return cached;
  }

  return async function transformFirehoseRecords(request) {
    const saltSecret = await readSaltSecret();
    return { records: request.records.map((record) => transformRecord(record, saltSecret)) };
  };
}
