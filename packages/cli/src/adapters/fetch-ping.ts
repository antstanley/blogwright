/**
 * Fetch adapter for the PingBuilder port: opens a connection to the builder
 * MicroVM's proxy endpoint to wake the resumed agent's event loop. Errors never
 * cross the port — the ping is best-effort by contract, and the agent's HTTP/1
 * server may not even parse the request.
 */

import type { PingBuilder } from '../ports.js';

/** A nudge only needs the connection to land; never hold a poll cycle longer than this. */
const PING_TIMEOUT_MS = 2500;

/** Build the fetch-backed ping. `fetchImpl` is injectable for tests. */
export function createFetchPing(fetchImpl: typeof fetch = fetch): PingBuilder {
  return async (endpoint, token) => {
    try {
      const res = await fetchImpl(`https://${endpoint}/status`, {
        headers: { 'X-aws-proxy-auth': token, 'X-aws-proxy-port': '8080' },
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      // Release the connection — an unread body pins an undici socket per
      // poll cycle until GC.
      await res.body?.cancel();
    } catch {
      /* expected — the point is the wake-up, not the response */
    }
  };
}
