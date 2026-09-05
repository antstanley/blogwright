/** Local development entry point: serve the built dashboard with synthetic rows only. */
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
const query = createFixtureAnalyticsQuery(fixtures);
const server = await createDashboardServer({
  query,
  config: { bots: 'exclude' },
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
  `Mock analytics dashboard: ${server.url}\nSynthetic data only; no AWS access. Date and bot inputs are validated but do not filter fixture rows.\nRe-run pnpm dev:analytics after editing the UI. Press Ctrl+C to stop.`,
);
