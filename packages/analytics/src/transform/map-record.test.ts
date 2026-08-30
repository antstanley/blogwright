import { describe, expect, it } from 'vitest';

import {
  FIELD_TO_COLUMN,
  PAGE_VIEWS_COLUMNS,
  type PageViewsColumn,
  TIMESTAMP_MS_FIELD,
  VIEWER_IP_FIELD,
} from '../schema.js';
import { type CloudFrontRecord, mapRecord } from './map-record.js';

/** 2026-08-30T14:23:45.123Z, as CloudFront's epoch-milliseconds field spells it. */
const EVENT_MS = 1_788_099_825_123;

/** The viewer IP the fixture carries, which no column may ever hold. */
const VIEWER_IP = '203.0.113.42';

/** One CloudFront record with every selected field populated. */
const FULL_RECORD: CloudFrontRecord = {
  'timestamp(ms)': EVENT_MS,
  'c-ip': VIEWER_IP,
  'x-host-header': 'blog.example.com',
  'cs-uri-stem': '/posts/hello-world',
  'cs-uri-query': 'utm_source=rss',
  'cs-method': 'GET',
  'sc-status': '200',
  'cs(Referer)': 'https://news.example.org/feed',
  'cs(User-Agent)': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
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

/** The row `FULL_RECORD` must produce, spelled out column by column. */
const FULL_ROW = {
  event_time: '2026-08-30T14:23:45.123Z',
  day: '2026-08-30',
  host: 'blog.example.com',
  uri: '/posts/hello-world',
  query: 'utm_source=rss',
  method: 'GET',
  status: 200,
  referrer: 'https://news.example.org/feed',
  user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  country: 'GB',
  asn: '64512',
  edge_location: 'LHR62-C1',
  result_type: 'Hit',
  bytes_sent: 18432,
  time_taken: 0.042,
  content_type: 'text/html',
  protocol: 'https',
  request_id: 'AbCdEf0123456789abcdefghijklmnop==',
};

/**
 * The columns a fully populated record fills today: every `FIELD_TO_COLUMN`
 * target plus the two this transform derives. `visitor_key` and `is_bot` join
 * them with task 41; until then the table's two remaining columns are absent,
 * which it permits.
 */
const COLUMNS_FILLED_HERE = [...Object.values(FIELD_TO_COLUMN), 'event_time', 'day'];

/** The JavaScript type each Iceberg type must arrive as for Firehose to match it. */
const JS_TYPE_BY_ICEBERG_TYPE = {
  string: 'string',
  timestamp: 'string',
  date: 'string',
  int: 'number',
  long: 'number',
  double: 'number',
  boolean: 'boolean',
} as const satisfies Record<PageViewsColumn['icebergType'], string>;

function recordWithout(omitted: string): CloudFrontRecord {
  return Object.fromEntries(Object.entries(FULL_RECORD).filter(([field]) => field !== omitted));
}

function recordWith(field: string, value: unknown): CloudFrontRecord {
  return { ...FULL_RECORD, [field]: value };
}

/** The mapped row, or a failure naming why the record was dropped instead. */
function rowOf(record: CloudFrontRecord) {
  const result = mapRecord(record);
  if (!result.mapped) throw new Error(`expected a mapped row, got a drop: ${result.reason}`);
  return result.row;
}

/** The drop, or a failure showing the row that was produced instead. */
function dropOf(record: CloudFrontRecord) {
  const result = mapRecord(record);
  if (result.mapped) throw new Error(`expected a drop, got a row: ${JSON.stringify(result.row)}`);
  return result;
}

describe('mapRecord', () => {
  it('maps a fully populated CloudFront record to a fully spelled page_views row', () => {
    expect(mapRecord(FULL_RECORD)).toStrictEqual({ mapped: true, row: FULL_ROW });
  });

  it('fills exactly the columns schema.ts maps, plus the two it derives', () => {
    expect(Object.keys(rowOf(FULL_RECORD)).sort()).toEqual([...COLUMNS_FILLED_HERE].sort());
  });

  it('renames every mapped CloudFront field into the column schema.ts pairs it with', () => {
    const row = rowOf(FULL_RECORD);
    for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
      expect(row, `CloudFront field "${field}" should fill column "${column}"`).toHaveProperty(
        column,
      );
    }
  });

  it('fills every column the table requires', () => {
    const row = rowOf(FULL_RECORD);
    const required = PAGE_VIEWS_COLUMNS.filter((column) => column.required);
    expect(required.length).toBeGreaterThan(0);
    for (const column of required) {
      expect(row, `required column "${column.name}"`).toHaveProperty(column.name);
    }
  });

  it('writes only page_views columns, each in the JavaScript type its Iceberg type stores', () => {
    const row = rowOf(FULL_RECORD);
    expect(Object.keys(row)).toHaveLength(COLUMNS_FILLED_HERE.length);
    for (const [name, value] of Object.entries(row)) {
      const column = PAGE_VIEWS_COLUMNS.find((candidate) => candidate.name === name);
      if (column === undefined) {
        throw new Error(`row carries "${name}", which page_views has no column for`);
      }
      expect(typeof value, `column "${name}"`).toBe(JS_TYPE_BY_ICEBERG_TYPE[column.icebergType]);
    }
  });

  it('ignores a field the delivery never selects, even when one reaches it', () => {
    const row = rowOf(recordWith('cs(Cookie)', 'session=secret'));
    expect(Object.values(row)).not.toContain('session=secret');
    expect(row).toStrictEqual(FULL_ROW);
  });

  it('writes the viewer IP into no column', () => {
    expect(FULL_RECORD[VIEWER_IP_FIELD]).toBe(VIEWER_IP);
    expect(Object.values(rowOf(FULL_RECORD))).not.toContain(VIEWER_IP);
  });
});

