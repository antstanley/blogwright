import { describe, expect, it } from 'vitest';

import {
  createTransformHandler,
  type FirehoseTransformRequest,
  type FirehoseTransformResponse,
  SALT_SECRET_NAME_ENV,
  type SaltSecretStore,
} from './handler.js';
import { dailySalt, visitorKey } from './visitor-key.js';

/** 2026-08-30T14:23:45.123Z, as CloudFront's epoch-milliseconds field spells it. */
const EVENT_MS = 1_788_099_825_123;

/** The two sides of one midnight, one millisecond apart. */
const LAST_MS_OF_AUGUST = 1_788_134_399_999;
const FIRST_MS_OF_SEPTEMBER = 1_788_134_400_000;

/** The days those two instants partition under. */
const LAST_DAY_OF_AUGUST = '2026-08-30';
const FIRST_DAY_OF_SEPTEMBER = '2026-08-31';

/** The viewer IP the fixtures carry, which no response payload may ever hold. */
const VIEWER_IP = '203.0.113.42';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

/**
 * The long-lived stored secret. The same fixed value `visitor-key.test.ts` and
 * `map-record.test.ts` use, so a `visitor_key` here is reproducible from the
 * test source alone.
 */
const SALT_SECRET = 'K7mQ2vZp8sX1nR4tY6wB9cD3fG5hJ0lA';

/**
 * The same secret as Secrets Manager would hand it back after someone created
 * it from a pasted value: identical key material, wrapped in whitespace. The
 * secret is written once and never rewritten, so this is not a case that gets
 * cleaned up later - it is the stored value for the life of the table.
 */
const PADDED_SALT_SECRET = `  ${SALT_SECRET}\n`;

/** The Secrets Manager name the function's environment carries. */
const SALT_SECRET_NAME = 'example.com/prod/analytics-salt';

/** The environment task 50's function node sets on the transform. */
const ENV = { [SALT_SECRET_NAME_ENV]: SALT_SECRET_NAME };

/** One CloudFront record with every selected field populated. */
const FULL_RECORD: Readonly<Record<string, unknown>> = {
  'timestamp(ms)': EVENT_MS,
  'c-ip': VIEWER_IP,
  'x-host-header': 'blog.example.com',
  'cs-uri-stem': '/posts/hello-world',
  'cs-uri-query': 'utm_source=rss',
  'cs-method': 'GET',
  'sc-status': '200',
  'cs(Referer)': 'https://news.example.org/feed',
  'cs(User-Agent)': USER_AGENT,
  'c-country': 'GB',
  asn: '64512',
  'x-edge-location': 'LHR62-C1',
  'x-edge-result-type': 'Hit',
  'sc-bytes': '18432',
  'time-taken': '0.042',
  'sc-content-type': 'text/html',
  'cs-protocol': 'https',
  'x-edge-request-id': 'AbCdEf0123456789abcdefghijklmnop==',
};

/**
 * The row `FULL_RECORD` must arrive as on the far side of the envelope,
 * spelled column by column so a base64 or JSON round-trip that changed a
 * value - `status` arriving as `"200"` rather than `200`, say, which Firehose
 * would reject against an `int` column - fails here.
 *
 * `visitor_key` is derived from task 41's two functions rather than copied off
 * `mapRecord`'s output, so this asserts the key the record's own day produces
 * rather than restating whatever the mapping happened to return.
 */
const FULL_ROW = {
  event_time: '2026-08-30T14:23:45.123Z',
  day: LAST_DAY_OF_AUGUST,
  host: 'blog.example.com',
  uri: '/posts/hello-world',
  query: 'utm_source=rss',
  method: 'GET',
  status: 200,
  referrer: 'https://news.example.org/feed',
  user_agent: USER_AGENT,
  country: 'GB',
  asn: '64512',
  edge_location: 'LHR62-C1',
  result_type: 'Hit',
  bytes_sent: 18432,
  time_taken: 0.042,
  content_type: 'text/html',
  protocol: 'https',
  request_id: 'AbCdEf0123456789abcdefghijklmnop==',
  visitor_key: visitorKey(VIEWER_IP, USER_AGENT, dailySalt(SALT_SECRET, LAST_DAY_OF_AUGUST)),
  is_bot: false,
};

