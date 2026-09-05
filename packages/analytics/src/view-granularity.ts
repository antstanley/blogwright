/** Shared interval vocabulary; safe to import into the browser without query SQL. */
export const VIEW_GRANULARITIES = {
  '15m': { minutes: 15, label: '15 minutes' },
  '1h': { minutes: 60, label: '1 hour' },
  '6h': { minutes: 360, label: '6 hours' },
  '12h': { minutes: 720, label: '12 hours' },
  '24h': { minutes: 1440, label: '24 hours' },
} as const;

/** A supported UTC time bucket for Views over time. */
export type ViewGranularity = keyof typeof VIEW_GRANULARITIES;

/** Validate untrusted API values; an omitted interval preserves daily queries. */
export function parseViewGranularity(value: unknown): ViewGranularity {
  if (value === undefined) return '24h';
  if (typeof value !== 'string' || !Object.hasOwn(VIEW_GRANULARITIES, value)) {
    throw new Error('granularity must be one of 15m, 1h, 6h, 12h, 24h');
  }
  // Object.hasOwn above proves membership in the interval vocabulary.
  return value as ViewGranularity;
}
