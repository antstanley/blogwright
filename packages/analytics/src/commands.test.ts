/**
 * The `analytics dashboard` command - the plugin's composition root - driven
 * end to end with **no seam injected**: the real `createDuckDbAnalyticsQuery`,
 * the real `createCredentialProvider` and the real listener. That is
 * affordable, and worth more than a stubbed version, because the adapter opens
 * its DuckDB connection lazily and resolves its credentials inside that
 * connection: constructing it touches neither the native library nor AWS. So
 * these tests exercise the actual wiring while starting no DuckDB - which is
 * itself part of what they assert, since a command that reached for either
 * before binding would fail here without an AWS session.
 *
 * The routes the tests drive are therefore the static ones. Nothing in this
 * file requests `/api/queries/...`: that is where the real adapter *would*
 * open a connection, and `server.test.ts` already covers the data plane
 * against the fixture-backed fake.
 */

import { createServer as createSocketServer } from 'node:net';

import {
  createMemoryFileSystem,
  parseConfig,
  type PluginLogger,
  type Terminal,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { dashboard, type DashboardCommandContext } from './commands.js';
import { DEFAULT_DASHBOARD_PORT, validateAnalyticsConfig } from './config.js';
import { createFixtureAnalyticsQuery } from './fixture-query.js';
import { createDashboardServer } from './server.js';

/** The signals the command stops on, restated so the assertion is independent of the module. */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** A terminal the command never touches - it reports through `ctx.logger`. */
const SILENT_TERMINAL: Terminal = {
  isInteractive: false,
  write: () => {},
  error: () => {},
  status: () => {},
  question: async () => '',
};

/** A recording {@link PluginLogger}, keeping each line beside the level it arrived at. */
interface RecordingLogger extends PluginLogger {
  readonly lines: readonly string[];
}

function recordingLogger(): RecordingLogger {
  const lines: string[] = [];
  const at =
    (level: string) =>
    (msg: string): void => {
      lines.push(`${level} ${msg}`);
    };
  return {
    lines,
    info: at('info'),
    step: at('step'),
    ok: at('ok'),
    warn: at('warn'),
    error: at('error'),
  };
}

/** What one test drives the command with. */
interface TestContext extends DashboardCommandContext {
  readonly logger: RecordingLogger;
}

function contextFor(port?: number): TestContext {
  const logger = recordingLogger();
  return {
    env: 'production',
    config: parseConfig(JSON.stringify({ siteName: 'example', region: 'us-east-1' })),
    pluginConfig: validateAnalyticsConfig(port === undefined ? {} : { dashboard: { port } }),
    accountId: '123456789012',
    // An in-memory filesystem holding nothing: the prebuilt application (task
    // 57's `dist/app`) does not exist beside the sources, which is the state a
    // reader of this suite should expect the static route to report.
    ports: { fs: createMemoryFileSystem({}), terminal: SILENT_TERMINAL },
    logger,
  };
}

/**
 * A free port, obtained through a bare socket. Independent of the server the
 * command starts, so a command that bound a literal instead of the configured
 * port cannot hand this helper that same literal back and make the assertion
 * agree with the bug.
 */
async function freePort(): Promise<number> {
  const probe = createSocketServer();
  const port = await new Promise<number>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const bound = probe.address();
      if (bound === null || typeof bound === 'string') {
        reject(new Error('the probe bound no TCP address'));
        return;
      }
      resolve(bound.port);
    });
  });
  await new Promise<void>((resolve) => {
    probe.close(() => resolve());
  });
  return port;
}

/** Spin the event loop until `condition` holds, so no test races the command's own start-up. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => {
      setImmediate(() => resolve());
    });
  }
  throw new Error(`waited for ${what} and it never happened`);
}

/** The URL the command printed, taken out of the line it printed it on. */
function announcedUrl(logger: RecordingLogger): string {
  const line = logger.lines.find((entry) => entry.includes('http://'));
  if (line === undefined) throw new Error(`no URL announced; logged ${logger.lines.join(' | ')}`);
  return /http:\/\/\S+/.exec(line)?.[0] ?? '';
}