/** A record the schema cannot accept: no `timestamp(ms)`, so no `event_time`. */
const UNMAPPABLE_RECORD = Object.fromEntries(
  Object.entries(FULL_RECORD).filter(([field]) => field !== 'timestamp(ms)'),
);

/** A counting stand-in for core's `SecretsManagerClient`; no cloud, no mock. */
interface CountingStore extends SaltSecretStore {
  /** Every secret name asked for, in order - so both the count and the name are assertable. */
  readonly names: string[];
}

function secretStore(read: (name: string) => Promise<string | undefined>): CountingStore {
  const names: string[] = [];
  return {
    names,
    getSecretValue(name: string): Promise<string | undefined> {
      names.push(name);
      return read(name);
    },
  };
}

/** A store that hands back the fixture secret every time. */
function workingStore(): CountingStore {
  return secretStore(() => Promise.resolve(SALT_SECRET));
}

/** Base64-encode a payload the way Firehose hands one over. */
function encode(payload: string): string {
  return Buffer.from(payload, 'utf8').toString('base64');
}

/** One request entry carrying a JSON record. */
function firehoseRecord(recordId: string, record: unknown): { recordId: string; data: string } {
  return { recordId, data: encode(JSON.stringify(record)) };
}

/** A request over the given entries. */
function request(...records: { recordId: string; data: string }[]): FirehoseTransformRequest {
  return { records };
}

/** The row a successful entry carries, decoded back out of the response. */
function rowOf(response: FirehoseTransformResponse, index: number): unknown {
  const entry = response.records[index];
  if (entry === undefined) throw new Error(`response has no entry at index ${index}`);
  if (entry.result !== 'Ok') throw new Error(`entry ${entry.recordId} is ${entry.result}, not Ok`);
  if (entry.data === undefined)
    throw new Error(`entry ${entry.recordId} is Ok but carries no data`);
  return JSON.parse(Buffer.from(entry.data, 'base64').toString('utf8'));
}

describe('createTransformHandler', () => {
  it('returns Ok carrying the mapped row, re-encoded, for a record the schema accepts', async () => {
    const handler = createTransformHandler(workingStore(), ENV);

    const response = await handler(request(firehoseRecord('r-1', FULL_RECORD)));

    expect(response.records).toHaveLength(1);
    expect(response.records[0]?.result).toBe('Ok');
    expect(rowOf(response, 0)).toStrictEqual(FULL_ROW);
  });

  it('reports one unmappable record as ProcessingFailed and still returns Ok for the rest', async () => {
    const handler = createTransformHandler(workingStore(), ENV);

    const response = await handler(
      request(
        firehoseRecord('r-1', FULL_RECORD),
        firehoseRecord('r-2', FULL_RECORD),
        firehoseRecord('r-3', UNMAPPABLE_RECORD),
        firehoseRecord('r-4', FULL_RECORD),
      ),
    );

    expect(response.records.map((entry) => entry.result)).toStrictEqual([
      'Ok',
      'Ok',
      'ProcessingFailed',
      'Ok',
    ]);
    // A failed entry carries no payload at all: Firehose writes the original
    // record to the error prefix, so a half-mapped row must not travel with it.
    expect(response.records[2]).toStrictEqual({ recordId: 'r-3', result: 'ProcessingFailed' });
    expect(rowOf(response, 0)).toStrictEqual(FULL_ROW);
    expect(rowOf(response, 3)).toStrictEqual(FULL_ROW);
  });

  it('echoes every recordId unchanged and in order, failed entries included', async () => {
    const handler = createTransformHandler(workingStore(), ENV);
    const ids = ['first', 'second', 'third', 'fourth'];

    const response = await handler(
      request(
        firehoseRecord('first', FULL_RECORD),
        firehoseRecord('second', UNMAPPABLE_RECORD),
        { recordId: 'third', data: encode('{ not json') },
        firehoseRecord('fourth', FULL_RECORD),
      ),
    );

    // Firehose discards a response whose ids do not match its request - the
    // whole response, not the mismatched entry - so this covers every entry.
    expect(response.records.map((entry) => entry.recordId)).toStrictEqual(ids);
    expect(response.records.map((entry) => entry.result)).toStrictEqual([
      'Ok',
      'ProcessingFailed',
      'ProcessingFailed',
      'Ok',
    ]);
  });

  it('reports a payload that is not valid JSON as ProcessingFailed rather than throwing', async () => {
    const handler = createTransformHandler(workingStore(), ENV);

    const response = await handler(request({ recordId: 'r-1', data: encode('{"cs-method": ') }));

    expect(response.records).toStrictEqual([{ recordId: 'r-1', result: 'ProcessingFailed' }]);
  });

  it('reports an undecodable payload as ProcessingFailed rather than throwing', async () => {
    const handler = createTransformHandler(workingStore(), ENV);

    const response = await handler(request({ recordId: 'r-1', data: '!!!! not base64 !!!!' }));

    expect(response.records).toStrictEqual([{ recordId: 'r-1', result: 'ProcessingFailed' }]);
  });

  // Four payload shapes, not four independent guards: only `null` has teeth of
  // its own here, because `mapRecord` reads `record['timestamp(ms)']` and only
  // `null` throws on that read rather than yielding `undefined`. A bare number,
  // a bare string and a one-element array would each still drop for the missing
  // timestamp with `decodePayload`'s non-object and array clauses deleted. Those
  // clauses are defence in depth - `mapRecord` documents that it trusts its
  // record to be an object - and these rows are not their coverage.
  it.each([
    { shape: 'a bare number', payload: '42' },
    { shape: 'null', payload: 'null' },
    { shape: 'an array of records', payload: '[{"timestamp(ms)": 1788099825123}]' },
    { shape: 'a bare string', payload: '"timestamp(ms)"' },
  ])('reports a payload that parses to $shape as ProcessingFailed', async ({ payload }) => {
    const handler = createTransformHandler(workingStore(), ENV);

    const response = await handler(request({ recordId: 'r-1', data: encode(payload) }));

    expect(response.records).toStrictEqual([{ recordId: 'r-1', result: 'ProcessingFailed' }]);
  });

  it('returns an empty records array for an empty batch', async () => {
    const handler = createTransformHandler(workingStore(), ENV);

    const response = await handler(request());

    expect(response.records).toStrictEqual([]);
  });

  it('writes the viewer IP into no response payload', async () => {
    const handler = createTransformHandler(workingStore(), ENV);

    const response = await handler(
      request(firehoseRecord('r-1', FULL_RECORD), firehoseRecord('r-2', UNMAPPABLE_RECORD)),
    );

    for (const entry of response.records) {
      const decoded = entry.data === undefined ? '' : Buffer.from(entry.data, 'base64').toString();
      expect(decoded, `entry "${entry.recordId}"`).not.toContain(VIEWER_IP);
    }
  });
});

