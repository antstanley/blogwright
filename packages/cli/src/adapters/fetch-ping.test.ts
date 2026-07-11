import { describe, expect, it } from 'vitest';

import { createFetchPing } from './fetch-ping.js';

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function recordingFetch(calls: RecordedCall[]): typeof fetch {
  return async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response('ok');
  };
}

describe('createFetchPing', () => {
  it('pings the proxy status route with the auth headers and a timeout signal', async () => {
    const calls: RecordedCall[] = [];
    const ping = createFetchPing(recordingFetch(calls));

    await ping('vm.example.aws', 'proxy-token');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://vm.example.aws/status');
    expect(calls[0]?.init?.headers).toEqual({
      'X-aws-proxy-auth': 'proxy-token',
      'X-aws-proxy-port': '8080',
    });
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('resolves despite a rejecting fetch — the wake-up is best-effort', async () => {
    const ping = createFetchPing(async () => {
      throw new Error('socket hang up');
    });
    await expect(ping('vm.example.aws', 'proxy-token')).resolves.toBeUndefined();
  });
});
