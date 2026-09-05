<!-- Offline Equal Earth map; the surrounding report table retains every source row. -->
<script lang="ts">
  import { Chart, Svg } from 'layerchart';
  import { GeoProjection, GeoPath } from 'layerchart/geo';
  import { geoEqualEarth } from 'd3-geo';
  import { countries } from './world-map.js';
  import type { QueryRow } from '../../../src/ports.js';
  import { formatCount, labelCell, numericCell } from './format.js';

  let { rows }: { rows: readonly QueryRow[] } = $props();
  const values = $derived(new Map(rows.map(row => [labelCell(row, 'country').toUpperCase(), numericCell(row, 'views')])));
  const maximum = $derived(Math.max(0, ...values.values()));
  const mappedCodes = new Set(countries.map(country => country.properties.code).filter(code => code !== '-99'));
  const unmapped = $derived(rows.filter(row => !mappedCodes.has(labelCell(row, 'country').toUpperCase())));

  function fill(value: number | undefined): string {
    if (value === undefined || value <= 0) return 'var(--color-surface-200)';
    return `color-mix(in srgb, var(--color-primary) ${20 + 80 * value / maximum}%, var(--color-surface-200))`;
  }
</script>

<div class="country-map">
  <div class="country-map-plot">
    <Chart padding={8}>
      <GeoProjection projection={geoEqualEarth} fitGeojson={{ type: 'Sphere' }}>
        <Svg role="img" aria-label="World map of requests by country. Exact values are in View chart data.">
          {#each countries as country, index (index)}
            {@const value = country.properties.code === '-99' ? undefined : values.get(country.properties.code)}
            <GeoPath geojson={country} fill={fill(value)} aria-label={`${country.properties.name}: ${value === undefined ? 'No data' : `${formatCount(value)} requests`}`}>
              {#snippet children({ geoPath })}
                <path d={geoPath?.(country) ?? ''} style:fill={fill(value)}>
                  <title>{country.properties.name}: {value === undefined ? 'No data' : `${formatCount(value)} requests`}</title>
                </path>
              {/snippet}
            </GeoPath>
          {/each}
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
