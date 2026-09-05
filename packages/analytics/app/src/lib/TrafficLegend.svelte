<!-- Both series stay visible so the stacked total always means all traffic. -->
<script lang="ts">
  import { TRAFFIC_SERIES } from './traffic-series.js';
</script>

<ul class="traffic-legend" aria-label="Traffic series">
  {#each TRAFFIC_SERIES as series (series.key)}
    <li><span style:background={series.color} aria-hidden="true"></span>{series.label}</li>
  {/each}
</ul>

<style>
  .traffic-legend { display: flex; flex-wrap: wrap; gap: 16px; list-style: none; padding: 0; margin: 0; font-size: 12px; color: var(--color-surface-muted); }
  li { display: flex; align-items: center; gap: 6px; }
  li span { width: 9px; height: 9px; border-radius: 50%; }
</style>
