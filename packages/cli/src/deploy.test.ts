import {
  AwsError,
  createScriptedTerminal,
  DEFAULT_CACHE_CONTROL,
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
    // A stack that predates state recording - the derived name is the only source.
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
    await expect(pollBuild(ctx, HASH, Date.now(), ENDPOINT, TOKEN)).resolves.toEqual({
      state: 'done',
    });
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
    idlePolicy: {
      autoResumeEnabled: false,
      maxIdleDurationSeconds: 300,
      suspendedDurationSeconds: 120,
    },
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
  const RECORD_KEY = 'build/cache-control/site.json';
  const REPORT_KEY = 'build/changed/abc123.json';
  const NO_CACHE = [{ match: ['**'], value: 'no-cache' }];

  interface BuildRun {
    job: Record<string, unknown>;
    /** Every PUT, in order. */
    puts: Array<{ key: string; body: string }>;
    /** The record bodies written, in order. */
    records: unknown[];
    steps: string[];
    warns: string[];
    launches: number;
  }

  /**
   * Run a build and capture the pending-job document it writes for the agent.
   * `recorded` is the cache-control record's body (undefined: no record yet).
   * The fake agent reports the rules it received in its changed-paths
   * manifest, as the current agent does; `agent: 'old'` reports none, like an
   * agent older than `cacheControl`, and `report` overrides the manifest body.
   */
  async function buildWith(
    opts: { refresh?: boolean },
    setup: {
      recorded?: string | undefined;
      config?: { cacheControl?: unknown };
      buildFails?: boolean;
      agent?: 'current' | 'old';
      report?: string | undefined;
      failRecordWrite?: 'before-build' | 'after-build';
      /** The error runBuild must reject with, before any pending job is written. */
      rejects?: RegExp;
    } = {},
  ): Promise<BuildRun> {
    const puts: Array<{ key: string; body: string }> = [];
    const steps: string[] = [];
    const warns: string[] = [];
    let launches = 0;
    let jobBody: string | undefined;
    const failed: LogEvent = { eventId: 'f', timestamp: 1, message: `##build:failed:abc123: x` };
    const report = (): string | undefined => {
      if ('report' in setup) return setup.report;
      const received = (JSON.parse(jobBody ?? '{}') as { cacheControl?: unknown }).cacheControl;
      return JSON.stringify(
        setup.agent === 'old' ? { paths: [] } : { paths: [], cacheControl: received },
      );
    };
    const ctx = createTestContext({
      ...(setup.config ? { config: setup.config } : {}),
      state: {
        resources: {
          'microvm-image': { arn: 'arn:img' },
          'iam-exec-role': { arn: 'arn:role' },
        },
      },
      clients: {
        s3: {
          getObjectText: async (_b: string, key: string) => {
            if (key === RECORD_KEY) return setup.recorded;
            if (key === REPORT_KEY) return report();
            throw new Error(`unexpected read of ${key}`);
          },
          putObject: async (_b: string, key: string, body: string | Uint8Array) => {
            const text = typeof body === 'string' ? body : '';
            if (key === RECORD_KEY) {
              const phase = jobBody === undefined ? 'before-build' : 'after-build';
              if (setup.failRecordWrite === phase) throw new Error('AccessDenied');
            }
            if (key.startsWith('build/pending/')) jobBody = text;
            puts.push({ key, body: text });
          },
          deleteObject: async () => undefined,
          // completion signal → poll returns immediately
          objectExists: async () => !setup.buildFails,
        },
        microvms: {
          runMicrovm: async () => {
            launches++;
            return { microvmId: 'vm-1', state: 'PENDING', endpoint: '' };
          },
          getMicrovm: async () => ({ microvmId: 'vm-1', state: 'RUNNING', endpoint: 'e' }),
          createAuthToken: async () => 'tok',
          terminateMicrovm: async () => undefined,
        },
        logs: { filterEvents: async () => (setup.buildFails ? [failed] : []) },
      },
      logger: {
        step: (msg: string) => {
          steps.push(msg);
        },
        warn: (msg: string) => {
          warns.push(msg);
        },
      },
    });

    const build = runBuild(ctx, { hash: 'abc123', sourceKey: 'build/abc123.zip', ...opts });
    if (setup.buildFails) await expect(build).rejects.toThrow(/build failed/);
    else if (setup.rejects) await expect(build).rejects.toThrow(setup.rejects);
    else await build;

    const pending = puts.find((p) => p.key.startsWith('build/pending/'));
    if (!pending && !setup.rejects) throw new Error('no pending job written');
    const records = puts.filter((p) => p.key === RECORD_KEY).map((p) => JSON.parse(p.body));
    return {
      job: pending ? (JSON.parse(pending.body) as Record<string, unknown>) : {},
      puts,
      records,
      steps,
      warns,
      launches,
    };
  }

  const applied = (rules: unknown) => JSON.stringify({ status: 'applied', rules });
  const UNCONFIRMED = { status: 'unconfirmed' };
  /** The record a run left behind, as the next run would read it. */
  const lastRecord = (run: BuildRun): string | undefined => {
    const last = run.records.at(-1);
    return last === undefined ? undefined : JSON.stringify(last);
  };

  it('omits refresh, and marks nothing before the build, when the rules match the record', async () => {
    const { job, records } = await buildWith({}, { recorded: applied(DEFAULT_CACHE_CONTROL) });
    expect(job.refresh).toBeUndefined();
    expect(job.hash).toBe('abc123');
    expect(records).toEqual([{ status: 'applied', rules: DEFAULT_CACHE_CONTROL }]);
  });

  it('passes an explicit refresh through, without calling it implicit', async () => {
    const { job, steps } = await buildWith(
      { refresh: true },
      { recorded: applied(DEFAULT_CACHE_CONTROL) },
    );
    expect(job.refresh).toBe(true);
    expect(steps.some((line) => line.includes('implicit --refresh'))).toBe(false);
  });

  it('sends the configured rules to the agent', async () => {
    const { job } = await buildWith(
      {},
      {
        config: { cacheControl: [{ match: '**', value: 'no-cache' }] },
        recorded: applied(NO_CACHE),
      },
    );
    expect(job.cacheControl).toEqual(NO_CACHE);
    expect(job.refresh).toBeUndefined();
  });

  it('refreshes implicitly, and says so, when the rules changed since the last build', async () => {
    const { job, steps } = await buildWith({}, { recorded: applied(NO_CACHE) });
    expect(job.refresh).toBe(true);
    expect(steps).toContainEqual(
      expect.stringMatching(/^cacheControl rules differ .*\(an implicit --refresh\)$/),
    );
  });

  it('marks the record unconfirmed before launching a build that changes the rules', async () => {
    const { puts } = await buildWith({}, { recorded: applied(NO_CACHE) });
    const keys = puts.map((p) => p.key);
    expect(keys.indexOf(RECORD_KEY)).toBeLessThan(keys.indexOf('build/pending/site.json'));
    expect(JSON.parse(puts[keys.indexOf(RECORD_KEY)]?.body ?? '')).toEqual(UNCONFIRMED);
  });

  it('marks the record under an explicit --refresh too, when the rules changed', async () => {
    const { records } = await buildWith(
      { refresh: true },
      { recorded: applied(NO_CACHE), buildFails: true },
    );
    expect(records).toEqual([UNCONFIRMED]);
  });

  it('refreshes once for a target with no record, without claiming its files differ', async () => {
    const { job, steps } = await buildWith({}, { recorded: undefined });
    expect(job.refresh).toBe(true);
    expect(steps).toContainEqual(
      expect.stringMatching(/^no Cache-Control record for this target yet - .*implicit --refresh/),
    );
    expect(steps.some((line) => line.includes('differ'))).toBe(false);
  });

  it('does not refresh a target with no record when the rules are empty - nothing to retrofit', async () => {
    const { job, records } = await buildWith(
      {},
      { recorded: undefined, config: { cacheControl: [] } },
    );
    expect(job.refresh).toBeUndefined();
    expect(records).toEqual([{ status: 'applied', rules: [] }]);
  });

  it.each([
    ['not JSON', 'not json', /is not valid JSON/],
    ['a JSON array', '[]', /must hold a JSON object/],
    ['no status', '{"rules": []}', /has status undefined/],
    ['an unknown status', '{"status": "done", "rules": []}', /has status "done"/],
    ['rules that are not a list', '{"status": "applied", "rules": "x"}', /do not validate/],
    [
      'a rule that does not validate',
      '{"status": "applied", "rules": [{"match": ["*.html"], "value": "no-cache"}]}',
      /do not validate .*can never match/,
    ],
  ])('refreshes, with a warning, when the record holds %s', async (_label, recorded, reason) => {
    const { job, warns } = await buildWith({}, { recorded });
    expect(job.refresh).toBe(true);
    expect(warns[0]).toContain('ignoring malformed build/cache-control/site.json');
    expect(warns[0]).toMatch(reason);
  });

  it('refreshes when the record is unconfirmed, even though the rules have not changed', async () => {
    const { job, steps } = await buildWith({}, { recorded: JSON.stringify(UNCONFIRMED) });
    expect(job.refresh).toBe(true);
    expect(steps).toContainEqual(expect.stringContaining('did not confirm the Cache-Control'));
  });

  it('records the applied rules once the build succeeds and the agent reports them', async () => {
    const { records, warns } = await buildWith({}, { recorded: undefined });
    expect(records.at(-1)).toEqual({ status: 'applied', rules: DEFAULT_CACHE_CONTROL });
    expect(warns).toEqual([]);
  });

  // Regression (#51 review, finding 1): a static rollback runs on whatever builder image
  // is live, and an agent older than cacheControl drops the rules but still succeeds.
  it('records unconfirmed, not applied, when the agent does not report the rules', async () => {
    const stale = await buildWith({}, { recorded: undefined, agent: 'old' });
    expect(stale.job.refresh).toBe(true);
    expect(stale.records).toEqual([UNCONFIRMED, UNCONFIRMED]);
    expect(stale.warns).toContainEqual(
      expect.stringContaining('the builder did not report writing the configured Cache-Control'),
    );

    // The next build - on an up-to-date agent, rules unchanged - still re-applies them.
    const next = await buildWith({}, { recorded: lastRecord(stale) });
    expect(next.job.refresh).toBe(true);
    expect(next.records.at(-1)).toEqual({ status: 'applied', rules: DEFAULT_CACHE_CONTROL });
  });

  it('records unconfirmed when the agent reports rules other than the configured ones', async () => {
    const { records } = await buildWith(
      {},
      {
        recorded: applied(DEFAULT_CACHE_CONTROL),
        report: JSON.stringify({ cacheControl: NO_CACHE }),
      },
    );
    expect(records).toEqual([UNCONFIRMED]);
  });

  it('records unconfirmed, with a warning, when the agent manifest is missing or unreadable', async () => {
    for (const report of [undefined, 'not json']) {
      const { records, warns } = await buildWith(
        {},
        { recorded: applied(DEFAULT_CACHE_CONTROL), report },
      );
      expect(records).toEqual([UNCONFIRMED]);
      expect(warns).toHaveLength(1);
    }
  });

  // Regression (#51 review, finding 2): a rule-changing build that stops partway leaves
  // some files with the new header; reverting the config must not hide them.
  it('re-applies after a failed rule-changing build, even once the config is reverted', async () => {
    const failed = await buildWith(
      {},
      { recorded: applied(NO_CACHE), buildFails: true }, // config: the defaults
    );
    expect(failed.records).toEqual([UNCONFIRMED]);

    const reverted = await buildWith(
      {},
      { recorded: lastRecord(failed), config: { cacheControl: NO_CACHE } },
    );
    expect(reverted.job.refresh).toBe(true);
    expect(reverted.records.at(-1)).toEqual({ status: 'applied', rules: NO_CACHE });
  });

  it('leaves the record alone when a build with unchanged rules fails', async () => {
    const { records } = await buildWith(
      {},
      { recorded: applied(DEFAULT_CACHE_CONTROL), buildFails: true },
    );
    expect(records).toEqual([]);
  });

  it('fails before launching when the record cannot be marked unconfirmed', async () => {
    const { puts, launches } = await buildWith(
      {},
      {
        recorded: applied(NO_CACHE),
        failRecordWrite: 'before-build',
        rejects:
          /could not mark build\/cache-control\/site\.json unconfirmed .*nothing was published/,
      },
    );
    expect(puts).toEqual([]);
    expect(launches).toBe(0);
  });

  it('only warns when the record cannot be written after the build - the site is published', async () => {
    const { warns } = await buildWith({}, { recorded: undefined, failRecordWrite: 'after-build' });
    expect(warns).toContainEqual(
      expect.stringContaining('could not record the Cache-Control this build wrote'),
    );
  });
});
