/** Synthetic query adapter for browser acceptance; never opens a cloud connection. */
import { fileURLToPath } from 'node:url';
import { createDashboardServer } from '../../packages/analytics/dist/server.js';
import { createNodeFileSystem } from '../../packages/core/dist/adapters/node-fs.js';

const DAY_MS = 86_400_000;
const START = Date.parse('2026-08-08T00:00:00Z');
const DAYS = 28;
const counts = Array.from({ length: DAYS }, (_, index) => ({
  day: new Date(START + index * DAY_MS).toISOString().slice(0, 10),
  views: 200 + index * 20,
  non_bot: 160 + index * 16,
  bot: 40 + index * 4,
}));
const rankings = [
  { uri: '/', views: 1200, non_bot: 1000, bot: 200 },
  {
    uri: '/guides/a-long-path-with-important-information-at-both-ends',
    views: 800,
    non_bot: 600,
    bot: 200,
  },
];
const rows = {
  'views-over-time': counts,
  'unique-visitors': counts.map((row) => ({
    ...row,
    daily_unique_visitors: row.views,
    summed_daily_unique_visitors: counts.reduce((sum, item) => sum + item.views, 0),
  })),
  'top-paths': rankings,
  countries: [
    { country: 'US', views: 1200, non_bot: 1000, bot: 200 },
    { country: 'ZA', views: 800, non_bot: 600, bot: 200 },
    { country: 'ZZ', views: 20, non_bot: 15, bot: 5 },
  ],
  referrers: [
    { referrer: 'https://example.com/a-long-referring-page', views: 400, non_bot: 320, bot: 80 },
  ],
  'status-codes': [{ status: 200, views: 2000, non_bot: 1600, bot: 400 }],
  'cache-hit-ratio': counts.map((row) => ({
    day: row.day,
    requests: row.views,
    cache_hits: row.views * 0.8,
    cache_hit_ratio: 0.8,
    non_bot: 0.64,
    bot: 0.16,
  })),
};
const server = await createDashboardServer({
  query: {
    async run(name, params) {
      if (params.path === '/empty') return [];
      if (params.path === '/failed' && name === 'referrers')
        throw new Error('Fixture report unavailable. Try another path.');
      if (params.path === '/loading') await new Promise((resolve) => setTimeout(resolve, 1500));
      return rows[name] ?? [];
    },
  },
  config: { bots: 'filter' },
  port: 4319,
  appDir: fileURLToPath(new URL('../../packages/analytics/dist/app/', import.meta.url)),
  fs: createNodeFileSystem(),
});
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
console.log(`Browser fixtures: ${server.url}`);
