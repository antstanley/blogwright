<!-- Country-scoped daily uniques; daily counts must not be summed into distinct period viewers. -->
<script lang="ts">
  import { AreaChart } from 'layerchart';
  import { scaleUtc } from 'd3-scale';
  import { runNamedQuery, type QueryRequest } from './api.js';
  import { formatCount, labelCell, numericCell } from './format.js';
  import { TRAFFIC_SERIES } from './traffic-series.js';
  import TrafficLegend from './TrafficLegend.svelte';

  let { code, request, refreshVersion }: { code: string; request: QueryRequest; refreshVersion: number } = $props();
  let retry = $state(0);
  const stacked = $derived(request.bots === 'all');
  const answer = $derived({
    refreshVersion, retry,
    promise: /^[A-Z]{2}$/.test(code)
      ? runNamedQuery('unique-visitors', { range: request.range, bots: request.bots, ...(request.path ? { path: request.path } : {}), country: code })
      : Promise.resolve(undefined),
  });
</script>

<p class="country-detail-filters">{request.bots === 'exclude' ? 'Bots excluded' : request.bots === 'all' ? 'Bot and non-bot viewers' : 'Bots included'}{request.path ? ` · Path: ${request.path} and subpaths` : ''}</p>
{#await answer.promise}
  <div class="panel-state" role="status">Loading country viewers…</div>
{:then result}
  {#if result === undefined}
    <div class="panel-state">This map region has no country code in the analytics data.</div>
  {:else if result.rows.length === 0 || result.rows.every(row => numericCell(row, 'daily_unique_visitors') === 0)}
    <div class="panel-state">No viewers for this country in the selected period and filters.</div>
  {:else}
    {@const points = result.rows.map(row => ({ day: new Date(`${labelCell(row, 'day')}T00:00:00Z`), viewers: numericCell(row, 'daily_unique_visitors'), non_bot: numericCell(row, 'non_bot'), bot: numericCell(row, 'bot') }))}
    {#if stacked}<TrafficLegend />{/if}
    <div class="country-detail-chart">
      <AreaChart data={points} x="day" y="viewers" xScale={scaleUtc()} xNice={false}
        {...stacked ? { series: TRAFFIC_SERIES } : {}}
        seriesLayout={stacked ? 'stack' : 'overlap'} points={points.length === 1}
        padding={{ left: 48, right: 16, top: 16, bottom: 32 }}
        props={{
          xAxis: { format: (value: number | Date) => new Date(value).toISOString().slice(5, 10), ticks: 5 },
          yAxis: { format: formatCount, ticks: 4 },
          tooltip: { header: { format: (value: unknown) => value instanceof Date || typeof value === 'number' ? new Date(value).toISOString().slice(0, 10) + ' (UTC)' : '' } },
          area: { ...(stacked ? {} : { fill: 'var(--color-primary)', stroke: 'var(--color-primary)' }), fillOpacity: stacked ? 0.55 : 0.2, strokeWidth: 2 },
        }} />
    </div>
    <p class="panel-note">Unique viewers per UTC day, within the selected period. Returning viewers can appear on multiple days.</p>
    <details class="panel-data">
      <summary>View daily counts</summary>
      <table><caption>Daily unique viewers</caption><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Viewers</th></tr></thead>
        <tbody>{#each points as point (point.day.toISOString())}<tr><th scope="row">{point.day.toISOString().slice(0, 10)}</th><td>{formatCount(point.viewers)}</td></tr>{/each}</tbody>
      </table>
    </details>
  {/if}
{:catch error}
  <div class="panel-state" role="alert">
    <p>{error instanceof Error ? error.message : 'Unable to load country viewers.'}</p>
    <button type="button" class="country-search-clear" onclick={() => retry += 1}>Retry</button>
  </div>
{/await}
