/**
 * `is_bot`: the user-agent heuristic behind step 4 of
 * [§Record transformation](../../../../.specs/changes/2026-07-26-analytics_plugin.md).
 *
 * A matched record is **flagged, never dropped**. `is_bot` is a column and
 * every dashboard query takes a bot-inclusion flag, so a wrong match costs a
 * wrong boolean that a query can ignore, while a dropped record is a page view
 * nobody can get back. That asymmetry is the whole reason this returns a
 * boolean rather than a verdict the transform acts on.
 *
 * The patterns are a deliberately small, self-declaring set rather than an
 * exhaustive registry of crawlers. Every one of them matches text an agent
 * puts in its own user agent to say what it is - `Googlebot/2.1`,
 * `python-requests/2.32`, `curl/8.7.1` - so a match is evidence from the
 * request itself, not a fingerprint. Bots that lie about their user agent are
 * out of reach of any user-agent test and are not what this is for.
 *
 * Each pattern anchors on a word boundary rather than matching a bare
 * substring, because the substrings are short enough to appear inside
 * unrelated words: `bot` alone matches `CUBOT_X30`, an Android phone. The
 * boundary is not a guarantee against every false positive - it cannot be -
 * but it removes the class of them that a plain `includes` walks straight
 * into, and the flag-don't-drop rule bounds the cost of the rest.
 *
 * Absent and empty user agents are **not** flagged. `is_bot` records that the
 * agent named itself as a known bot; a request that named no agent has named
 * nothing, and flagging it would assert something the record does not say -
 * on a column an operator filters their traffic by. It is also the wrong
 * guess in practice: no-user-agent requests are as often a stripped-down
 * client as a crawler.
 *
 * Pure data and pure functions: no clock, no `node:` builtin, no vendor SDK.
 */

/**
 * The user-agent patterns that set `is_bot`, each with an agent it is here
 * for. All are case-insensitive: agents spell these tokens every way
 * (`GPTBot`, `bingbot`, `Baiduspider`). None carries the `g` flag - a global
 * regex carries `lastIndex` between `test` calls, which would make the answer
 * depend on how many records had been matched before it.
 */
export const BOT_USER_AGENT_PATTERNS: readonly RegExp[] = [
  /bot\b/i, // Googlebot/2.1, bingbot, GPTBot, ClaudeBot, Twitterbot, UptimeRobot
  /crawler\b/i, // Barkrowler, MJ12Crawler - crawlers that avoid the word "bot"
  /spider\b/i, // Baiduspider/2.0, Sogou Spider
  /\bslurp\b/i, // Yahoo! Slurp
  /\bscrapy\b/i, // Scrapy/2.11 (+https://scrapy.org)
  /feedfetcher/i, // Feedfetcher-Google
  /facebookexternalhit/i, // link-preview fetchers that carry no bot token
  /\bheadlesschrome\b/i, // HeadlessChrome/121.0 - a real browser, driven by a script
  /\blighthouse\b/i, // Chrome-Lighthouse, the page-audit runner
  /\bcurl\//i, // curl/8.7.1
  /\bwget\b/i, // Wget/1.21.4
  /python-requests\b/i, // python-requests/2.32.3
  /python-urllib\b/i, // Python-urllib/3.12
  /\bgo-http-client\b/i, // Go-http-client/2.0
  /\bokhttp\b/i, // okhttp/4.12.0
  /\bjava\//i, // Java/21.0.2
  /\bapache-httpclient\b/i, // Apache-HttpClient/5.3
  /libwww-perl/i, // libwww-perl/6.77
];

/**
 * Whether this user agent names a known bot. Total: every input answers,
 * including an empty user agent and a request that carried none at all, both
 * of which answer `false` for the reason in the module comment above.
 */
export function isBotUserAgent(userAgent: string | undefined): boolean {
  if (userAgent === undefined) return false;
  const candidate = userAgent.trim();
  if (candidate === '') return false;
  return BOT_USER_AGENT_PATTERNS.some((pattern) => pattern.test(candidate));
}
