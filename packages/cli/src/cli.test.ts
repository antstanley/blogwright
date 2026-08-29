/**
 * Dispatch-level tests for `main`. `main` takes its terminal and context
 * factories as parameters (see cli.ts's `TerminalFactory` and
 * `ContextFactory`), so these drive it with `createScriptedTerminal` and a
 * stub over `createTestContext` - never a module mock, never disk or AWS
 * (DEVELOPMENT.md: "tests substitute at the port"). They pin today's help,
 * unknown-command, `pds`, and `status` behaviour so later dispatch-rebuild
 * tasks have a regression net.
 */

import { createScriptedTerminal, type ScriptedTerminal } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { main, type ContextFactory } from './cli.js';
import type { OpsContext } from './context.js';
import { RESERVED_COMMANDS } from './known-commands.js';
import { createLogger } from './logger.js';
import { createTestContext } from './test-support.js';

/**
 * An independent copy of the `USAGE` constant at cli.ts:11-63, pinned
 * byte-exact at the time this test was written. This is the regression net
 * tasks 11 and 29 rebuild help output against - an import of the live
 * constant would not catch a change to it, so the text is duplicated here
 * on purpose.
 */
const EXPECTED_USAGE = `blogwright - full operations for a blog site on AWS (S3 + CloudFront, MicroVM builds)

Usage:
  blogwright <command> [env] [options]

Commands:
  init                        First-run wizard: writes config/production.jsonc
  bootstrap   [env]           Create/reconcile the infrastructure graph
  deploy      [env]           Zip the repo, build in a MicroVM, publish to site/
  rollback    <hash> [env]    Re-deploy an existing build by hash
  delete      [env]           Empty the live site/ prefix
  destroy     [env] --yes     Tear down all infrastructure
  history     [env]           List deployment history
  logs        <hash> [env]    Show CloudWatch build logs for a hash
  status      [env]           Show planned graph vs. live state

  preview bootstrap           Provision the shared preview stack
  preview deploy <id>         Build + publish a PR preview (id like pr-42)
  preview destroy <id>        Remove one PR preview
  preview list                List active previews
  preview teardown --yes      Tear down the whole preview stack

  pds keygen                  Generate the OAuth client key: private JWK into
                              Secrets Manager, public documents into public/oauth/
                              (commit + release those before pds login)
  pds login --identifier <handle-or-did>
                              Interactive OAuth bootstrap: prints an authorize URL,
                              then expects the pasted /oauth/callback redirect URL;
                              the session is stored in Secrets Manager and refreshed
                              automatically on every sync
  pds secret status           Show secret metadata (never the value)
  pds secret delete --yes     Delete the secret (logs out and discards the key)
  pds init                    Create/update the standard.site publication record and
                              write the site verification files (commit them)
  pds sync                    Reconcile site.standard.document records with the
                              content collection (production only; also runs after
                              every successful production deploy)

Options:
  --env <name>      Environment (default: production; also accepted positionally)
  --domain <fqdn>   Custom domain (ACM cert + CloudFront alias)
  --config <path>   Path to a JSONC config file
  --endpoint <url>  AWS endpoint override (e.g. http://localhost:4566 for floci)
  --id <preview>    Preview id for preview deploy/destroy (also accepted positionally)
  --plain           Minimal machine-friendly output (no colour, no live status,
                    no prompts) - for CI systems and agents; also automatic when
                    output is piped. NO_COLOR disables colour only.
  --refresh         Re-upload every file on deploy, even unchanged ones, so
                    metadata fixes (content types, object tags) reach live
                    objects the ETag comparison would otherwise skip.
  --yes             Confirm destructive operations
  --help            Show this help
`;

/** A TerminalFactory that always hands back the same captured terminal. */
function fixedTerminal(terminal: ScriptedTerminal) {
  return () => terminal;
}

/**
 * A ContextFactory over `createTestContext`, wired to the same terminal
 * `main` built (mirroring context.ts's own `createLogger(ports.terminal)`)
 * so a dispatched command's `ctx.logger` calls land in that terminal's
 * captured `writes`/`errors`, and recording every context it builds so a
 * test can assert against derived fields (e.g. bucket name).
 */
function testContextFactory(terminal: ScriptedTerminal): {
  makeContext: ContextFactory;
  contexts: OpsContext[];
} {
  const contexts: OpsContext[] = [];
  const makeContext: ContextFactory = async (opts) => {
    const ctx = createTestContext({
      env: opts.env,
      ports: opts.ports,
      logger: createLogger(terminal),
    });
    contexts.push(ctx);
    return ctx;
  };
  return { makeContext, contexts };
}

describe('main - help and error surface', () => {
  it('prints USAGE and exits 0 for --help', async () => {
    const terminal = createScriptedTerminal({ interactive: false });

    const code = await main(
      ['--help'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
    );

    expect(code).toBe(0);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
    expect(terminal.errors).toEqual([]);
  });

  it('prints USAGE and exits 1 for a bare invocation', async () => {
    const terminal = createScriptedTerminal({ interactive: false });

    const code = await main([], fixedTerminal(terminal), testContextFactory(terminal).makeContext);

    expect(code).toBe(1);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
  });

  it('prints "unknown command" plus USAGE and exits 1 for an unrecognised command', async () => {
    const terminal = createScriptedTerminal({ interactive: false });

    const code = await main(
      ['frobnicate'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown command: frobnicate']);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
  });
});

describe('main - pds dispatch', () => {
  it('exits 1 with "unknown pds action: (none)" when no action is given', async () => {
    const terminal = createScriptedTerminal({ interactive: false });

    const code = await main(
      ['pds'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown pds action: (none)']);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
  });

  it('exits 1 with "unknown pds action: bogus" for an unrecognised action', async () => {
    const terminal = createScriptedTerminal({ interactive: false });

    const code = await main(
      ['pds', 'bogus'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown pds action: bogus']);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
  });
});

describe('main - status dispatch', () => {
  it('reaches commands.status, which completes despite a rejecting AWS transport', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext, contexts } = testContextFactory(terminal);

    const code = await main(['status'], fixedTerminal(terminal), makeContext);

    expect(code).toBe(0);
    const ctx = contexts[0];
    if (!ctx) throw new Error('expected main to build a context for the status dispatch');
    // commands.ts's status() writes this header before reading any node, and
    // catches each node's read failure - the default test context's clients
    // reject every AWS call - so the command still completes and returns 0.
    expect(terminal.writes[0]).toBe(`Status for "production" (bucket ${ctx.names.bucket})`);
  });
});

describe('RESERVED_COMMANDS', () => {
  it('equals the CLI\'s own dispatch set, including "init", "preview" and "plugin" which dispatch outside KNOWN_COMMANDS', () => {
    // This literal list is independent of known-commands.ts's own
    // KNOWN_COMMANDS/union construction on purpose: if a built-in is ever
    // added to KNOWN_COMMANDS without being folded into RESERVED_COMMANDS
    // too (or one of the three names dispatched ahead of KNOWN_COMMANDS -
    // init, preview, plugin - is ever dropped from the union), this test
    // fails instead of silently letting a plugin shadow that command.
    expect([...RESERVED_COMMANDS].sort()).toEqual(
      [
        'bootstrap',
        'delete',
        'deploy',
        'destroy',
        'history',
        'init',
        'logs',
        'plugin',
        'preview',
        'rollback',
        'status',
      ].sort(),
    );
  });

  it('does not reserve "pds" - see plugins.ts\'s module comment for why', () => {
    expect(RESERVED_COMMANDS.has('pds')).toBe(false);
  });
});
