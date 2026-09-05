<!-- Brush zoom is local to this report; global query dates and table rows stay intact. -->
<script lang="ts">
  import { AreaChart } from 'layerchart';
  import { scaleUtc } from 'd3-scale';
  import type { QueryRow } from '../../../src/ports.js';
  import { VIEW_GRANULARITIES, type ViewGranularity } from '../../../src/view-granularity.js';
  import { formatCount, labelCell, numericCell } from './format.js';

  const MINUTE_MS = 60_000;
  let { rows, granularity }: { rows: readonly QueryRow[]; granularity: ViewGranularity } = $props();
  const points = $derived(rows.map(row => ({
    day: new Date(labelCell(row, 'day').length === 10 ? `${labelCell(row, 'day')}T00:00:00Z` : labelCell(row, 'day')),
    views: numericCell(row, 'views'),
  })));
  let revision = $state(0);
  let selected = $state('');

  function formatDay(value: number | Date): string {
    const iso = new Date(value).toISOString();
    return granularity === '24h' ? iso.slice(5, 10) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
  }

  function resetZoom(): void {
    revision += 1;
    selected = '';
  }
</script>

<div class="views-area-toolbar">
  <p class="panel-note">Drag across the chart to zoom into a time window (UTC).</p>
  <button type="button" onclick={resetZoom}>Reset zoom</button>
</div>
{#key rows}
  {#key revision}
    <div class="views-area-chart">
      <AreaChart
        data={points}
        x="day"
        xScale={scaleUtc()}
        y="views"
        xNice={false}
        points={points.length === 1}
        padding={{ left: 56, right: 16, top: 16, bottom: 32 }}
        brush={{
          axis: 'x',
          zoomOnBrush: true,
          disabled: points.length < 2,
          minExtent: { x: VIEW_GRANULARITIES[granularity].minutes * MINUTE_MS },
          onBrushEnd: ({ brush }) => {
            const first = brush.x[0];
            const last = brush.x[1];
            selected = first instanceof Date && last instanceof Date
              ? `${new Date(first).toISOString().slice(0, 16).replace('T', ' ')} to ${new Date(last).toISOString().slice(0, 16).replace('T', ' ')} (UTC)`
              : '';
          },
        }}
        props={{
          tooltip: { header: { format: (value: unknown) => value instanceof Date || typeof value === 'number' ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} (UTC)` : '' } },
          xAxis: { format: formatDay, ticks: granularity === '24h' ? 5 : 3 },
          yAxis: { format: formatCount, ticks: 4 },
          area: { fill: 'var(--color-primary)', fillOpacity: 0.2, stroke: 'var(--color-primary)', strokeWidth: 2 },
        }}
      />
    </div>
  {/key}
{/key}
<p class="panel-note" role="status">{selected ? `Chart window: ${selected}. The table retains the full reporting period.` : 'Showing the full reporting period.'}</p>
