import { describe, expect, it } from 'vitest';

import { dailySalt, visitorKey } from './visitor-key.js';

/**
 * Pinned vectors. These are contracts, not sample output: `visitor_key` values
 * already written to `page_views` are only comparable with new ones while both
 * derivations produce the same digest for the same inputs. Changing either
 * algorithm - the HMAC, the SHA-256, the framing, the argument order - orphans
 * every row already in the table, so a failure here is a data question, not a
 * test to update.
 *
 * Both were computed outside this package rather than by calling the functions
 * under test: `printf '%s' '2026-08-30' | openssl dgst -sha256 -hmac '<secret>'`
 * for the salts, and a stand-alone script implementing the framing from the
 * module's doc comment for the key.
 */
const SALT_SECRET = 'K7mQ2vZp8sX1nR4tY6wB9cD3fG5hJ0lA';
const DAY = '2026-08-30';
const NEXT_DAY = '2026-08-31';
const VIEWER_IP = '203.0.113.42';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

const PINNED_SALT = 'df58b7a7db27fbd20a172b7b19885cdb0d6cbbea4fc72324dad7156e5bcb11b6';
const PINNED_NEXT_DAY_SALT = 'cce2e983445537a2a61e88ff385ecc9d23804cbe74f3359bda0cd047a73cc728';
const PINNED_VISITOR_KEY = 'ae82326052984f91b769171d0d41ce0a325e5269eb739bf91b06698bb81d2c00';

/** A SHA-256 digest as both functions render one. */
const HEX_DIGEST = /^[0-9a-f]{64}$/;

describe('dailySalt', () => {
  // The pinned vector is also what fixes the direction of the HMAC: the secret
  // is the key and the public day the message. Swapping them still produces a
  // plausible-looking digest, and nothing but a pinned value would notice.
  it('derives the pinned salt for a fixed secret and day', () => {
    expect(dailySalt(SALT_SECRET, DAY)).toBe(PINNED_SALT);
  });

  it('derives the pinned salt for the next day from the same secret', () => {
    expect(dailySalt(SALT_SECRET, NEXT_DAY)).toBe(PINNED_NEXT_DAY_SALT);
  });

  it('emits 64 lowercase hex characters', () => {
    expect(dailySalt(SALT_SECRET, DAY)).toMatch(HEX_DIGEST);
  });

  it('is stable for the same secret and day', () => {
    expect(dailySalt(SALT_SECRET, DAY)).toBe(dailySalt(SALT_SECRET, DAY));
  });

  // Two days, no clock and no fake timers: the day is an argument.
  it('turns the salt over at the day boundary', () => {
    expect(dailySalt(SALT_SECRET, DAY)).not.toBe(dailySalt(SALT_SECRET, NEXT_DAY));
  });

  it('gives two secrets two different salts for the same day', () => {
    expect(dailySalt(SALT_SECRET, DAY)).not.toBe(dailySalt(`${SALT_SECRET}!`, DAY));
  });

  it.each([
    { label: 'an empty secret', secret: '', day: DAY, expected: /salt secret/ },
    { label: 'a whitespace secret', secret: '   ', day: DAY, expected: /salt secret/ },
    { label: 'an empty day', secret: SALT_SECRET, day: '', expected: /no day/ },
    { label: 'a whitespace day', secret: SALT_SECRET, day: '  ', expected: /no day/ },
  ])('refuses to derive a salt from $label', ({ secret, day, expected }) => {
    expect(() => dailySalt(secret, day)).toThrow(expected);
  });
});

