<script lang="ts">
  import { DatePicker } from 'bits-ui';
  import { parseDateTime, type DateValue } from '@internationalized/date';
  import { pickerValue, reportingValue } from './picker-date.js';
  import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/svelte';

  let { label, value = $bindable(), min, max, onchange }: {
    label: string;
    value: string;
    min?: string;
    max?: string;
    onchange: () => void;
  } = $props();

  function setValue(selected: DateValue | undefined): void {
    value = reportingValue(selected);
    onchange();
  }
</script>

<DatePicker.Root {...pickerValue(value)} onValueChange={setValue}
  {...min ? { minValue: parseDateTime(min) } : {}}
  {...max ? { maxValue: parseDateTime(max) } : {}}
  locale="en-GB" hourCycle={24} granularity="minute" weekdayFormat="short"
  fixedWeeks preventDeselect calendarLabel={`${label} date (UTC)`}>
  <div class="control date-time-control">
    <DatePicker.Label class="date-time-label">{label}</DatePicker.Label>
    <DatePicker.Input class="date-time-input">
      {#snippet children({ segments })}
        {#each segments as segment, index (segment.part + index)}
          <DatePicker.Segment part={segment.part} class="date-time-segment">{segment.value}</DatePicker.Segment>
        {/each}
        <DatePicker.Trigger class="date-time-trigger" aria-label={`Choose ${label.toLowerCase()} date`}>
          <CalendarDays size={16} aria-hidden="true" />
        </DatePicker.Trigger>
      {/snippet}
    </DatePicker.Input>
  </div>
  <DatePicker.Portal>
    <DatePicker.Content class="date-time-popover" sideOffset={8} collisionPadding={12}>
      <DatePicker.Calendar>
        {#snippet children({ months, weekdays })}
          <DatePicker.Header class="date-time-calendar-header">
            <DatePicker.PrevButton class="date-time-nav" aria-label="Previous month"><ChevronLeft size={18} aria-hidden="true" /></DatePicker.PrevButton>
            <DatePicker.Heading />
            <DatePicker.NextButton class="date-time-nav" aria-label="Next month"><ChevronRight size={18} aria-hidden="true" /></DatePicker.NextButton>
          </DatePicker.Header>
          {#each months as month (month.value.toString())}
            <DatePicker.Grid class="date-time-grid">
              <DatePicker.GridHead>
                <DatePicker.GridRow>
                  {#each weekdays as day (day)}
                    <DatePicker.HeadCell class="date-time-weekday">{day.slice(0, 2)}</DatePicker.HeadCell>
                  {/each}
                </DatePicker.GridRow>
              </DatePicker.GridHead>
              <DatePicker.GridBody>
                {#each month.weeks as week (week)}
                  <DatePicker.GridRow>
                    {#each week as date (date.toString())}
                      <DatePicker.Cell {date} month={month.value} class="date-time-cell">
                        <DatePicker.Day class="date-time-day">{date.day}</DatePicker.Day>
                      </DatePicker.Cell>
                    {/each}
                  </DatePicker.GridRow>
                {/each}
              </DatePicker.GridBody>
            </DatePicker.Grid>
          {/each}
        {/snippet}
      </DatePicker.Calendar>
      <p class="date-time-hint">UTC · Edit hours and minutes in the field.</p>
    </DatePicker.Content>
  </DatePicker.Portal>
</DatePicker.Root>
