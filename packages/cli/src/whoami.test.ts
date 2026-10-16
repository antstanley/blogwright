import {
  createClients,
  createMemoryFileSystem,
  createScriptedTerminal,
  staticCredentials,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { main } from './cli.js';
import { createLogger } from './logger.js';
import { TEST_HOME, testAwsAccess } from './test-support.js';
import { whoami, type WhoamiOptions } from './whoami.js';

const CWD = process.cwd();
const ACCOUNT = '123456789012';
const ARN = `arn:aws:sts::${ACCOUNT}:assumed-role/AdminRole/ant`;

function identityXml(account: string): string {
  return (
    '<GetCallerIdentityResponse><GetCallerIdentityResult>' +
    `<Arn>arn:aws:sts::${account}:assumed-role/AdminRole/ant</Arn>` +
    `<UserId>AROA:ant</UserId><Account>${account}</Account>` +
    '</GetCallerIdentityResult></GetCallerIdentityResponse>'
  );
}

/** STS answers for `account`; anything else is a test failure - whoami loads no state. */
function stsOnly(account: string, regions: string[]): Transport {
  return async (req) => {
    if (!String(req.body).includes('GetCallerIdentity')) {
      throw new Error(`whoami made a non-STS request: ${req.method} ${req.url}`);
    }
    regions.push(new URL(req.url).hostname);
    const text = identityXml(account);
    return { statusCode: 200, headers: {}, body: new TextEncoder().encode(text), text: () => text };
  };
}

function run(
  files: Record<string, string>,
  opts: Partial<WhoamiOptions> & { account?: string; processEnv?: NodeJS.ProcessEnv } = {},
) {
  const terminal = createScriptedTerminal({ interactive: false });
  const regions: string[] = [];
  const access = testAwsAccess({
    host: {
      processEnv: opts.processEnv ?? {},
      createClients: (clientOpts) =>
        createClients({
          ...clientOpts,
          credentials: staticCredentials({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
          transport: stsOnly(opts.account ?? ACCOUNT, regions),
        }),
    },
  })();
  const { account: _account, processEnv: _processEnv, ...whoamiOptions } = opts;
  const result = whoami(
    { env: 'production', ...whoamiOptions },
    {
      fs: createMemoryFileSystem(files),
      terminal,
      logger: createLogger(terminal),
      awsLogin: access.awsLogin,
      host: access.host,
    },
  );
  return { result, terminal, regions };
}

const REPO = { [`${CWD}/.jj`]: '' };
const PINNED_CONFIG = {
  ...REPO,
  [`${CWD}/config/production.jsonc`]: JSON.stringify({
    siteName: 'example',
    region: 'eu-west-2',
    aws: { profile: 'mysite-prod', accountId: ACCOUNT },
  }),
  [`${TEST_HOME}/.aws/config`]: '[profile mysite-prod]\nsso_session = s\n',
};

describe('whoami', () => {
  it('prints the fixed keys for a configured, pinned environment and exits 0', async () => {
    const { result, terminal, regions } = run(PINNED_CONFIG);

    expect(await result).toBe(0);
    expect(terminal.writes).toEqual([
      `account   ${ACCOUNT}`,
      'identity  AdminRole',
      `arn       ${ARN}`,
      'profile   mysite-prod (config)',
      'env       production (config/production.jsonc)',
      'region    eu-west-2',
      'pin       matches aws.accountId',
    ]);
    expect(regions).toEqual(['sts.eu-west-2.amazonaws.com']);
  });

  it('signs in us-east-1 with no pin when no config file exists', async () => {
    const { result, terminal, regions } = run(REPO);

    expect(await result).toBe(0);
    expect(terminal.writes).toContain('profile   none (default credentials)');
    expect(terminal.writes).toContain('env       production (no config found)');
    expect(terminal.writes).toContain('region    us-east-1');
    expect(terminal.writes).toContain('pin       not set');
    expect(regions).toEqual(['sts.us-east-1.amazonaws.com']);
  });

  it('works outside a repository', async () => {
    const { result, terminal } = run({});

    expect(await result).toBe(0);
    expect(terminal.writes).toContain('env       production (outside a repository)');
  });

  it('names environment credentials when they are exported', async () => {
    const { result, terminal } = run(REPO, {
      processEnv: { AWS_ACCESS_KEY_ID: 'AKIA', AWS_SECRET_ACCESS_KEY: 'secret' },
    });

    expect(await result).toBe(0);
    expect(terminal.writes).toContain('profile   none (environment credentials)');
  });

  it('refuses an explicit --config that does not exist', async () => {
    const { result } = run(REPO, { configPath: '/nowhere/staging.jsonc' });

    await expect(result).rejects.toThrow('no config found for environment "production"');
  });

  it('reports the pin skipped under an endpoint override', async () => {
    const { result, terminal } = run(PINNED_CONFIG, {
      account: '000000000000',
      endpointOverride: 'http://localhost:4566',
    });

    expect(await result).toBe(0);
    expect(terminal.writes).toContain('pin       skipped (endpoint override)');
  });

  it('fails (exit 1 at bin.ts) on a pin mismatch, printing no identity', async () => {
    const { result, terminal } = run(PINNED_CONFIG, { account: '210987654321' });

    await expect(result).rejects.toThrow(`config/production.jsonc pins AWS account ${ACCOUNT}`);
    expect(terminal.writes).toEqual([]);
  });

  it('fails on a missing profile', async () => {
    const { result } = run(PINNED_CONFIG, { profile: 'nope' });

    await expect(result).rejects.toThrow('AWS profile "nope" not found (from --profile)');
  });
});

describe('main - whoami dispatch', () => {
  it('dispatches before any context is built, passing --profile and the env positional', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const regions: string[] = [];
    const fs = createMemoryFileSystem({
      ...REPO,
      [`${CWD}/config/staging.jsonc`]: JSON.stringify({ siteName: 'example', region: 'eu-west-1' }),
      [`${TEST_HOME}/.aws/config`]: '[profile ops]\nlogin_session = s\n',
    });

    const code = await main(
      ['whoami', 'staging', '--profile', 'ops'],
      () => terminal,
      () => Promise.reject(new Error('whoami must not build a context')),
      () => ({
        fs,
        loader: {
          resolve: async () => ({ found: false }),
          packageJsonPathFor: async () => ({ found: false }),
          load: async () => undefined,
        },
      }),
      () => {
        throw new Error('whoami must not build a package manager');
      },
      testAwsAccess({
        host: {
          createClients: (clientOpts) =>
            createClients({
              ...clientOpts,
              credentials: staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' }),
              transport: stsOnly(ACCOUNT, regions),
            }),
        },
      }),
    );

    expect(code).toBe(0);
    expect(terminal.writes).toContain('profile   ops (--profile)');
    expect(terminal.writes).toContain('env       staging (config/staging.jsonc)');
    expect(regions).toEqual(['sts.eu-west-1.amazonaws.com']);
  });
});
