import {
  AwsError,
  createScriptedTerminal,
  type LogEvent,
  type Microvm,
  type ResourceOutputs,
  type RunMicrovmInput,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import type { OpsContext } from './context.js';
import {
  microvmLogGroup,
  pollBuild,
  runBuild,
  runMicrovmWithRetry,
  type AgentStatus,
} from './deploy.js';
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

describe('runMicrovmWithRetry', () => {
  const INPUT: RunMicrovmInput = {
    imageIdentifier: 'arn:img',
    executionRoleArn: 'arn:role',
    clientToken: 'run-abc-1',
    maximumDurationInSeconds: 1800,
    idlePolicy: { autoResumeEnabled: false, maxIdleDurationSeconds: 300, suspendedDurationSeconds: 120 },
    ingressNetworkConnectors: [],
    egressNetworkConnectors: [],
  };
  const VM: Microvm = { microvmId: 'vm-1', state: 'PENDING', endpoint: '' };

  function gateway(statusCode: number): AwsError {
    return new AwsError({
      service: 'lambda-microvms',
      code: 'BadGateway',
      message: 'Bad Gateway',
      statusCode,
    });
  }

  function ctxWithLaunch(fail: AwsError[], warns: string[]) {
    let attempts = 0;
    const ctx = createTestContext({
      clients: {
        microvms: {
          runMicrovm: async (input: RunMicrovmInput) => {
            expect(input.clientToken).toBe('run-abc-1'); // same token every attempt
            attempts += 1;
            const err = fail.shift();
            if (err) throw err;
            return VM;
          },
        },
      },
      logger: {
        warn: (msg: string) => {
          warns.push(msg);
        },
      },
    });
    return { ctx, attempts: () => attempts };
  }

  it('retries gateway errors after an image update and eventually launches', async () => {
    const warns: string[] = [];
    const { ctx, attempts } = ctxWithLaunch([gateway(502), gateway(503)], warns);

    const vm = await runMicrovmWithRetry(ctx, INPUT, [1, 1, 1]);

    expect(vm).toEqual(VM);
    expect(attempts()).toBe(3);
    expect(warns).toHaveLength(2);
    expect(warns[0]).toContain('HTTP 502');
  });

  it('gives up when the bounded retry window is exhausted', async () => {
    const warns: string[] = [];
    const { ctx, attempts } = ctxWithLaunch([gateway(502), gateway(502), gateway(502)], warns);

    await expect(runMicrovmWithRetry(ctx, INPUT, [1, 1])).rejects.toThrow(/HTTP 502/);
    expect(attempts()).toBe(3);
  });

  it('rethrows non-gateway errors immediately', async () => {
    const warns: string[] = [];
    const denied = new AwsError({
      service: 'lambda-microvms',
      code: 'AccessDenied',
      message: 'no',
      statusCode: 403,
    });
    const { ctx, attempts } = ctxWithLaunch([denied], warns);

    await expect(runMicrovmWithRetry(ctx, INPUT, [1, 1])).rejects.toThrow(/AccessDenied/);
    expect(attempts()).toBe(1);
    expect(warns).toHaveLength(0);
  });
});

describe('runBuild pending job', () => {
  /** Capture the pending-job document runBuild writes for the agent. */
  async function pendingJobFor(opts: { refresh?: boolean }): Promise<Record<string, unknown>> {
    const puts: Array<{ key: string; body: string }> = [];
    const ctx = createTestContext({
      state: {
        resources: {
          'microvm-image': { arn: 'arn:img' },
          'iam-exec-role': { arn: 'arn:role' },
        },
      },
      clients: {
        s3: {
          putObject: async (_b: string, key: string, body: string | Uint8Array) => {
            puts.push({ key, body: typeof body === 'string' ? body : '' });
          },
          deleteObject: async () => undefined,
          objectExists: async () => true, // completion signal → poll returns immediately
        },
        microvms: {
          runMicrovm: async () => ({ microvmId: 'vm-1', state: 'PENDING', endpoint: '' }),
          getMicrovm: async () => ({ microvmId: 'vm-1', state: 'RUNNING', endpoint: 'e' }),
          createAuthToken: async () => 'tok',
          terminateMicrovm: async () => undefined,
        },
        logs: { filterEvents: async () => [] },
      },
    });

    await runBuild(ctx, { hash: 'abc123', sourceKey: 'build/abc123.zip', ...opts });

    const pending = puts.find((p) => p.key.startsWith('build/pending/'));
    if (!pending) throw new Error('no pending job written');
    return JSON.parse(pending.body) as Record<string, unknown>;
  }

  it('omits refresh by default', async () => {
    const job = await pendingJobFor({});
    expect(job.refresh).toBeUndefined();
    expect(job.hash).toBe('abc123');
  });

  it('passes refresh through so the agent re-uploads unchanged files', async () => {
    const job = await pendingJobFor({ refresh: true });
    expect(job.refresh).toBe(true);
  });
});
