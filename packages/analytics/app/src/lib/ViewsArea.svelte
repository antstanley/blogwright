<!-- Brush zoom is local to this report; global query dates and table rows stay intact. -->
<script lang="ts">
  import { AreaChart } from 'layerchart';
  import { scaleUtc } from 'd3-scale';
  import type { QueryRow } from '../../../src/ports.js';
  import { VIEW_GRANULARITIES, type ViewGranularity } from '../../../src/view-granularity.js';
  import { TRAFFIC_SERIES } from './traffic-series.js';
  import { formatCount, labelCell, numericCell } from './format.js';

  const MINUTE_MS = 60_000;
  let { rows, granularity, stacked = false }: { rows: readonly QueryRow[]; granularity: ViewGranularity; stacked?: boolean } = $props();
  const points = $derived(rows.map(row => ({
    day: new Date(labelCell(row, 'day').length === 10 ? `${labelCell(row, 'day')}T00:00:00Z` : labelCell(row, 'day')),
    views: numericCell(row, 'views'),
    non_bot: numericCell(row, 'non_bot'),
    bot: numericCell(row, 'bot'),
  })));
  let revision = $state(0);
  let selected = $state('');
  let windowStart = $state('');
  let windowEnd = $state('');
  let windowError = $state('');
  let domain = $state<[Date, Date]>();
  const windowId = $props.id();
  const firstPoint = $derived(points[0]?.day);
  const lastPoint = $derived(points.at(-1)?.day);

  function showWindow(first: Date, last: Date): void {
    domain = [first, last];
    windowStart = first.toISOString().slice(0, -1);
    windowEnd = last.toISOString().slice(0, -1);
    selected = `${windowStart.replace('T', ' ')} to ${windowEnd.replace('T', ' ')} (UTC)`;
    windowError = '';
    revision += 1;
  }

  function applyWindow(event: SubmitEvent): void {
    event.preventDefault();
    const first = new Date(`${windowStart}Z`);
    const last = new Date(`${windowEnd}Z`);
    const minimum = VIEW_GRANULARITIES[granularity].minutes * MINUTE_MS;
    if (!firstPoint || !lastPoint || !Number.isFinite(first.getTime()) ||
        !Number.isFinite(last.getTime()) || first < firstPoint || last > lastPoint ||
        last.getTime() - first.getTime() < minimum) {
      windowError = `Choose bounds within the plotted period, at least ${VIEW_GRANULARITIES[granularity].label} apart.`;
      return;
    }
    showWindow(first, last);
  }

  function formatDay(value: number | Date): string {
    const iso = new Date(value).toISOString();
    return granularity === '24h' ? iso.slice(5, 10) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
  }

  function resetZoom(): void {
    revision += 1;
    selected = '';
    domain = undefined;
    windowStart = '';
    windowEnd = '';
    windowError = '';
  }
</script>

<div class="views-area-toolbar">
  <p class="panel-note">Drag across the chart or enter a chart window below (UTC).</p>
  <button type="button" onclick={resetZoom}>Reset zoom</button>
</div>
{#if points.length > 1}
  <form class="chart-window" onsubmit={applyWindow} aria-label="Chart window">
    <label>Chart start (UTC)<input type="datetime-local" step="any" required bind:value={windowStart}
      min={firstPoint?.toISOString().slice(0, -1)} max={lastPoint?.toISOString().slice(0, -1)}
      aria-invalid={windowError ? 'true' : undefined} aria-describedby={windowError ? windowId : undefined} /></label>
    <label>Chart end (UTC)<input type="datetime-local" step="any" required bind:value={windowEnd}
      min={firstPoint?.toISOString().slice(0, -1)} max={lastPoint?.toISOString().slice(0, -1)}
      aria-invalid={windowError ? 'true' : undefined} aria-describedby={windowError ? windowId : undefined} /></label>
    <button type="submit">Apply chart window</button>
    {#if windowError}<p id={windowId} class="panel-error" role="alert">{windowError}</p>{/if}
  </form>
{/if}
{#key rows}
  {#key revision}
    <div class="views-area-chart">
      <AreaChart
        data={points}
        {...(stacked ? { series: TRAFFIC_SERIES } : {})}
        seriesLayout={stacked ? 'stack' : 'overlap'}
        x="day"
        xScale={scaleUtc()}
        y="views"
        xNice={false}
        xDomain={domain}
        points={points.length === 1}
        padding={{ left: 56, right: 16, top: 16, bottom: 32 }}
        brush={{
          axis: 'x',
          zoomOnBrush: false,
          disabled: points.length < 2,
          minExtent: { x: VIEW_GRANULARITIES[granularity].minutes * MINUTE_MS },
          onBrushEnd: ({ brush }) => {
            const first = brush.x[0];
            const last = brush.x[1];
            if (first instanceof Date && last instanceof Date) showWindow(first, last);
            else resetZoom();
          },
        }}
        props={{
          tooltip: { header: { format: (value: unknown) => value instanceof Date || typeof value === 'number' ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} (UTC)` : '' } },
          xAxis: { format: formatDay, ticks: granularity === '24h' ? 5 : 3 },
          yAxis: { format: formatCount, ticks: 4 },
          area: { ...(stacked ? {} : { fill: 'var(--color-primary)', stroke: 'var(--color-primary)' }), fillOpacity: stacked ? 0.55 : 0.2, strokeWidth: 2 },
        }}
      />
    </div>
  {/key}
{/key}
<p class="panel-note" role="status">{selected ? `Chart window: ${selected}. The table retains the full reporting period.` : 'Showing the full reporting period.'}</p>
