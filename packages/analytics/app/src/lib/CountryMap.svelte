<!-- Offline Equal Earth map; the surrounding report table retains every source row. -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import CountryDetails from './CountryDetails.svelte';
  import type { QueryRequest } from './api.js';
  import { Chart, Svg } from 'layerchart';
  import { GeoProjection, GeoPath } from 'layerchart/geo';
  import { geoEqualEarth } from 'd3-geo';
  import { countries } from './world-map.js';
  import { searchCountries } from './country-search.js';
  import type { QueryRow } from '../../../src/ports.js';
  import { formatCount, labelCell, numericCell } from './format.js';

  let { rows, request, refreshVersion }: { rows: readonly QueryRow[]; request: QueryRequest; refreshVersion: number } = $props();
  let detailOpen = $state(false);
  let mapWidth = $state(0);
  let detailCountry = $state<{ code: string; name: string }>();
  let selectionSource: HTMLElement | SVGElement | undefined;
  const searchId = $props.id();
  let countrySearch = $state('');
  let selectedName = $state('');
  const matches = $derived(searchCountries(countrySearch));
  const highlightedCountry = $derived(matches.find(country => country.properties.name === selectedName) ?? matches[0]);
  const values = $derived(new Map(rows.map(row => [labelCell(row, 'country').toUpperCase(), numericCell(row, 'views')])));
  const highlightedValue = $derived(highlightedCountry && highlightedCountry.properties.code !== '-99' ? values.get(highlightedCountry.properties.code) : undefined);
  const maximum = $derived(Math.max(0, ...values.values()));
  const mappedCodes = new Set(countries.map(country => country.properties.code).filter(code => code !== '-99'));
  const unmapped = $derived(rows.filter(row => !mappedCodes.has(labelCell(row, 'country').toUpperCase())));

  function selectCountry(country: (typeof countries)[number], source: HTMLElement | SVGElement): void {
    countrySearch = country.properties.name;
    selectedName = country.properties.name;
    detailCountry = country.properties;
    selectionSource = source;
    detailOpen = true;
  }

  function fill(value: number | undefined): string {
    if (value === undefined || value <= 0) return 'var(--color-surface-200)';
    return `color-mix(in srgb, var(--color-primary) ${20 + 80 * value / maximum}%, var(--color-surface-200))`;
  }
</script>

<div class="country-map" bind:clientWidth={mapWidth}>
  <div class="country-search">
    <label class="control" for={searchId}>
      <span>Find country</span>
      <input id={searchId} type="search" bind:value={countrySearch} maxlength={80}
        placeholder="Search country name" autocomplete="off" spellcheck="false"
        aria-describedby={`${searchId}-status`}
        oninput={() => selectedName = ''}
        onkeydown={(event) => { if (event.key === 'Escape') { countrySearch = ''; selectedName = ''; } }} />
    </label>
    {#if countrySearch.trim() !== ''}
      <button class="country-search-clear" type="button" onclick={() => { countrySearch = ''; selectedName = ''; }}>Clear</button>
    {/if}
  </div>
  {#if matches.length > 0}
    <ul class="country-search-results" aria-label="Matching countries">
      {#each matches as country (country.properties.name)}
        <li><button type="button" aria-pressed={highlightedCountry === country}
          onfocus={() => selectedName = country.properties.name}
          onclick={(event) => selectCountry(country, event.currentTarget)}>{country.properties.name}</button></li>
      {/each}
    </ul>
  {/if}
  <p id={`${searchId}-status`} class="country-search-status" role="status">
    {#if highlightedCountry}
      Highlighted: {highlightedCountry.properties.name} · {highlightedValue === undefined ? 'No data in this range' : `${formatCount(highlightedValue)} requests`}
    {:else if countrySearch.trim() !== ''}
      No matching country on this map.
    {/if}
  </p>
  <div class="country-map-plot">
    <Chart padding={8}>
      <GeoProjection projection={geoEqualEarth} fitGeojson={{ type: 'Sphere' }}>
        <Svg role="group" aria-label="World map of requests by country. Select a country for daily viewers.">
          {#each countries as country, index (index)}
            {@const value = country.properties.code === '-99' ? undefined : values.get(country.properties.code)}
            <GeoPath geojson={country} fill={fill(value)} aria-label={`${country.properties.name}: ${value === undefined ? 'No data' : `${formatCount(value)} requests`}`}>
              {#snippet children({ geoPath })}
                <path d={geoPath?.(country) ?? ''} style:fill={fill(value)}
                  class:country-search-muted={highlightedCountry !== undefined}
                  role="button" tabindex="0" aria-label={`View ${country.properties.name} details`}
                  onclick={(event) => selectCountry(country, event.currentTarget)}
                  onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCountry(country, event.currentTarget); } }}>
                  <title>{country.properties.name}: {value === undefined ? 'No data' : `${formatCount(value)} requests`}</title>
                </path>
              {/snippet}
            </GeoPath>
          {/each}
          {#if highlightedCountry}
            <GeoPath geojson={highlightedCountry}>
              {#snippet children({ geoPath })}
                <path d={geoPath?.(highlightedCountry) ?? ''} class="country-search-highlight"
                  role="button" tabindex="0" aria-label={`View ${highlightedCountry.properties.name} details`}
                  onclick={(event) => selectCountry(highlightedCountry, event.currentTarget)}
                  onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCountry(highlightedCountry, event.currentTarget); } }}>
                  <title>{highlightedCountry.properties.name}: {highlightedValue === undefined ? 'No data' : `${formatCount(highlightedValue)} requests`}</title>
                </path>
              {/snippet}
            </GeoPath>
          {/if}
        </Svg>
      </GeoProjection>
    </Chart>
  </div>
  <div class="map-legend" aria-label="Map colour scale">
    <span><i style:background={fill(undefined)}></i>No data / zero</span>
    {#if maximum > 0}
    <span><i style:background={fill(1)}></i>1 request</span>
    <span><i style:background={fill(maximum)}></i>{formatCount(maximum)} requests</span>
    {/if}
  </div>
  <p class="panel-note">Colour intensity scales linearly with request count. Hover a country for its value, or open the data table for full details.</p>
  {#if unmapped.length > 0}
    <p class="panel-note">Not shown on this map: {unmapped.map(row => `${labelCell(row, 'country')} (${formatCount(numericCell(row, 'views'))})`).join(', ')}. These rows remain in the data table.</p>
  {/if}
  <p class="panel-note">Map: Natural Earth, simplified country boundaries. Small territories may not be represented.</p>
</div>

<Dialog.Root bind:open={detailOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="country-detail-overlay" />
    <Dialog.Content class="country-detail-dialog" style={`--country-detail-width: ${mapWidth}px`} onCloseAutoFocus={(event) => { event.preventDefault(); selectionSource?.focus(); }}>
      <div class="country-detail-heading">
        <div>
          <Dialog.Title class="country-detail-title">{detailCountry?.name} · Viewers over time</Dialog.Title>
          <Dialog.Description class="country-detail-period">{request.range.from.replace('T', ' ')} to {request.range.to.replace('T', ' ')} UTC</Dialog.Description>
        </div>
        <Dialog.Close class="country-detail-close" aria-label="Close country details"><X size={20} aria-hidden="true" /></Dialog.Close>
      </div>
      {#if detailOpen && detailCountry}
        <CountryDetails code={detailCountry.code} {request} {refreshVersion} />
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
