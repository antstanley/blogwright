/** Offline country matching, including partial names, common typos, and ISO codes. */
import { countries } from './world-map.js';

const MAX_RESULTS = 5;
const MAX_QUERY_LENGTH = 80;
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryOrder = new Intl.Collator('en');

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const searchableCountries = countries.map((country) => ({
  country,
  names: [
    country.properties.name,
    ...(/^[A-Z]{2}$/.test(country.properties.code)
      ? [regionNames.of(country.properties.code) ?? '', country.properties.code]
      : []),
    ...(country.properties.code === 'US' ? ['USA', 'America'] : []),
    ...(country.properties.code === 'GB' ? ['UK', 'Britain'] : []),
  ].map(normalize),
}));

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      // Both rows are populated through the preceding column before they are read.
      current.push(
        Math.min(
          current[column - 1]! + 1,
          previous[column]! + 1,
          previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

function matchScore(name: string, query: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (query.length < 3) return Infinity;
  const distance = Math.min(...[name, ...name.split(' ')].map((word) => editDistance(word, query)));
  const tolerance = query.length < 5 ? 1 : 2;
  return distance <= tolerance ? 3 + distance : Infinity;
}

export function searchCountries(input: string): typeof countries {
  const query = normalize(input.slice(0, MAX_QUERY_LENGTH));
  if (query === '') return [];
  return searchableCountries
    .map(({ country, names }) => ({
      country,
      score: Math.min(...names.map((name) => matchScore(name, query))),
    }))
    .filter((match) => Number.isFinite(match.score))
    .sort(
      (left, right) =>
        left.score - right.score ||
        countryOrder.compare(left.country.properties.name, right.country.properties.name),
    )
    .slice(0, MAX_RESULTS)
    .map((match) => match.country);
}
