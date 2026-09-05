<!-- The remainder is included so slice proportions cover all returned requests. -->
<script lang="ts">
  import { PieChart } from 'layerchart';
  import type { QueryRow } from '../../../src/ports.js';
  import { formatCount, formatRatio, labelCell, numericCell } from './format.js';
  import { RANKING_LIMIT } from './panels.js';

  let { rows }: { rows: readonly QueryRow[] } = $props();
  const total = $derived(rows.reduce((sum, row) => sum + numericCell(row, 'views'), 0));
  const slices = $derived.by(() => {
    const leading = rows.slice(0, RANKING_LIMIT).map((row, index) => ({
      id: `path-${index}`,
      label: labelCell(row, 'uri'),
      value: numericCell(row, 'views'),
      color: `hsl(${(215 + index * 137.5) % 360} 55% 58%)`,
    }));
    const remainder = rows.slice(RANKING_LIMIT).reduce((sum, row) => sum + numericCell(row, 'views'), 0);
    if (remainder > 0) leading.push({ id: 'remainder', label: 'Other paths', value: remainder, color: 'var(--color-surface-muted)' });
    return leading;
  });
</script>

{#if total > 0}
  <div class="paths-pie">
    <div class="paths-pie-chart">
      <PieChart data={slices} key="id" label="label" value="value" c="color" innerRadius={0} padding={12} />
    </div>
    <ul class="paths-pie-legend" aria-label="Path shares">
      {#each slices as slice (slice.id)}
        <li>
          <i style:background={slice.color} aria-hidden="true"></i>
          <span>{slice.label}</span>
          <strong>{formatRatio(slice.value / total)}</strong>
          <span class="paths-pie-count">{formatCount(slice.value)} views</span>
        </li>
      {/each}
    </ul>
  </div>
  <p class="panel-note">Share of requests across all returned paths. {#if rows.length > RANKING_LIMIT}The top {RANKING_LIMIT} paths are shown individually; remaining paths are grouped as Other paths.{/if}</p>
{:else}
  <div class="panel-state">No views in this range.</div>
{/if}
