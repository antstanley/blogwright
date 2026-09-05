<!--
  The dashboard: one date range, one choice about bot traffic, and a panel per
  named query.

  The controls live here and the requests live in the panels, so changing the
  range re-runs seven independent queries and the page never blocks on the
  slowest one. An unusable range is caught once, here, instead of arriving as
  seven identical refusals.
-->
<script lang="ts">
  import { CalendarDays, RefreshCw } from '@lucide/svelte';
  import type { BotInclusion, QueryRequest } from '../lib/api.js';
  import { PANELS } from '../lib/panels.js';
  import PillRadio from '../lib/PillRadio.svelte';
  import QueryPanel from '../lib/QueryPanel.svelte';
  import ThemeToggle from '../lib/ThemeToggle.svelte';
  import { pathProblem } from '../../../src/path-filter.js';
  import { defaultRange, rangeProblem, presetRange, PERIODS, type Period } from '../../../src/reporting-range.js';

  /** What the page opens on, read once so a rendering never moves the window. */
  const OPENING_RANGE = defaultRange();

  /** What each bot-inclusion choice is called on screen. */
  const botOptions: readonly { value: BotInclusion; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'include', label: 'Include bots' },
    { value: 'exclude', label: 'Exclude bots' },
  ];

  let from = $state(OPENING_RANGE.from);
  let to = $state(OPENING_RANGE.to);
  let path = $state('');
  let refreshVersion = $state(0);
  let bots = $state<BotInclusion>('all');

  let selectedPeriod = $state<Period | 'custom'>('custom');

  function choosePeriod(period: Period): void {
    const range = presetRange(period);
    from = range.from;
    to = range.to;
    selectedPeriod = period;
  }

  const problem = $derived(rangeProblem({ from, to }) ?? pathProblem(path));
  const request = $derived<QueryRequest>({ range: { from, to }, bots, path });
</script>

<svelte:head>
  <title>Analytics · Blogwright</title>
</svelte:head>

<main class="page">
  <header class="page-header">
    <div class="page-heading">
      <p class="eyebrow">Blogwright / Analytics</p>
      <h1>Traffic overview</h1>
      <p>Understand how readers reach your site. All days are grouped in UTC.</p>
    </div>
    <div class="header-actions">
      <ThemeToggle />
      <button class="refresh-button" type="button" aria-label="Refresh data" title="Refresh data"
        onclick={() => refreshVersion += 1}>
        <RefreshCw size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  </header>

  <div class="filter-bar">
    <div class="filter-heading"><strong>Reporting window</strong><span>Dates and times in UTC</span></div>
    <div class="filter-controls">
      <div class="bot-control">
        <span>Traffic</span>
        <PillRadio label="Traffic" options={botOptions} bind:value={bots} />
      </div>
      <div class="period-presets" role="group" aria-label="Reporting period">
        {#each PERIODS as period (period.value)}
          <button type="button" aria-pressed={selectedPeriod === period.value}
            onclick={() => choosePeriod(period.value)}>{period.label}</button>
        {/each}
        <button type="button" aria-pressed={selectedPeriod === 'custom'}
          onclick={() => selectedPeriod = 'custom'}>Custom</button>
      </div>
      <div class="controls">
        <label class="control">
          <span>From</span>
          <span class="control-field">
            <input type="datetime-local" step="60" oninput={() => selectedPeriod = 'custom'} bind:value={from} max={to} />
            <CalendarDays class="control-icon" size={18} aria-hidden="true" />
          </span>
        </label>
        <label class="control">
          <span>To</span>
          <span class="control-field">
            <input type="datetime-local" step="60" oninput={() => selectedPeriod = 'custom'} bind:value={to} min={from} />
            <CalendarDays class="control-icon" size={18} aria-hidden="true" />
          </span>
        </label>
      </div>
      <div class="path-filter">
        <label class="control path-control">
          <span>Path</span>
          <input type="text" bind:value={path} placeholder="/docs" aria-describedby="path-hint" spellcheck="false" />
        </label>
        <p id="path-hint">Includes subpaths. Leave blank for all paths.</p>
      </div>
    </div>
  </div>

  {#if problem !== undefined}
    <p class="range-error" role="alert">{problem}</p>
  {:else}
    <div class="panels">
      {#each PANELS as panel (panel.name)}
        <QueryPanel {panel} {request} {refreshVersion} />
      {/each}
    </div>
  {/if}
</main>
