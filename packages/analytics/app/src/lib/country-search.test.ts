import { describe, expect, it } from 'vitest';
import { searchCountries } from './country-search.js';
import { countries } from './world-map.js';

describe('country search', () => {
  it('finds every mapped country by its exact name', () => {
    for (const country of countries) {
      expect(searchCountries(country.properties.name)[0]).toBe(country);
    }
  });
  it.each([
    ['south africa', 'ZA'],
    ['  SOUTH AFRICA  ', 'ZA'],
    ['south afr', 'ZA'],
    ['germny', 'DE'],
    ['frnace', 'FR'],
    ['brazl', 'BR'],
    ['UK', 'GB'],
    ['USA', 'US'],
  ])('matches %s to %s', (query, code) => {
    expect(searchCountries(query)[0]?.properties.code).toBe(code);
  });

  it('normalizes accents', () => {
    expect(searchCountries('Côte d’Ivoire')[0]?.properties.name).toBe('Ivory Coast');
  });

  it('returns multiple ranked suggestions for ambiguous names', () => {
    const matches = searchCountries('united');
    expect(matches.length).toBeGreaterThan(1);
    expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches.some((country) => country.properties.code === 'US')).toBe(true);
  });

  it.each(['', '   ', '???', 'zzzzzzzzzz', 'x'.repeat(500)])('returns no match for %j', (query) => {
    expect(searchCountries(query)).toEqual([]);
  });

  it('searches map geography independently of traffic data', () => {
    expect(searchCountries('Fiji')[0]?.properties.code).toBe('FJ');
  });
});
