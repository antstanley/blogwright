import { createScriptedTerminal, type LogEvent, type ResourceOutputs } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import type { OpsContext } from './context.js';
import { microvmLogGroup, pollBuild, type AgentStatus } from './deploy.js';
import { createTestContext } from './test-support.js';

function ctxWith(resources: Record<string, ResourceOutputs>): OpsContext {
  // env "preview" + site "example" derive /aws/lambda/microvms/preview-example-builder
  return createTestContext({ env: 'preview', state: { resources } });
}

describe('microvmLogGroup', () => {
  it('prefers the log group recorded on the image at bootstrap', () => {
    const ctx = ctxWith({
      'microvm-image': { logGroup: '/example/preview/microvm-build' },
      'microvm-log-group': { arn: 'arn:aws:logs:us-east-1:1:log-group:/other:*' },
    });
    expect(microvmLogGroup(ctx)).toBe('/example/preview/microvm-build');
  });

  it('parses the name from the log-group ARN when the image has none', () => {
    const ctx = ctxWith({
      'microvm-log-group': {
        arn: 'arn:aws:logs:us-east-1:1:log-group:/example/preview/microvm-build:*',
      },
    });
    expect(microvmLogGroup(ctx)).toBe('/example/preview/microvm-build');
  });

  it('falls back to the derived name when state has nothing recorded', () => {
    // A stack that predates state recording — the derived name is the only source.
    expect(microvmLogGroup(ctxWith({}))).toBe('/aws/lambda/microvms/preview-example-builder');
  });
});

const HASH = 'abc123';
const ENDPOINT = 'vm.example.aws';
const TOKEN = 'proxy-token';

function doneEvent(): LogEvent {
  return { eventId: 'e1', timestamp: 1, message: `##build:done:${HASH}` };
}

describe('pollBuild nudge', () => {
  it(
    'nudges the builder each poll cycle with the proxy endpoint and token',
    { timeout: 15_000 },
    async () => {
      const pings: Array<{ endpoint: string; token: string }> = [];
      let cycles = 0;
      const ctx = createTestContext({
        clients: {
          // First cycle: no marker yet (forces a second cycle); second cycle: done.
          logs: { filterEvents: async () => (++cycles < 2 ? [] : [doneEvent()]) },
          s3: { objectExists: async () => false },
        },
        ports: {
          ping: async (endpoint, token) => {
            pings.push({ endpoint, token });
          },
        },
      });

      const result: AgentStatus = await pollBuild(ctx, HASH, Date.now(), ENDPOINT, TOKEN);

      expect(result).toEqual({ state: 'done' });
      expect(pings).toEqual([
        { endpoint: ENDPOINT, token: TOKEN },
        { endpoint: ENDPOINT, token: TOKEN },
      ]);
    },
  );

  it('completes the poll even when the ping rejects', async () => {
    const ctx = createTestContext({
      clients: { logs: { filterEvents: async () => [doneEvent()] } },
      ports: {
        ping: async () => {
          throw new Error('connect ECONNREFUSED');
        },
      },
    });
    await expect(pollBuild(ctx, HASH, Date.now(), ENDPOINT, TOKEN)).resolves.toEqual({ state: 'done' });
  });

  it('shows a live status line per cycle and clears it when the poll ends', async () => {
    const terminal = createScriptedTerminal();
    const ctx = createTestContext({
      clients: { logs: { filterEvents: async () => [doneEvent()] } },
      ports: { terminal, ping: async () => undefined },
    });

    await pollBuild(ctx, HASH, Date.now(), ENDPOINT, TOKEN);

    expect(terminal.statuses.at(-1)).toBe('');
    const shown = terminal.statuses.slice(0, -1);
    expect(shown.length).toBeGreaterThan(0);
    for (const line of shown) expect(line).toContain(`building ${HASH} in MicroVM`);
  });

  it('clears the status line even when the build fails', async () => {
    const terminal = createScriptedTerminal();
    const failed: LogEvent = {
      eventId: 'e2',
      timestamp: 1,
      message: `##build:failed:${HASH}: pnpm build exited 1`,
    };
    const ctx = createTestContext({
      clients: { logs: { filterEvents: async () => [failed] } },
      ports: { terminal, ping: async () => undefined },
    });

    const result = await pollBuild(ctx, HASH, Date.now(), ENDPOINT, TOKEN);

    expect(result.state).toBe('failed');
    expect(terminal.statuses.at(-1)).toBe('');
  });

  it('skips the nudge when the endpoint or token is missing', async () => {
    let pinged = 0;
    const ctx = createTestContext({
      clients: { logs: { filterEvents: async () => [doneEvent()] } },
      ports: {
        ping: async () => {
          pinged += 1;
        },
      },
    });
    await pollBuild(ctx, HASH, Date.now(), '', TOKEN);
    await pollBuild(ctx, HASH, Date.now(), ENDPOINT, '');
    expect(pinged).toBe(0);
  });
});