describe('visitorKey', () => {
  it('derives the pinned key for a fixed IP, user agent and salt', () => {
    expect(visitorKey(VIEWER_IP, USER_AGENT, PINNED_SALT)).toBe(PINNED_VISITOR_KEY);
  });

  it('emits 64 lowercase hex characters', () => {
    expect(visitorKey(VIEWER_IP, USER_AGENT, PINNED_SALT)).toMatch(HEX_DIGEST);
  });

  it('gives the same visitor the same key within a day', () => {
    expect(visitorKey(VIEWER_IP, USER_AGENT, PINNED_SALT)).toBe(
      visitorKey(VIEWER_IP, USER_AGENT, PINNED_SALT),
    );
  });

  // The property the whole daily rotation rests on, and the one a dashboard
  // query set has to be built around: the same visitor on two days is two
  // keys, so a `COUNT(DISTINCT visitor_key)` spanning days counts nothing real.
  it('gives one visitor two keys on two days, because the salt turned over', () => {
    const today = visitorKey(VIEWER_IP, USER_AGENT, dailySalt(SALT_SECRET, DAY));
    const tomorrow = visitorKey(VIEWER_IP, USER_AGENT, dailySalt(SALT_SECRET, NEXT_DAY));
    expect(today).toBe(PINNED_VISITOR_KEY);
    expect(tomorrow).not.toBe(today);
  });

  it('gives two different salts two different keys for one IP and user agent', () => {
    expect(visitorKey(VIEWER_IP, USER_AGENT, 'salt-one')).not.toBe(
      visitorKey(VIEWER_IP, USER_AGENT, 'salt-two'),
    );
  });

  it('separates two visitors on the same day', () => {
    expect(visitorKey(VIEWER_IP, USER_AGENT, PINNED_SALT)).not.toBe(
      visitorKey('203.0.113.43', USER_AGENT, PINNED_SALT),
    );
  });

  it('separates two user agents behind one IP', () => {
    expect(visitorKey(VIEWER_IP, USER_AGENT, PINNED_SALT)).not.toBe(
      visitorKey(VIEWER_IP, 'curl/8.7.1', PINNED_SALT),
    );
  });

  // Without length-framed inputs these pairs concatenate to the same message,
  // so two different visitors would share one key by construction.
  it.each([
    {
      label: 'the IP and the user agent',
      left: { ip: '1.2.3', userAgent: '45', salt: PINNED_SALT },
      right: { ip: '1.2.34', userAgent: '5', salt: PINNED_SALT },
    },
    {
      label: 'the user agent and the salt',
      left: { ip: VIEWER_IP, userAgent: 'a', salt: 'bc' },
      right: { ip: VIEWER_IP, userAgent: 'ab', salt: 'c' },
    },
  ])('keeps the boundary between $label unambiguous', ({ left, right }) => {
    expect(visitorKey(left.ip, left.userAgent, left.salt)).not.toBe(
      visitorKey(right.ip, right.userAgent, right.salt),
    );
  });

  // A request that sent no User-Agent header still has a viewer to count.
  it('keys a visitor who sent no user agent', () => {
    const key = visitorKey(VIEWER_IP, '', PINNED_SALT);
    expect(key).toMatch(HEX_DIGEST);
    expect(key).not.toBe(visitorKey(VIEWER_IP, USER_AGENT, PINNED_SALT));
  });

  // The table stores this value next to `user_agent` in the clear, so anything
  // of the input surviving into the output is a leak, not a formatting choice.
  it('carries neither input into its output', () => {
    const key = visitorKey(VIEWER_IP, USER_AGENT, PINNED_SALT);
    expect(key).not.toContain(VIEWER_IP);
    expect(key).not.toContain(USER_AGENT);
    expect(key).not.toContain(PINNED_SALT);
  });

  it.each([
    { label: 'no IP', ip: '', userAgent: USER_AGENT, salt: PINNED_SALT, expected: /viewer IP/ },
    {
      label: 'a blank IP',
      ip: '  ',
      userAgent: USER_AGENT,
      salt: PINNED_SALT,
      expected: /viewer IP/,
    },
    { label: 'no salt', ip: VIEWER_IP, userAgent: USER_AGENT, salt: '', expected: /no salt/ },
    { label: 'a blank salt', ip: VIEWER_IP, userAgent: USER_AGENT, salt: ' ', expected: /no salt/ },
  ])('refuses to key a visitor with $label', ({ ip, userAgent, salt, expected }) => {
    expect(() => visitorKey(ip, userAgent, salt)).toThrow(expected);
  });
});
