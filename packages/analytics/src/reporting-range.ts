/** UTC minute inputs and rolling reporting windows. */
interface DateRange {
  readonly from: string;
  readonly to: string;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export const PERIODS = [
  { value: '3h', label: '3H', hours: 3 },
  { value: '6h', label: '6H', hours: 6 },
  { value: '12h', label: '12H', hours: 12 },
  { value: '24h', label: '24H', hours: 24 },
  { value: '5d', label: '5D', hours: 120 },
  { value: '1w', label: '1W', hours: 168 },
  { value: '4w', label: '4W', hours: 672 },
  { value: '3mo', label: '3M', months: 3 },
  { value: '6mo', label: '6M', months: 6 },
  { value: '1y', label: '1Y', months: 12 },
] as const;
export type Period = (typeof PERIODS)[number]['value'];

/** Calendar subtraction clamps month-end and leap-day dates without rolling forward. */
function monthsBefore(end: Date, months: number): Date {
  const start = new Date(end);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - months);
  const lastDay = new Date(start);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
  lastDay.setUTCDate(0);
  start.setUTCDate(Math.min(end.getUTCDate(), lastDay.getUTCDate()));
  return start;
}

/** Input values intentionally omit a zone; the UI explicitly labels them UTC. */
export function presetRange(period: Period, now: Date = new Date()): DateRange {
  const option = PERIODS.find((item) => item.value === period);
  if (option === undefined) throw new Error(`Unknown reporting period: ${period}`);
  const end = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  const start =
    'hours' in option
      ? new Date(end.getTime() - option.hours * 60 * MINUTE_MS)
      : monthsBefore(end, option.months);
  return { from: start.toISOString().slice(0, 16), to: end.toISOString().slice(0, 16) };
}

/** Preserve the initial thirty-day window while allowing minute precision. */
export function defaultRange(now: Date = new Date()): DateRange {
  const end = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  return {
    from: new Date(end.getTime() - 30 * DAY_MS).toISOString().slice(0, 16),
    to: end.toISOString().slice(0, 16),
  };
}

export function rangeProblem(range: DateRange): string | undefined {
  for (const value of [range.from, range.to]) {
    const instant = Date.parse(`${value}:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
      !Number.isFinite(instant) ||
      new Date(instant).toISOString().slice(0, 16) !== value
    ) {
      return 'Choose a valid start and end date and time (UTC).';
    }
  }
  if (range.from >= range.to) return 'The start must be before the end date and time.';
  return undefined;
}
