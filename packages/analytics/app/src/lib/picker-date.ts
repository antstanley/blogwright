/** Adapt UTC reporting strings to calendar wall times, without local-zone conversion. */
import { parseDateTime, type CalendarDateTime, type DateValue } from '@internationalized/date';

export function pickerValue(value: string): { value?: CalendarDateTime } {
  return value === '' ? {} : { value: parseDateTime(value) };
}

export function reportingValue(value: DateValue | undefined): string {
  return value?.toString().slice(0, 16) ?? '';
}
