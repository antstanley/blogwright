import { describe, expect, it } from 'vitest';

import { BOT_USER_AGENT_PATTERNS, isBotUserAgent } from './bots.js';

/**
 * One real user agent per pattern in the list. `has a sample user agent for
 * every pattern` pins the correspondence, so a pattern added without a sample
 * fails here rather than shipping untested - the failure mode a list of
 * patterns invites is a dozen tests that all exercise the first entry.
 */
const BOT_AGENTS = [
  {
    label: 'Googlebot',
    agent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  },
  {
    label: 'Barkrowler, a crawler that never says "bot"',
    agent: 'Mozilla/5.0 (compatible; Barkrowler/0.9; +https://babbar.tech/crawler)',
  },
  {
    label: 'Baiduspider',
    agent: 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
  },
  {
    label: 'Yahoo! Slurp',
    agent: 'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
  },
  { label: 'Scrapy', agent: 'Scrapy/2.11.2 (+https://scrapy.org)' },
  {
    label: 'Feedfetcher',
    agent: 'Feedfetcher-Google; (+http://www.google.com/feedfetcher.html)',
  },
  {
    label: 'a Facebook link preview',
    agent: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  },
  {
    label: 'headless Chrome',
    agent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/121.0.6167.85 Safari/537.36',
  },
  {
    label: 'Chrome-Lighthouse',
    agent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Chrome-Lighthouse',
  },
  { label: 'curl', agent: 'curl/8.7.1' },
  { label: 'Wget', agent: 'Wget/1.21.4' },
  { label: 'python-requests', agent: 'python-requests/2.32.3' },
  { label: 'Python-urllib', agent: 'Python-urllib/3.12' },
  { label: 'the Go HTTP client', agent: 'Go-http-client/2.0' },
  { label: 'OkHttp', agent: 'okhttp/4.12.0' },
  { label: 'the Java HTTP client', agent: 'Java/21.0.2' },
  { label: 'Apache HttpClient', agent: 'Apache-HttpClient/5.3' },
  { label: 'libwww-perl', agent: 'libwww-perl/6.77' },
];

/**
 * Agents that must stay unflagged. The last three are near misses on purpose:
 * each contains the letters of a pattern inside a word that is not the token,
 * which is exactly what a bare `includes` would get wrong and what the word
 * boundaries in the pattern list exist for.
 */
const HUMAN_AGENTS = [
  {
    label: 'Chrome on Windows',
    agent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  },
  {
    label: 'Safari on iPhone',
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
  },
  {
    label: 'Firefox on Linux',
    agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0',
  },
  {
    label: 'Internet Explorer, which opens like a crawler and is not one',
    agent: 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)',
  },
  {
    label: 'a CUBOT phone, whose model name ends in the letters of "bot"',
    agent:
      'Mozilla/5.0 (Linux; Android 10; CUBOT_X30 Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
  {
    label: 'a browser shipping JavaFX, which is not the Java HTTP client',
    agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JavaFX/21.0.2 Chrome/121.0.0.0',
  },
  {
    label: 'an app called Curly, which is not curl',
    agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Curly/1.4 Safari/605.1.15',
  },
];

describe('isBotUserAgent', () => {
  it.each(BOT_AGENTS)('flags $label', ({ agent }) => {
    expect(isBotUserAgent(agent)).toBe(true);
  });

  it.each(HUMAN_AGENTS)('does not flag $label', ({ agent }) => {
    expect(isBotUserAgent(agent)).toBe(false);
  });

  it('has a sample user agent for every pattern', () => {
    expect(BOT_USER_AGENT_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of BOT_USER_AGENT_PATTERNS) {
      const matched = BOT_AGENTS.filter(({ agent }) => pattern.test(agent));
      expect(matched.length, `no sample user agent matches ${pattern.source}`).toBeGreaterThan(0);
    }
  });

  it('matches whatever case the agent spells its name in', () => {
    expect(isBotUserAgent('GOOGLEBOT/2.1')).toBe(true);
    expect(isBotUserAgent('googlebot/2.1')).toBe(true);
    expect(isBotUserAgent('GoogleBot/2.1')).toBe(true);
  });

  // A pattern carrying the `g` flag keeps `lastIndex` between calls, so the
  // second look at the same agent answers differently from the first. Both of
  // these catch that; the flag assertion says which pattern.
  it('answers the same way however many times it is asked', () => {
    const { agent } = BOT_AGENTS[0]!;
    expect(isBotUserAgent(agent)).toBe(true);
    expect(isBotUserAgent(agent)).toBe(true);
    expect(isBotUserAgent(agent)).toBe(true);
  });

  it('holds no stateful pattern', () => {
    for (const pattern of BOT_USER_AGENT_PATTERNS) {
      expect(pattern.global, `${pattern.source} carries the g flag`).toBe(false);
      expect(pattern.sticky, `${pattern.source} carries the y flag`).toBe(false);
    }
  });

  // Not a fallthrough: `is_bot` says the agent named itself a bot, and these
  // named nothing. See the module comment - the flag is what an operator
  // filters on, so guessing on it is worse than answering the question asked.
  it('does not flag a request that carried no user agent at all', () => {
    expect(isBotUserAgent(undefined)).toBe(false);
  });

  it.each([
    { label: 'an empty user agent', agent: '' },
    { label: 'a whitespace-only user agent', agent: '   ' },
    { label: "CloudFront's absence marker, should one reach here", agent: '-' },
  ])('does not flag $label', ({ agent }) => {
    expect(isBotUserAgent(agent)).toBe(false);
  });
});
