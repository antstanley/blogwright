import { describe, expect, it } from 'vitest';

import { REPRODUCIBLE_ZIP_MTIME } from './util.js';

/**
 * Zones chosen for what they do to a UTC-fixed 1980-01-01: `America/New_York`
 * and `Pacific/Kiritimati` both sat west of Greenwich in 1980 (Kiritimati was
 * UTC-10:40 then, not today's UTC+14), so both push it into 1979 and make a zip
 * encoder throw; `Asia/Kolkata`'s +05:30 does not throw but shifts the encoded
 * timestamp, which is how identical input produced different archive bytes.
 */
const ZONES = ['UTC', 'America/New_York', 'Pacific/Kiritimati', 'Asia/Kolkata'];

/** Run `fn` with `process.env.TZ` set, restoring whatever was there before. */
function inZone<T>(tz: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/** The local calendar day a zip encoder reads off `date`. */
function localDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** The full local stamp a DOS timestamp encodes - the day AND the time of day. */
function localStamp(date: Date): string {
  return `${localDay(date)} ${date.getHours()}:${date.getMinutes()}`;
}

/**
 * These assert the *construction form*, re-evaluated per zone, rather than the
 * frozen instant the module exports. That is deliberate and is the whole
 * subtlety: a `Date` is an instant, so one built at import time in zone A and
 * read in zone B does shift its local parts. Production never does that - each
 * CLI invocation is a process that builds and reads the constant in one zone -
 * so the property that must hold is "whatever zone this is constructed in, the
 * local day it encodes is in range and is the same day", which is exactly what
 * re-evaluating per zone tests. The last case ties the shipped value back to
 * the form, so the two cannot drift apart.
 */
describe('REPRODUCIBLE_ZIP_MTIME', () => {
  it('encodes the same local day in every timezone it is constructed in', () => {
    const days = ZONES.map((tz) => inZone(tz, () => localDay(new Date(1980, 0, 2))));

    expect(days).toEqual(ZONES.map(() => '1980-0-2'));
  });

  it('stays inside the 1980-2099 range a zip timestamp can encode', () => {
    for (const tz of ZONES) {
      const year = inZone(tz, () => new Date(1980, 0, 2).getFullYear());
      expect(year, `local year in ${tz}`).toBeGreaterThanOrEqual(1980);
      expect(year, `local year in ${tz}`).toBeLessThanOrEqual(2099);
    }
  });

  // The regression, stated as the thing that was actually wrong rather than as
  // a property of the fix: the UTC-constructed form this repo shipped is 1979
  // west of Greenwich, which is what `fflate` refused. A future
  // "simplification" back to it has to delete a test that explains itself.
  it('is not the UTC-constructed 1980-01-01, which falls below the floor west of Greenwich', () => {
    const utcFixed = () => new Date('1980-01-01T00:00:00Z');

    expect(inZone('America/New_York', () => utcFixed().getFullYear())).toBe(1979);
    expect(inZone('Pacific/Kiritimati', () => utcFixed().getFullYear())).toBe(1979);
    // Kolkata's +05:30 keeps the calendar day but moves the time of day, and a
    // DOS timestamp encodes both - which is why the archive bytes differed
    // between zones even where nothing threw.
    expect(inZone('UTC', () => localStamp(utcFixed()))).not.toBe(
      inZone('Asia/Kolkata', () => localStamp(utcFixed())),
    );
    expect(inZone('UTC', () => localStamp(new Date(1980, 0, 2)))).toBe(
      inZone('Asia/Kolkata', () => localStamp(new Date(1980, 0, 2))),
    );
  });

  it('is the value the exported constant carries, so the two cannot drift', () => {
    expect(localDay(REPRODUCIBLE_ZIP_MTIME)).toBe(localDay(new Date(1980, 0, 2)));
  });
});
