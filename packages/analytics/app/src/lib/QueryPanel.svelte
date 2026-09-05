<!--
  One panel: a heading, the query's own description of what a row means, and a
  bar chart of it.

  **The description under the heading is the server's `rowMeaning`, not this
  component's words.** That is what keeps `unique-visitors` honest: its meaning
  states that a range total is the sum of daily counts and not a distinct count
  across days, and a panel that wrote its own subtitle is exactly where that
  would be lost. The range total below the chart is labelled from the result
  column's own name for the same reason.

  Every panel runs its own request, so one query failing leaves the other six
  drawn. A refusal shows the server's sentence - an inverted range, an
  application that has not been built - rather than an empty chart the reader
  has to explain to themselves.
-->
<script lang="ts">
  import { BarChart } from 'layerchart';
  import CountryMap from './CountryMap.svelte';

  import { runNamedQuery, type QueryRequest, type QueryResult } from './api.js';
  import {
    formatCount,
    formatRatio,
    humaniseColumn,
    labelCell,
    numericCell,
    shortenDay,
    shortenLabel,
  } from './format.js';
  import { type Panel, RANKING_LIMIT } from './panels.js';

  /** How many ticks a value axis carries. Enough to read a magnitude off, not a table. */
  const VALUE_AXIS_TICKS = 3;

  /** How many ticks a category axis carries when the categories are dense - a month of days. */
  const CATEGORY_AXIS_TICKS = 4;

  /** One point of the chart: a category and the value measured for it. */
  interface ChartPoint {
    /** The category, as the query returned it - shortened only when it is drawn. */
    readonly label: string;
    /** The measured value. */
    readonly value: number;
  }

  let { panel, request }: { panel: Panel; request: QueryRequest } = $props();

  let countryView = $state<'map' | 'bars'>('map');

  const answer = $derived(runNamedQuery(panel.name, request));

  /** Render a value the way this panel's value column reads. */
  function formatValue(value: number): string {
    return panel.valueKind === 'ratio' ? formatRatio(value) : formatCount(value);
  }

  /** The axis carrying the measured value: formatted, and thinned to a readable few. */
  const valueAxis = $derived({ format: formatValue, ticks: VALUE_AXIS_TICKS });

  /**
   * The axis carrying the category. A ranking's labels are paths and URLs, so
   * they are shortened and every one is drawn down the side.
   *
   * Everything else runs along the bottom, where the width of a panel is the
   * budget: a month of days is thinned to {@link CATEGORY_AXIS_TICKS} ticks
   * *and* each day is drawn without its year, because six `YYYY-MM-DD` labels
   * are wider than the plot area of the narrowest column this grid lays out
   * and run together into `2026-08-2026-08-...`. {@link shortenDay} only
   * touches day-shaped labels, so the status-code panel - the other unranked
   * one - is drawn exactly as its query returned it.
   */
  const categoryAxis = $derived(
    panel.ranked
      ? { format: shortenLabel }
      : { format: shortenDay, ticks: CATEGORY_AXIS_TICKS },
  );

  /**
   * The rows to draw. A ranking is cut at {@link RANKING_LIMIT} from the front
   * of the list the query already ordered - never re-sorted here, so the chart
   * shows the query's own ranking.
   */
  function pointsOf(result: QueryResult): ChartPoint[] {
    const rows = panel.ranked ? result.rows.slice(0, RANKING_LIMIT) : result.rows;
    return rows.map((row) => ({
      label: labelCell(row, panel.category),
      value: numericCell(row, panel.value),
    }));
  }

  /** The range total, if this panel's query carries one, with the column's own label. */
  function totalOf(result: QueryResult): { label: string; value: string } | undefined {
    const column = panel.totalColumn;
    const first = result.rows[0];
    if (column === undefined || first === undefined) return undefined;
    return { label: humaniseColumn(column), value: formatCount(numericCell(first, column)) };
  }
</script>

<section class="panel" class:panel-ranked={panel.ranked} class:panel-primary={panel.name === 'views-over-time' || panel.name === 'countries'}>
  <div class="panel-heading">
    <h2>{panel.title}</h2>
    {#if panel.name === 'countries'}
      <fieldset class="country-view" aria-label="Countries view">
        <label><input type="radio" value="map" bind:group={countryView} />Map</label>
        <label><input type="radio" value="bars" bind:group={countryView} />Bars</label>
      </fieldset>
    {/if}
  </div>

  {#await answer}
    <p class="panel-meaning">&nbsp;</p>
    <div class="panel-state" role="status">Loading report…</div>
  {:then result}
    <p class="panel-meaning">{result.rowMeaning}</p>
    {#if result.rows.length === 0}
      <div class="panel-state" role="status">No rows in this range.</div>
    {:else}
      {@const points = pointsOf(result)}
      {@const total = totalOf(result)}
      {#if panel.name === 'countries' && countryView === 'map'}
        <CountryMap rows={result.rows} />
      {:else}
      <div class="panel-chart" style:height={panel.ranked ? `${Math.max(220, points.length * 28 + 40)}px` : undefined}>
        <BarChart
          data={points}
          x={panel.ranked ? 'value' : 'label'}
          y={panel.ranked ? 'label' : 'value'}
          orientation={panel.ranked ? 'horizontal' : 'vertical'}
          padding={panel.ranked
            ? { left: 150, bottom: 28, right: 8, top: 8 }
            : { left: 56, bottom: 32, right: 8, top: 8 }}
          props={{
            // LayerChart's bars default to a 1px black outline, which reads as
            // a border rather than as part of the mark once the fill is the
            // page's own accent.
            bars: { stroke: 'none' },
            xAxis: panel.ranked ? valueAxis : categoryAxis,
            yAxis: panel.ranked ? categoryAxis : valueAxis,
          }}
        />
      </div>
      {/if}
      <details class="panel-data">
        <summary>View chart data</summary>
        <table>
          <caption>{panel.title} — {panel.name === 'countries' ? 'all country values' : 'plotted values'}</caption>
          <thead><tr><th scope="col">{humaniseColumn(panel.category)}</th><th scope="col">{humaniseColumn(panel.value)}</th></tr></thead>
          <tbody>
            {#each (panel.name === 'countries' ? result.rows.map(row => ({ label: labelCell(row, panel.category), value: numericCell(row, panel.value) })) : points) as point, index (index)}
              <tr><th scope="row">{point.label}</th><td>{formatValue(point.value)}</td></tr>
            {/each}
          </tbody>
        </table>
      </details>
      {#if total !== undefined}
        <dl class="panel-total">
          <dt>{total.label}</dt>
          <dd>{total.value}</dd>
        </dl>
      {/if}
      {#if panel.ranked && result.rows.length > RANKING_LIMIT && (panel.name !== 'countries' || countryView === 'bars')}
        <p class="panel-note">
          Showing the top {RANKING_LIMIT} of {formatCount(result.rows.length)}.
        </p>
      {/if}
    {/if}
  {:catch error}
    <p class="panel-meaning">&nbsp;</p>
    <div class="panel-state panel-error" role="alert">{error.message}</div>
  {/await}
</section>
