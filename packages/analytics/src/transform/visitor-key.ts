/**
 * `visitor_key`: how a page view is attributed to a visitor without the table
 * ever holding a value that identifies one. This is step 3 of
 * [§Record transformation](../../../../.specs/changes/merged/2026-07-26-analytics_plugin.md):
 * the viewer IP is replaced by a SHA-256 digest over the IP, the user agent
 * and a secret daily salt, and the raw address is written to no column.
 *
 * ## The salt decision (settled 2026-07-26)
 *
 * ONE long-lived random secret lives in Secrets Manager, and the per-day salt
 * is **derived** from it: `dailySalt(secret, day) = HMAC-SHA256(secret, day)`.
 * The secret is created once and never rewritten; nothing rotates in Secrets
 * Manager. Both alternatives were considered and rejected:
 *
 * - **A salt derived from the date alone** is computable by anyone holding the
 *   table, and IPv4 is a 2^32 space - so every row brute-forces back to its
 *   source address in seconds of GPU time. The digest would look like
 *   pseudonymisation while providing none of it.
 * - **Managed rotation of the stored secret** would add a rotation Lambda, a
 *   schedule and a second execution role - more moving parts than the thing
 *   they protect - to buy exactly the daily turnover that deriving already
 *   gives for the price of one HMAC per record.
 *
 * The consequence to know before touching the stored secret: replacing it
 * after rows exist makes `visitor_key` incomparable across that boundary, and
 * no reprocessing can repair it because the old salt is gone. That is why the
 * node that provisions the secret creates it when absent and never rewrites
 * it.
 *
 * Daily turnover is deliberate and has a query consequence: a unique-visitor
 * figure is a per-day distinct count, and a range figure is the sum of those
 * daily counts - never a `COUNT(DISTINCT visitor_key)` spanning days, which
 * two salts make meaningless. One day is also the bound on what anyone holding
 * the table and one brute-forced day of salt could ever correlate.
 *
 * ## Purity
 *
 * Both functions take every input as an argument: no Secrets Manager read, no
 * environment variable, no clock, no wall-clock date anywhere. The secret
 * arrives from the transform's cold-start read and the day from the record's
 * own `timestamp(ms)` - which is what lets a backfill re-derive a historical
 * day's salt and produce a byte-identical row for a record either path could
 * have carried.
 */

import { createHash, createHmac } from 'node:crypto';

/** The one digest algorithm both derivations use. */
const DIGEST_ALGORITHM = 'sha256';

/** Digests are lowercase hex: 64 characters, safe in a `string` column. */
const DIGEST_ENCODING = 'hex';

/**
 * One input, length-prefixed, so a concatenation of several is unambiguous:
 * `("1.2.3", "45")` and `("1.2.34", "5")` both concatenate to `1.2.345` and
 * would collide, while they frame to `5:1.2.32:45` and `6:1.2.341:5`, which do
 * not. A plain separator character could not promise as much: a user agent is
 * attacker-supplied text and may contain whatever separator was chosen, which
 * would let two different visitors collide onto one key by construction.
 *
 * The count is in UTF-8 bytes because that is the encoding `update` applies to
 * a string, so the frame describes the bytes actually hashed.
 */
function framed(value: string): string {
  return `${Buffer.byteLength(value)}:${value}`;
}

/**
 * The salt for one UTC day: `HMAC-SHA256(secret, day)` over the long-lived
 * stored secret and the `day` the record already carries (`YYYY-MM-DD`).
 *
 * The secret is the key and the day the message, not the other way round: the
 * day is public, and only a secret key gives the output a value an attacker
 * cannot compute.
 *
 * Throws rather than deriving from an empty secret or an empty day. An empty
 * secret yields a salt anyone can recompute, and an empty day yields one salt
 * for all time - both produce a `visitor_key` that looks protected and is not,
 * which is worse than a failed batch that says so.
 */
export function dailySalt(secret: string, day: string): string {
  if (secret.trim() === '') {
    throw new Error(
      'dailySalt was given no salt secret: an empty secret makes every visitor_key recomputable by anyone holding the table',
    );
  }
  if (day.trim() === '') {
    throw new Error(
      'dailySalt was given no day: an empty day gives every record the same salt, so the daily turnover visitor_key depends on never happens',
    );
  }
  return createHmac(DIGEST_ALGORITHM, secret).update(day).digest(DIGEST_ENCODING);
}

/**
 * The pseudonymous visitor identifier: a SHA-256 digest over the viewer IP,
 * the user agent and that day's salt, as lowercase hex.
 *
 * Why this construction is enough for what it is asked to do. The key must be
 * stable within a day (so a visitor counts once), unguessable from the table
 * (which stores `user_agent` in the clear beside it), and irreversible. A hash
 * alone would satisfy none of the last two: an IPv4 address is a 32-bit space,
 * so an unsalted digest is a lookup table. The secret salt is what removes
 * that, and the daily salt is what bounds the correlation window to a day. The
 * salt is hashed last, so no length-extension property of Merkle-Damgård
 * applies to a secret prefix.
 *
 * An empty `userAgent` is a legitimate input, not an error: a request that
 * sent no `User-Agent` header still has a viewer IP, and its visitor is still
 * countable. An absent user agent and an empty one are deliberately the same
 * input, because they are the same fact about the request.
 *
 * Throws when the IP or the salt is empty. Without a salt the digest is
 * brute-forceable; without an IP the key would be a digest of the user agent
 * alone, which would collapse every anonymous request in a day onto one
 * fabricated "returning visitor". The caller leaves the column empty instead -
 * an unknown visitor is what a null says.
 */
export function visitorKey(ip: string, userAgent: string, salt: string): string {
  if (ip.trim() === '') {
    throw new Error(
      'visitorKey was given no viewer IP: a key over the user agent alone would count every anonymous request in a day as one returning visitor',
    );
  }
  if (salt.trim() === '') {
    throw new Error(
      'visitorKey was given no salt: an unsalted digest of an IPv4 address brute-forces in seconds, so the key would identify the visitor it exists to hide',
    );
  }
  return createHash(DIGEST_ALGORITHM)
    .update(framed(ip) + framed(userAgent) + framed(salt))
    .digest(DIGEST_ENCODING);
}
