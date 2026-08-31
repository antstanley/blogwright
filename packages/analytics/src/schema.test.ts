import { describe, expect, it } from 'vitest';

import {
  CLOUDFRONT_RECORD_FIELDS,
  DERIVATION_ONLY_FIELDS,
  DERIVED_COLUMNS,
  FIELD_TO_COLUMN,
  PAGE_VIEWS_COLUMNS,
  PAGE_VIEWS_PARTITION_COLUMN,
  type PageView,
  VIEWER_IP_FIELD,
} from './schema.js';

/** An S3 Tables catalog requirement: every column name must be lowercase. */
const LOWERCASE_COLUMN_NAME = /^[a-z0-9_]+$/;

/**
 * The one check in this file the test runner cannot make: that a row carrying
 * the five required columns and one optional one satisfies `PageView`. It is
 * discharged by `pnpm typecheck`, which reads this file because
 * `tsconfig.typecheck.json` sets `"exclude": []` - drop a required column or
 * name one the table does not carry and the typecheck gate fails. There is no
 * assertion to wrap it in: the annotation is the whole check, and any `expect`
 * about the literal afterwards could only restate what the literal says. The
 * underscore is oxlint's marker for a binding that exists to be checked, not
 * read.
 */
const _MINIMAL_PAGE_VIEW = {
  event_time: '2026-08-30T00:00:00.000Z',
  day: '2026-08-30',
  host: 'blog.example.com',
  uri: '/posts/hello',
  status: 200,
  is_bot: false,
} satisfies PageView;

describe('PAGE_VIEWS_COLUMNS', () => {
  it('names every column with the exact twenty the spec lists, in order', () => {
    expect(PAGE_VIEWS_COLUMNS.map((c) => c.name)).toEqual([
      'event_time',
      'day',
      'host',
      'uri',
      'query',
      'method',
      'status',
      'referrer',
      'user_agent',
      'country',
      'asn',
      'edge_location',
      'result_type',
      'bytes_sent',
      'time_taken',
      'content_type',
      'protocol',
      'request_id',
      'visitor_key',
      'is_bot',
    ]);
  });

  it.each(PAGE_VIEWS_COLUMNS)(
    'column "$name" is a lowercase catalog-safe identifier',
    ({ name }) => {
      expect(name).toMatch(LOWERCASE_COLUMN_NAME);
    },
  );

  it('has no duplicate column names', () => {
    const names = PAGE_VIEWS_COLUMNS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks required=true for exactly the spec's PageView.required set", () => {
    const required = PAGE_VIEWS_COLUMNS.filter((c) => c.required).map((c) => c.name);
    expect(required).toEqual(['event_time', 'day', 'host', 'uri', 'status']);
  });

  it('partitions on the "day" column, which the table itself carries', () => {
    expect(PAGE_VIEWS_PARTITION_COLUMN).toBe('day');
    expect(PAGE_VIEWS_COLUMNS.some((c) => c.name === PAGE_VIEWS_PARTITION_COLUMN)).toBe(true);
  });
});

describe('CLOUDFRONT_RECORD_FIELDS', () => {
  it('never selects cs(Cookie) or x-forwarded-for - they carry personal data and are never used', () => {
    expect(CLOUDFRONT_RECORD_FIELDS).not.toContain('cs(Cookie)');
    expect(CLOUDFRONT_RECORD_FIELDS).not.toContain('x-forwarded-for');
  });

  it('selects the viewer-IP field, because the transform derives visitor_key from it', () => {
    expect(CLOUDFRONT_RECORD_FIELDS).toContain(VIEWER_IP_FIELD);
    expect(VIEWER_IP_FIELD).toBe('c-ip');
  });

  it('selects the millisecond-epoch timestamp field, the only source for event_time and day', () => {
    // Written as a literal rather than through schema.ts's TIMESTAMP_MS_FIELD,
    // which the transform now imports: what matters is that this exact field
    // name is selected, and comparing the constant against the list it is
    // spliced into would hold no matter what the constant said. Drop the field
    // from DERIVATION_ONLY_FIELDS and event_time - a required column - and the
    // day partition key lose their only input; this is the check that notices.
    expect(CLOUDFRONT_RECORD_FIELDS).toContain('timestamp(ms)');
  });

  it('has no duplicate field names', () => {
    expect(new Set(CLOUDFRONT_RECORD_FIELDS).size).toBe(CLOUDFRONT_RECORD_FIELDS.length);
  });
});

describe('FIELD_TO_COLUMN totality', () => {
  // This direction can't be broken by editing either input list: schema.ts
  // builds CLOUDFRONT_RECORD_FIELDS by concatenating Object.keys(FIELD_TO_COLUMN)
  // with DERIVATION_ONLY_FIELDS, so an entry leaving one of them leaves the
  // selected fields with it and both sides of the membership check move
  // together. That's a stronger guarantee than a test. What is left for this
  // one to catch is a future edit that stops deriving the list this way - a
  // hand-written CLOUDFRONT_RECORD_FIELDS entry with neither a mapped column
  // nor a DERIVATION_ONLY_FIELDS entry behind it.
  it('accounts for every selected field as either a direct mapping or a derivation-only input', () => {
    const mappedFields = new Set(Object.keys(FIELD_TO_COLUMN));
    const derivationOnly = new Set<string>(DERIVATION_ONLY_FIELDS);
    for (const field of CLOUDFRONT_RECORD_FIELDS) {
      const accounted = mappedFields.has(field) || derivationOnly.has(field);
      expect(
        accounted,
        `field "${field}" is selected but has no mapped column and is not listed in DERIVATION_ONLY_FIELDS`,
      ).toBe(true);
    }
  });

  it('accounts for every page_views column as either a mapped target or a derived column', () => {
    const mappedColumns = new Set<string>(Object.values(FIELD_TO_COLUMN));
    const derived = new Set<string>(DERIVED_COLUMNS);
    for (const column of PAGE_VIEWS_COLUMNS) {
      const accounted = mappedColumns.has(column.name) || derived.has(column.name);
      expect(
        accounted,
        `column "${column.name}" has neither a mapped CloudFront field nor a DERIVED_COLUMNS entry`,
      ).toBe(true);
    }
  });

  it('covers exactly the twenty columns with no extra or duplicate targets - mapped values plus DERIVED_COLUMNS, no more, no less', () => {
    const mappedValues = Object.values(FIELD_TO_COLUMN);
    expect(new Set(mappedValues).size).toBe(mappedValues.length);

    const covered = new Set([...mappedValues, ...DERIVED_COLUMNS]);
    const allColumns = new Set(PAGE_VIEWS_COLUMNS.map((c) => c.name));
    expect(covered).toEqual(allColumns);
  });

  it('lists derived columns as exactly event_time, day, visitor_key and is_bot', () => {
    expect([...DERIVED_COLUMNS].sort()).toEqual(['day', 'event_time', 'is_bot', 'visitor_key']);
  });
});