describe('mapRecord event_time and day', () => {
  it('derives event_time from timestamp(ms) as a UTC instant', () => {
    expect(rowOf(FULL_RECORD).event_time).toBe('2026-08-30T14:23:45.123Z');
  });

  it('derives the day partition from event_time', () => {
    expect(rowOf(FULL_RECORD).day).toBe('2026-08-30');
  });

  it('reads timestamp(ms) as a number when the payload quoted it', () => {
    const row = rowOf(recordWith(TIMESTAMP_MS_FIELD, String(EVENT_MS)));
    expect(row.event_time).toBe('2026-08-30T14:23:45.123Z');
    expect(row.day).toBe('2026-08-30');
  });

  // The two sides of one midnight, one millisecond apart.
  const LAST_MS_OF_AUGUST = 1_788_134_399_999;
  const FIRST_MS_OF_SEPTEMBER = 1_788_134_400_000;

  it.each([
    {
      milliseconds: LAST_MS_OF_AUGUST,
      event_time: '2026-08-30T23:59:59.999Z',
      day: '2026-08-30',
    },
    {
      milliseconds: FIRST_MS_OF_SEPTEMBER,
      event_time: '2026-08-31T00:00:00.000Z',
      day: '2026-08-31',
    },
  ])('partitions $event_time under day $day', ({ milliseconds, event_time, day }) => {
    const row = rowOf(recordWith(TIMESTAMP_MS_FIELD, milliseconds));
    expect(row.event_time).toBe(event_time);
    expect(row.day).toBe(day);
  });

  it('puts two records one millisecond apart on either side of midnight', () => {
    expect(FIRST_MS_OF_SEPTEMBER - LAST_MS_OF_AUGUST).toBe(1);
    const before = rowOf(recordWith(TIMESTAMP_MS_FIELD, LAST_MS_OF_AUGUST));
    const after = rowOf(recordWith(TIMESTAMP_MS_FIELD, FIRST_MS_OF_SEPTEMBER));
    expect(before.day).not.toBe(after.day);
  });

  it('maps the epoch itself', () => {
    const row = rowOf(recordWith(TIMESTAMP_MS_FIELD, 0));
    expect(row.event_time).toBe('1970-01-01T00:00:00.000Z');
    expect(row.day).toBe('1970-01-01');
  });

  // The last instant `toISOString` renders with a four-digit year, the first
  // instant past it, and a value no Date can represent at all. Past the first
  // of those the day partition would read "+010000-0", which is not a date.
  const LAST_FOUR_DIGIT_YEAR_MS = 253_402_300_799_999;

  it('maps the last instant of the year 9999', () => {
    const row = rowOf(recordWith(TIMESTAMP_MS_FIELD, LAST_FOUR_DIGIT_YEAR_MS));
    expect(row.event_time).toBe('9999-12-31T23:59:59.999Z');
    expect(row.day).toBe('9999-12-31');
  });

  it.each([
    { label: 'the first instant past the year 9999', milliseconds: 253_402_300_800_000 },
    { label: 'a value no Date can represent', milliseconds: 8_640_000_000_000_001 },
  ])('drops a record whose timestamp is $label', ({ milliseconds }) => {
    const drop = dropOf(recordWith(TIMESTAMP_MS_FIELD, milliseconds));
    expect(drop).not.toHaveProperty('row');
    expect(drop.field).toBe(TIMESTAMP_MS_FIELD);
    expect(drop.reason).toContain(String(milliseconds));
  });
});