describe('createTransformHandler across midnight', () => {
  /** The same visitor, one millisecond either side of a UTC midnight. */
  const before = firehoseRecord('before', { ...FULL_RECORD, 'timestamp(ms)': LAST_MS_OF_AUGUST });
  const after = firehoseRecord('after', {
    ...FULL_RECORD,
    'timestamp(ms)': FIRST_MS_OF_SEPTEMBER,
  });

  function visitorKeyOn(day: string): string {
    return visitorKey(VIEWER_IP, USER_AGENT, dailySalt(SALT_SECRET, day));
  }

  it('is a batch that genuinely straddles a midnight', () => {
    expect(FIRST_MS_OF_SEPTEMBER - LAST_MS_OF_AUGUST).toBe(1);
    expect(new Date(LAST_MS_OF_AUGUST).toISOString()).toBe(`${LAST_DAY_OF_AUGUST}T23:59:59.999Z`);
    expect(new Date(FIRST_MS_OF_SEPTEMBER).toISOString()).toBe(
      `${FIRST_DAY_OF_SEPTEMBER}T00:00:00.000Z`,
    );
  });

  it("keys each record under its own day's salt, not one salt for the buffer", async () => {
    const handler = createTransformHandler(workingStore(), ENV);

    const response = await handler(request(before, after));

    const rows = [rowOf(response, 0), rowOf(response, 1)] as { day: string; visitor_key: string }[];
    expect(rows.map((row) => row.day)).toStrictEqual([LAST_DAY_OF_AUGUST, FIRST_DAY_OF_SEPTEMBER]);
    expect(rows[0]?.visitor_key).toBe(visitorKeyOn(LAST_DAY_OF_AUGUST));
    expect(rows[1]?.visitor_key).toBe(visitorKeyOn(FIRST_DAY_OF_SEPTEMBER));
  });

  it('gives one visitor two keys across the midnight, so neither day joins to the other', async () => {
    const handler = createTransformHandler(workingStore(), ENV);

    const response = await handler(request(before, after));

    const [first, second] = [rowOf(response, 0), rowOf(response, 1)] as { visitor_key: string }[];
    // A salt hoisted to the batch would key both records under whichever day
    // was chosen: the two would match, and every key on the far side of the
    // midnight would join to neither day's.
    expect(first?.visitor_key).not.toBe(second?.visitor_key);
    expect(second?.visitor_key).not.toBe(visitorKeyOn(LAST_DAY_OF_AUGUST));
  });
});

