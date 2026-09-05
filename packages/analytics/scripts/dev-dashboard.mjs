/** Local development entry point: serve the built dashboard with synthetic rows only. */
import { normalizePathFilter } from '../dist/path-filter.js';
import { VIEW_GRANULARITIES, parseViewGranularity } from '../dist/view-granularity.js';
import { fileURLToPath } from 'node:url';

import { createDashboardServer } from '../dist/server.js';
import { createNodeFileSystem } from '../../core/dist/adapters/node-fs.js';
import { createFixtureAnalyticsQuery } from '../dist/fixture-query.js';
const DAY_MS = 86_400_000;
const PREVIEW_DAYS = 30;
const PREVIEW_PORT = 4318;
const today = new Date();
const days = Array.from({ length: PREVIEW_DAYS }, (_, index) => ({
  day: new Date(today.getTime() - (PREVIEW_DAYS - 1 - index) * DAY_MS).toISOString().slice(0, 10),
  views: 220 + index * 18 + (index % 4) * 70,
}));
const summedDailyUniqueVisitors = days.reduce((sum, day) => sum + day.views - 30, 0);
const fixtures = {
  'views-over-time': days,
  'unique-visitors': days.map((d) => ({
    day: d.day,
    daily_unique_visitors: d.views - 30,
    summed_daily_unique_visitors: summedDailyUniqueVisitors,
  })),
  'top-paths': Array.from({ length: 15 }, (_, i) => ({
    uri:
      [
        '/',
        '/writing/building-a-personal-site',
        '/notes/a-very-long-path-that-needs-to-remain-readable',
      ][i % 3] + (i || ''),
    views: 1800 - i * 95,
  })),
  referrers: [
    { referrer: 'https://www.google.com', views: 2500 },
    { referrer: 'https://news.ycombinator.com', views: 1480 },
    { referrer: 'https://example.com/a-long-referrer-address', views: 840 },
  ],
  countries: [
    { country: 'US', views: 4500 },
    { country: 'GB', views: 2400 },
    { country: 'ZA', views: 1800 },
  ],
  'status-codes': [
    { status: 200, views: 14000 },
    { status: 304, views: 2800 },
    { status: 404, views: 130 },
  ],
  'cache-hit-ratio': days.map((d) => ({
    day: d.day,
    requests: d.views,
    cache_hits: Math.floor(d.views * 0.86),
    cache_hit_ratio: Math.floor(d.views * 0.86) / d.views,
  })),
};
const fixtureQuery = createFixtureAnalyticsQuery(fixtures, { bots: 'filter' });
const MINUTE_MS = 60_000;
/** Synthetic buckets cover the selected window, including partially selected buckets. */
function previewViews(params, minutes) {
  const { from, to } = params.range;
  const start = Date.parse(from.length === 10 ? `${from}T00:00:00Z` : from);
  const end =
    Date.parse(to.length === 10 ? `${to}T00:00:00Z` : to) + (to.length === 10 ? DAY_MS : 0);
  const bucketMs = minutes * MINUTE_MS;
  const result = [];
  for (let bucket = Math.floor(start / bucketMs) * bucketMs; bucket < end; bucket += bucketMs) {
    const overlap = Math.min(end, bucket + bucketMs) - Math.max(start, bucket);
    const dayIndex = Math.floor(bucket / DAY_MS);
    const dailyViews = 400 + (dayIndex % 7) * 60;
    result.push({
      day: new Date(bucket).toISOString().slice(0, minutes === 1440 ? 10 : 24),
      views: Math.max(1, Math.round((dailyViews * overlap) / DAY_MS)),
    });
  }
  return result;
}
/** Scope synthetic reports by the matching path fixtures, with proportional mock counts. */
function scopePreviewRows(name, rows, pathInput) {
  const path = normalizePathFilter(pathInput);
  if (path === undefined || path === '/') return rows;
  const matching = fixtures['top-paths'].filter(
    (row) => row.uri === path || row.uri.startsWith(`${path}/`),
  );
  if (name === 'top-paths') return matching;
  if (matching.length === 0) return [];
  const allViews = fixtures['top-paths'].reduce((sum, row) => sum + row.views, 0);
  const share = matching.reduce((sum, row) => sum + row.views, 0) / allViews;
  const scoped = rows.map((row) => {
    if (name === 'cache-hit-ratio') {
      const requests = Math.max(1, Math.round(row.requests * share));
      const cache_hits = Math.round(requests * row.cache_hit_ratio);
      return { ...row, requests, cache_hits, cache_hit_ratio: cache_hits / requests };
    }
    const column = name === 'unique-visitors' ? 'daily_unique_visitors' : 'views';
    return { ...row, [column]: Math.round(row[column] * share) };
  });
  if (name === 'unique-visitors') {
    const total = scoped.reduce((sum, row) => sum + row.daily_unique_visitors, 0);
    return scoped.map((row) => ({ ...row, summed_daily_unique_visitors: total }));
  }
  return scoped;
}
const query = {
  async run(name, params) {
    const rows = scopePreviewRows(name, await previewQuery.run(name, params), params.path);
    if (!params.splitBots) return rows;
    const value =
      name === 'unique-visitors'
        ? 'daily_unique_visitors'
        : name === 'cache-hit-ratio'
          ? 'cache_hit_ratio'
          : 'views';
    return rows.map((row, index) => {
      const share = 0.15 + (index % 5) * 0.04;
      const bot = name === 'cache-hit-ratio' ? row[value] * share : Math.round(row[value] * share);
      return { ...row, bot, non_bot: row[value] - bot };
    });
  },
};
const previewQuery = {
  async run(name, params) {
    const rows = await fixtureQuery.run(name, params);
    if (name === 'views-over-time') {
      return previewViews(
        params,
        VIEW_GRANULARITIES[parseViewGranularity(params.granularity)].minutes,
      );
    }
    if (name === 'unique-visitors') {
      const daily = previewViews(params, 1440);
      const total = daily.reduce((sum, day) => sum + Math.round(day.views * 0.8), 0);
      return daily.map((day) => ({
        day: day.day,
        daily_unique_visitors: Math.round(day.views * 0.8),
        summed_daily_unique_visitors: total,
      }));
    }
    if (name === 'cache-hit-ratio') {
      return previewViews(params, 1440).map((day) => ({
        day: day.day,
        requests: day.views,
        cache_hits: Math.floor(day.views * 0.86),
        cache_hit_ratio: Math.floor(day.views * 0.86) / day.views,
      }));
    }
    return rows;
  },
};
const server = await createDashboardServer({
  query,
  config: { bots: 'filter' },
  port: PREVIEW_PORT,
  appDir: fileURLToPath(new URL('../dist/app/', import.meta.url)),
  fs: createNodeFileSystem(),
});
async function stop() {
  await server.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

console.log(
  `Mock analytics dashboard: ${server.url}\nSynthetic data only; no AWS access. Time-series fixtures follow the selected window; path filters proportionally scope mock reports; bot filtering remains synthetic.\nRe-run pnpm dev:analytics after editing the UI. Press Ctrl+C to stop.`,
);
