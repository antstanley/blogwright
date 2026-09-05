import { afterEach, expect, it, vi } from 'vitest';
import { runNamedQuery } from './api.js';

afterEach(() => vi.unstubAllGlobals());

it('requests real country-scoped daily viewers with all active report filters', async () => {
  const fetchQuery = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        name: 'unique-visitors',
        rowMeaning: 'Daily unique viewers',
        resultColumns: [],
        rows: [],
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchQuery);
  await runNamedQuery('unique-visitors', {
    country: 'ZA',
    range: { from: '2026-09-01T13:15', to: '2026-09-05T19:00' },
    path: '/docs',
    bots: 'all',
  });
  const [url] = fetchQuery.mock.calls[0] ?? [];
  const params = new URL(String(url), 'http://localhost').searchParams;
  expect(Object.fromEntries(params)).toEqual({
    country: 'ZA',
    from: '2026-09-01T13:15Z',
    to: '2026-09-05T19:00Z',
    path: '/docs',
    includeBots: 'true',
    splitBots: 'true',
  });
});