describe('createTransformHandler salt secret', () => {
  it('reads the secret named in the environment once, then reuses it', async () => {
    const store = workingStore();

    const handler = createTransformHandler(store, ENV);
    expect(store.names, 'no read before the first batch').toStrictEqual([]);

    await handler(request(firehoseRecord('r-1', FULL_RECORD)));
    await handler(request(firehoseRecord('r-2', FULL_RECORD)));

    expect(store.names).toStrictEqual([SALT_SECRET_NAME]);
  });

  it('fails the whole batch when the secret cannot be read', async () => {
    const store = secretStore(() => Promise.reject(new Error('ThrottlingException')));
    const handler = createTransformHandler(store, ENV);

    await expect(handler(request(firehoseRecord('r-1', FULL_RECORD)))).rejects.toThrow(
      'ThrottlingException',
    );
  });

  it.each([
    { held: 'no secret at that name', value: undefined },
    { held: 'an empty value', value: '' },
    { held: 'a blank value', value: '   ' },
  ])('fails the whole batch when Secrets Manager holds $held', async ({ value }) => {
    const store = secretStore(() => Promise.resolve(value));
    const handler = createTransformHandler(store, ENV);

    // Not one ProcessingFailed per record: an unsalted or absent key would look
    // exactly like a normal row in the table, so the batch fails instead.
    await expect(handler(request(firehoseRecord('r-1', FULL_RECORD)))).rejects.toThrow(
      SALT_SECRET_NAME,
    );
  });

  it('derives visitor_key from the stored secret untrimmed, whitespace included', async () => {
    const store = secretStore(() => Promise.resolve(PADDED_SALT_SECRET));
    const handler = createTransformHandler(store, ENV);

    const response = await handler(request(firehoseRecord('r-1', FULL_RECORD)));

    const row = rowOf(response, 0) as { visitor_key: string };
    // The blank check on the line above the return trims; the returned value
    // must not. Surrounding whitespace is part of the HMAC key, so trimming it
    // for consistency would derive a different salt from the same stored
    // secret and re-key every visitor from that deploy onward - old rows
    // joining to none of the new ones, with no error anywhere and only a
    // discontinuity in the visitor count to show for it. The second assertion
    // is what makes the first one load-bearing: the two must not agree.
    expect(row.visitor_key).toBe(
      visitorKey(VIEWER_IP, USER_AGENT, dailySalt(PADDED_SALT_SECRET, LAST_DAY_OF_AUGUST)),
    );
    expect(row.visitor_key).not.toBe(
      visitorKey(VIEWER_IP, USER_AGENT, dailySalt(SALT_SECRET, LAST_DAY_OF_AUGUST)),
    );
  });

  it('retries a failed read on the next batch rather than caching the failure', async () => {
    let attempt = 0;
    const store = secretStore(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error('ThrottlingException'))
        : Promise.resolve(SALT_SECRET);
    });
    const handler = createTransformHandler(store, ENV);

    await expect(handler(request(firehoseRecord('r-1', FULL_RECORD)))).rejects.toThrow(
      'ThrottlingException',
    );
    const response = await handler(request(firehoseRecord('r-2', FULL_RECORD)));

    expect(response.records.map((entry) => entry.result)).toStrictEqual(['Ok']);
    expect(store.names).toStrictEqual([SALT_SECRET_NAME, SALT_SECRET_NAME]);
  });

  it.each([
    { environment: 'no variable at all', env: {} },
    { environment: 'an empty variable', env: { [SALT_SECRET_NAME_ENV]: '' } },
    { environment: 'a blank variable', env: { [SALT_SECRET_NAME_ENV]: '  ' } },
  ])('refuses to build a handler with $environment', ({ env }) => {
    expect(() => createTransformHandler(workingStore(), env)).toThrow(SALT_SECRET_NAME_ENV);
  });
});