/**
 * Run the command, wait until it has announced its URL, hand control back, and
 * stop it with `signal`. The command's promise is awaited before returning, so
 * a test that reaches the end has seen the shutdown path run to completion.
 */
async function withDashboard(
  ctx: TestContext,
  signal: (typeof STOP_SIGNALS)[number],
  body: (url: string) => Promise<void>,
): Promise<void> {
  const done = dashboard(ctx);
  try {
    await waitFor(() => ctx.logger.lines.length > 0, 'the dashboard to announce its URL');
    await body(announcedUrl(ctx.logger));
  } finally {
    process.emit(signal, signal);
    await done;
  }
}

describe('analytics dashboard', () => {
  it('binds the loopback address on the configured port and says where', async () => {
    const port = await freePort();
    const ctx = contextFor(port);

    await withDashboard(ctx, 'SIGINT', async (url) => {
      expect(url).toBe(`http://127.0.0.1:${port}/`);
      // Announced *and* answering there - the URL is not merely a formatted string.
      const response = await fetch(url);
      expect(response.status).toBe(503);
      expect(await response.text()).toContain('has not been built');
    });

    expect(ctx.logger.lines[0]).toBe(
      `info analytics dashboard on http://127.0.0.1:${port}/ - press Ctrl+C to stop`,
    );
  });

  it("takes the port from task 44's default when the operator configured none", async () => {
    const ctx = contextFor();
    await withDashboard(ctx, 'SIGINT', async (url) => {
      expect(url).toBe(`http://127.0.0.1:${DEFAULT_DASHBOARD_PORT}/`);
    });
  });

  it.each(STOP_SIGNALS)('releases the listener on %s', async (signal) => {
    const port = await freePort();
    const ctx = contextFor(port);

    await withDashboard(ctx, signal, async (url) => {
      expect((await fetch(url)).status).toBe(503);
    });

    expect(ctx.logger.lines).toContain(
      `info ${signal} received - stopping the analytics dashboard`,
    );
    expect(ctx.logger.lines.at(-1)).toBe(`ok analytics dashboard stopped; port ${port} released`);

    // The port is genuinely free: a fresh listener takes it immediately.
    const rebound = await createDashboardServer({
      query: createFixtureAnalyticsQuery({}),
      config: validateAnalyticsConfig({}),
      port,
      appDir: '/nowhere',
      fs: createMemoryFileSystem({}),
    });
    expect(rebound.address.port).toBe(port);
    await rebound.close();
  });

  it('leaves no signal listener behind once it has stopped', async () => {
    const before = STOP_SIGNALS.map((signal) => process.listenerCount(signal));
    const ctx = contextFor(await freePort());

    await withDashboard(ctx, 'SIGTERM', async () => {
      // While running, the command owns one listener per stop signal.
      for (const [index, signal] of STOP_SIGNALS.entries()) {
        expect(process.listenerCount(signal)).toBe((before[index] ?? 0) + 1);
      }
    });

    expect(STOP_SIGNALS.map((signal) => process.listenerCount(signal))).toEqual(before);
  });

  it('fails with an actionable message when the configured port is already held', async () => {
    const port = await freePort();
    const held = await createDashboardServer({
      query: createFixtureAnalyticsQuery({}),
      config: validateAnalyticsConfig({}),
      port,
      appDir: '/nowhere',
      fs: createMemoryFileSystem({}),
    });
    const ctx = contextFor(port);
    const before = STOP_SIGNALS.map((signal) => process.listenerCount(signal));
    try {
      await expect(dashboard(ctx)).rejects.toThrow(`cannot bind 127.0.0.1:${port}`);
      // Nothing was announced and nothing was left registered.
      expect(ctx.logger.lines).toEqual([]);
      expect(STOP_SIGNALS.map((signal) => process.listenerCount(signal))).toEqual(before);
    } finally {
      await held.close();
    }
  });
});
