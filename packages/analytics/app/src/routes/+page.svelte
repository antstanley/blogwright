<!--
  The dashboard: one date range, one choice about bot traffic, and a panel per
  named query.

  The controls live here and the requests live in the panels, so changing the
  range re-runs seven independent queries and the page never blocks on the
  slowest one. An unusable range is caught once, here, instead of arriving as
  seven identical refusals.
-->
<script lang="ts">
  import { CalendarDays, ChevronDown } from '@lucide/svelte';
  import type { BotInclusion, QueryRequest } from '../lib/api.js';
  import { PANELS } from '../lib/panels.js';
  import QueryPanel from '../lib/QueryPanel.svelte';
  import ThemeToggle from '../lib/ThemeToggle.svelte';
  import { defaultRange, rangeProblem } from '../lib/range.js';

  /** What the page opens on, read once so a rendering never moves the window. */
  const OPENING_RANGE = defaultRange();

  /** What each bot-inclusion choice is called on screen. */
  const BOT_INCLUSION_LABELS: Readonly<Record<BotInclusion, string>> = {
    'site-default': 'Site default',
    include: 'Include bots',
    exclude: 'Exclude bots',
  };

  let from = $state(OPENING_RANGE.from);
  let to = $state(OPENING_RANGE.to);
  let bots = $state<BotInclusion>('site-default');

  const problem = $derived(rangeProblem({ from, to }));
  const request = $derived<QueryRequest>({ range: { from, to }, bots });
</script>

<svelte:head>
  <title>Analytics · Blogwright</title>
</svelte:head>

<main class="page">
  <header class="page-header">
    <div>
      <p class="eyebrow">Blogwright / Analytics</p>
      <h1>Traffic overview</h1>
      <p>Understand how readers reach your site. All days are grouped in UTC.</p>
    </div>
    <ThemeToggle />
  </header>

  <div class="filter-bar">
    <div class="filter-heading"><strong>Reporting window</strong><span>Dates in UTC</span></div>
    <div class="controls">
      <label class="control">
        <span>From</span>
        <span class="control-field">
          <input type="date" bind:value={from} max={to} />
          <CalendarDays class="control-icon" size={18} aria-hidden="true" />
        </span>
      </label>
      <label class="control">
        <span>To</span>
        <span class="control-field">
          <input type="date" bind:value={to} min={from} />
          <CalendarDays class="control-icon" size={18} aria-hidden="true" />
        </span>
      </label>
      <label class="control">
        <span>Bot traffic</span>
        <span class="control-field">
        <select bind:value={bots}>
          {#each Object.entries(BOT_INCLUSION_LABELS) as [value, label] (value)}
            <option {value}>{label}</option>
          {/each}
        </select>
        <ChevronDown class="control-icon" size={18} aria-hidden="true" />
        </span>
      </label>
    </div>
  </div>

  {#if problem !== undefined}
    <p class="range-error" role="alert">{problem}</p>
  {:else}
    <div class="panels">
      {#each PANELS as panel (panel.name)}
        <QueryPanel {panel} {request} />
      {/each}
    </div>
  {/if}
</main>