describe('mapRecord numeric columns', () => {
  it('emits status, bytes_sent and time_taken as numbers when the record quotes them', () => {
    const row = rowOf(FULL_RECORD);
    expect(typeof row.status).toBe('number');
    expect(typeof row.bytes_sent).toBe('number');
    expect(typeof row.time_taken).toBe('number');
    expect(row.status).toBe(200);
    expect(row.bytes_sent).toBe(18432);
    expect(row.time_taken).toBe(0.042);
  });

  it('emits the same numbers when the payload carried them unquoted', () => {
    const record = { ...FULL_RECORD, 'sc-status': 200, 'sc-bytes': 18432, 'time-taken': 0.042 };
    const row = rowOf(record);
    expect(typeof row.status).toBe('number');
    expect(typeof row.bytes_sent).toBe('number');
    expect(typeof row.time_taken).toBe('number');
    expect(row).toStrictEqual(FULL_ROW);
  });

  it('renders a string column that arrived as a number, rather than dropping the record', () => {
    const row = rowOf(recordWith('asn', 64_512));
    expect(typeof row.asn).toBe('string');
    expect(row.asn).toBe('64512');
  });

  it.each([
    { field: 'sc-status', column: 'status' },
    { field: 'sc-bytes', column: 'bytes_sent' },
    { field: 'time-taken', column: 'time_taken' },
  ])('drops a record whose $field does not parse as a number', ({ field, column }) => {
    const drop = dropOf(recordWith(field, 'not-a-number'));
    expect(drop).not.toHaveProperty('row');
    expect(drop.column).toBe(column);
    expect(drop.field).toBe(field);
    expect(drop.reason).toContain(column);
    expect(drop.reason).toContain(field);
  });

  it.each([
    { label: 'trailing units', value: '18432 bytes' },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: 'a boolean', value: true },
    { label: 'an object', value: { value: 200 } },
  ])('drops a record whose sc-status holds $label', ({ value }) => {
    const drop = dropOf(recordWith('sc-status', value));
    expect(drop).not.toHaveProperty('row');
    expect(drop.column).toBe('status');
  });
});

describe('mapRecord absent values', () => {
  it.each([
    { label: 'CloudFront\'s "-"', value: '-' },
    { label: 'an empty string', value: '' },
    { label: 'whitespace', value: '   ' },
    { label: 'null', value: null },
  ])('leaves an optional column unwritten when its field holds $label', ({ value }) => {
    const row = rowOf(recordWith('cs-uri-query', value));
    expect(row).not.toHaveProperty('query');
    expect(row.uri).toBe('/posts/hello-world');
  });

  it('leaves an optional column unwritten when its field is missing entirely', () => {
    const row = rowOf(recordWithout('cs(Referer)'));
    expect(row).not.toHaveProperty('referrer');
    expect(row.user_agent).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
  });

  it('trims a value rather than writing the padding CloudFront may have added', () => {
    expect(rowOf(recordWith('c-country', '  GB  ')).country).toBe('GB');
  });

  // A nullable column is left empty when the record says nothing, never when it
  // says something unusable: a null there would claim the request had no
  // referrer at all, which is a different fact from one this transform failed
  // to read.
  it.each([
    { nullable: 'a required', field: 'cs-uri-stem', column: 'uri' },
    { nullable: 'a nullable', field: 'cs(Referer)', column: 'referrer' },
  ])(
    'drops a record whose $field holds a value $nullable column cannot store',
    ({ field, column }) => {
      const drop = dropOf(recordWith(field, ['/posts/hello-world']));
      expect(drop).not.toHaveProperty('row');
      expect(drop.column).toBe(column);
      expect(drop.field).toBe(field);
    },
  );
});

/** The CloudFront field behind each column the table requires. */
const REQUIRED_COLUMN_SOURCES = [
  { column: 'event_time', field: 'timestamp(ms)' },
  { column: 'day', field: 'timestamp(ms)' },
  { column: 'host', field: 'x-host-header' },
  { column: 'uri', field: 'cs-uri-stem' },
  { column: 'status', field: 'sc-status' },
];

describe('mapRecord drop path', () => {
  it('has a drop case for every column the table requires', () => {
    const covered = REQUIRED_COLUMN_SOURCES.map((source) => source.column).sort();
    const required = PAGE_VIEWS_COLUMNS.filter((column) => column.required)
      .map((column) => column.name)
      .sort();
    expect(covered).toEqual(required);
  });

  it.each(REQUIRED_COLUMN_SOURCES)(
    'drops a record missing $field, naming column $column',
    ({ column, field }) => {
      const drop = dropOf(recordWithout(field));
      expect(drop).not.toHaveProperty('row');
      expect(drop.field).toBe(field);
      expect(drop.reason).toContain(column);
      expect(drop.reason).toContain(field);
    },
  );

  it.each([
    { column: 'host', field: 'x-host-header' },
    { column: 'uri', field: 'cs-uri-stem' },
    { column: 'status', field: 'sc-status' },
  ])('drops a record whose $field is present but empty', ({ column, field }) => {
    const drop = dropOf(recordWith(field, '-'));
    expect(drop).not.toHaveProperty('row');
    expect(drop.column).toBe(column);
    expect(drop.reason).toContain(field);
  });

  it('drops an empty record, naming the timestamp field it could not read', () => {
    const drop = dropOf({});
    expect(drop).not.toHaveProperty('row');
    expect(drop.field).toBe(TIMESTAMP_MS_FIELD);
    expect(drop.reason).toContain('event_time');
    expect(drop.reason).toContain('day');
  });
});
