import {
  AwsCredentialsError,
  AwsError,
  createClients,
  createMemoryFileSystem,
  createScriptedTerminal,
  type CallerIdentity,
  type ScriptedTerminal,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import {
  buildLoginChoices,
  emitIdentityLine,
  formatIdentityLine,
  isCredentialFailure,
  isHeadless,
  resolveAwsProfile,
  resolveAwsSession,
  type AwsSession,
  type AwsSessionOptions,
} from './aws-session.js';
import type { Logger } from './logger.js';
import type { AwsLoginResult } from './ports.js';
import { createRecordingAwsLogin, TEST_HOME } from './test-support.js';

const ACCOUNT = '123456789012';
const OTHER_ACCOUNT = '210987654321';

const IDENTITY: CallerIdentity = {
  account: ACCOUNT,
  arn: `arn:aws:sts::${ACCOUNT}:assumed-role/AdminRole/ant`,
  userId: 'AROAEXAMPLE:ant',
};

const SHARED_CONFIG = `[default]
region = us-east-1

[profile mysite-prod]
sso_session = mysite

[profile console]
login_session = arn:aws:signin:::devtools/same-device

[profile bare]
region = eu-west-2

[profile deployed]
credential_process = /usr/local/bin/get-creds

[profile ec2]
role_arn = arn:aws:iam::123456789012:role/Deploy
credential_source = Ec2InstanceMetadata

[profile personal]
sso_start_url = https://personal.awsapps.com/start
`;

const SHARED_CREDENTIALS = `[keys]
aws_access_key_id = AKIAEXAMPLE
aws_secret_access_key = secret
`;

/** One scripted answer to `GetCallerIdentity`, consumed per attempt. */
type StsOutcome = CallerIdentity | 'provider-fails' | 'expired-token' | 'invalid-action';

function capturingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (msg: string) => {
    lines.push(`${level} ${msg}`);
  };
  return {
    lines,
    info: push('info'),
    step: push('step'),
    ok: push('ok'),
    warn: push('warn'),
    error: push('error'),
  };
}

function identityXml(identity: CallerIdentity): string {
  return (
    '<GetCallerIdentityResponse><GetCallerIdentityResult>' +
    `<Arn>${identity.arn}</Arn><UserId>${identity.userId}</UserId>` +
    `<Account>${identity.account}</Account>` +
    '</GetCallerIdentityResult></GetCallerIdentityResponse>'
  );
}

function errorXml(code: string): string {
  return `<ErrorResponse><Error><Code>${code}</Code><Message>${code} message</Message></Error></ErrorResponse>`;
}

function textResponse(statusCode: number, text: string) {
  return { statusCode, headers: {}, body: new TextEncoder().encode(text), text: () => text };
}

interface World {
  options: AwsSessionOptions;
  terminal: ScriptedTerminal;
  logger: ReturnType<typeof capturingLogger>;
  awsLogin: ReturnType<typeof createRecordingAwsLogin>;
  /** The `profile` each client bundle was built for, in order. */
  builtProfiles: (string | null | undefined)[];
  /** The endpoint override each bundle was built with. */
  builtEndpoints: (string | undefined)[];
  stsCalls: number;
}

/**
 * A session over in-memory shared files and a scripted STS: every
 * `GetCallerIdentity` attempt consumes one outcome, either in the credential
 * provider (`provider-fails`) or at the transport.
 */
function sessionWorld(
  setup: {
    outcomes?: StsOutcome[];
    env?: NodeJS.ProcessEnv;
    interactive?: boolean;
    answers?: string[];
    logins?: AwsLoginResult[];
    platform?: NodeJS.Platform;
    files?: boolean;
    options?: Partial<AwsSessionOptions>;
  } = {},
): World {
  const outcomes = [...(setup.outcomes ?? [IDENTITY])];
  const terminal = createScriptedTerminal({
    interactive: setup.interactive ?? true,
    answers: setup.answers ?? [],
  });
  const logger = capturingLogger();
  const awsLogin = createRecordingAwsLogin(setup.logins);
  const fs = createMemoryFileSystem(
    setup.files === false
      ? {}
      : {
          [`${TEST_HOME}/.aws/config`]: SHARED_CONFIG,
          [`${TEST_HOME}/.aws/credentials`]: SHARED_CREDENTIALS,
        },
  );
  const world: World = {
    terminal,
    logger,
    awsLogin,
    builtProfiles: [],
    builtEndpoints: [],
    stsCalls: 0,
    options: undefined as never,
  };
  const transport: Transport = async (req) => {
    if (!String(req.body).includes('Action=GetCallerIdentity')) {
      throw new Error(`unexpected AWS request: ${req.url}`);
    }
    world.stsCalls += 1;
    const outcome = outcomes.shift();
    if (outcome === undefined) throw new Error('no STS outcome left in the script');
    if (outcome === 'expired-token') return textResponse(403, errorXml('ExpiredToken'));
    if (outcome === 'invalid-action') return textResponse(400, errorXml('InvalidAction'));
    if (outcome === 'provider-fails') throw new Error('provider outcome reached the transport');
    return textResponse(200, identityXml(outcome));
  };
  world.options = {
    region: 'eu-west-2',
    configLabel: 'config/production.jsonc',
    host: {
      processEnv: setup.env ?? {},
      home: TEST_HOME,
      platform: setup.platform ?? 'darwin',
      createClients: (opts) => {
        world.builtProfiles.push(opts.profile);
        world.builtEndpoints.push(opts.endpointOverride);
        return createClients({
          region: opts.region,
          endpointOverride: opts.endpointOverride,
          transport,
          credentials: async () => {
            if (outcomes[0] === 'provider-fails') {
              outcomes.shift();
              throw new AwsCredentialsError(
                new Error('The SSO session associated with this profile has expired.'),
              );
            }
            return { accessKeyId: 'AKIA', secretAccessKey: 'secret' };
          },
        });
      },
    },
    ports: { fs, terminal, awsLogin },
    logger,
    ...setup.options,
  };
  return world;
}

describe('resolveAwsProfile', () => {
  const KEYS = { AWS_ACCESS_KEY_ID: 'AKIA', AWS_SECRET_ACCESS_KEY: 'secret' };

  it.each([
    ['--profile', { flag: 'a', processEnv: { AWS_PROFILE: 'b' } }, { name: 'a', source: 'flag' }],
    ['AWS_PROFILE', { processEnv: { AWS_PROFILE: 'b' } }, { name: 'b', source: 'env' }],
    ['env keys', { processEnv: KEYS }, { name: null, source: 'env-keys' }],
    ['config', { processEnv: {}, config: { profile: 'c' } }, { name: 'c', source: 'config' }],
    ['default', { processEnv: {} }, { name: null, source: 'default' }],
    [
      'env keys beat the config profile',
      { processEnv: KEYS, config: { profile: 'c' } },
      { name: null, source: 'env-keys' },
    ],
    [
      'the flag beats env keys',
      { flag: 'a', processEnv: KEYS, config: { profile: 'c' } },
      { name: 'a', source: 'flag' },
    ],
    [
      'AWS_PROFILE beats env keys',
      { processEnv: { ...KEYS, AWS_PROFILE: 'b' } },
      { name: 'b', source: 'env' },
    ],
    [
      'a web identity token file is env credentials',
      { processEnv: { AWS_WEB_IDENTITY_TOKEN_FILE: '/t' }, config: { profile: 'c' } },
      { name: null, source: 'env-keys' },
    ],
    [
      'a container credentials URI is env credentials',
      { processEnv: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://x' } },
      { name: null, source: 'env-keys' },
    ],
    [
      'blank values are absent',
      {
        flag: ' ',
        processEnv: { AWS_PROFILE: '', AWS_ACCESS_KEY_ID: 'A' },
        config: { profile: 'c' },
      },
      { name: 'c', source: 'config' },
    ],
    [
      'values are trimmed',
      { flag: '  padded  ', processEnv: {} },
      { name: 'padded', source: 'flag' },
    ],
  ] as const)('%s', (_label, input, expected) => {
    expect(resolveAwsProfile(input)).toEqual(expected);
  });
});

describe('isHeadless', () => {
  it('honours BLOGWRIGHT_HEADLESS both ways', () => {
    expect(isHeadless({ BLOGWRIGHT_HEADLESS: '1' }, 'darwin')).toBe(true);
    expect(isHeadless({ BLOGWRIGHT_HEADLESS: '0', SSH_TTY: '/dev/ttys001' }, 'linux')).toBe(false);
  });

  it('treats an SSH session as headless', () => {
    expect(isHeadless({ SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' }, 'darwin')).toBe(true);
    expect(isHeadless({ SSH_TTY: '/dev/pts/0' }, 'darwin')).toBe(true);
  });

  it('treats Linux with no display as headless, and with one as not', () => {
    expect(isHeadless({}, 'linux')).toBe(true);
    expect(isHeadless({ DISPLAY: ':0' }, 'linux')).toBe(false);
    expect(isHeadless({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBe(false);
    expect(isHeadless({}, 'darwin')).toBe(false);
  });
});

describe('isCredentialFailure', () => {
  const sts = (code: string) =>
    new AwsError({ service: 'sts', code, message: 'm', statusCode: 403 });

  it('accepts provider failures and the credential STS codes', () => {
    expect(isCredentialFailure(new AwsCredentialsError(new Error('x')))).toBe(true);
    for (const code of [
      'ExpiredToken',
      'ExpiredTokenException',
      'InvalidClientTokenId',
      'UnrecognizedClientException',
      'SignatureDoesNotMatch',
    ]) {
      expect(isCredentialFailure(sts(code))).toBe(true);
    }
  });

  it('rejects other STS codes, network errors and plain errors', () => {
    expect(isCredentialFailure(sts('AccessDenied'))).toBe(false);
    expect(isCredentialFailure(new TypeError('fetch failed'))).toBe(false);
    expect(isCredentialFailure(new Error('ExpiredToken'))).toBe(false);
  });
});

describe('buildLoginChoices', () => {
  it('defaults to aws sso login for an sso profile', () => {
    const menu = buildLoginChoices('p', 'sso', false);
    expect(menu.defaultIndex).toBe(0);
    expect(menu.choices.map((c) => c.args)).toEqual([
      ['sso', 'login', '--profile', 'p'],
      ['login', '--profile', 'p'],
    ]);
  });

  it('defaults to aws login for login and unconfigured profiles', () => {
    expect(buildLoginChoices('p', 'login', false).defaultIndex).toBe(1);
    expect(buildLoginChoices('p', 'unconfigured', false).defaultIndex).toBe(1);
  });

  it('omits --profile for a null profile', () => {
    expect(buildLoginChoices(null, 'sso', false).choices.map((c) => c.args)).toEqual([
      ['sso', 'login'],
      ['login'],
    ]);
  });

  it('adds each command its browserless flag on a headless host', () => {
    expect(buildLoginChoices('p', 'sso', true).choices.map((c) => c.args)).toEqual([
      ['sso', 'login', '--profile', 'p', '--use-device-code'],
      ['login', '--profile', 'p', '--remote'],
    ]);
  });
});

describe('resolveAwsSession - profile resolution', () => {
  it('builds clients for the config profile and returns whose credentials they are', async () => {
    const world = sessionWorld({
      options: { aws: { profile: 'mysite-prod', accountId: ACCOUNT } },
    });

    const session = await resolveAwsSession(world.options);

    expect(session.identity).toEqual(IDENTITY);
    expect(session.profile).toEqual({ name: 'mysite-prod', source: 'config' });
    expect(session.pin).toBe('matched');
    expect(world.builtProfiles).toEqual(['mysite-prod']);
  });

  it('ignores the config profile when environment credentials are set, saying so once', async () => {
    const world = sessionWorld({
      env: { AWS_ACCESS_KEY_ID: 'AKIA', AWS_SECRET_ACCESS_KEY: 'secret' },
      options: { aws: { profile: 'mysite-prod' } },
    });

    const session = await resolveAwsSession(world.options);

    expect(session.profile).toEqual({ name: null, source: 'env-keys' });
    expect(world.builtProfiles).toEqual([null]);
    expect(world.logger.lines).toEqual([
      'info ignoring aws.profile "mysite-prod": environment credentials are set',
    ]);
  });

  it('refuses a profile the shared files do not define, before any AWS call', async () => {
    const world = sessionWorld({ options: { aws: { profile: 'mysite-staging' } } });

    await expect(resolveAwsSession(world.options)).rejects.toThrow(
      'AWS profile "mysite-staging" not found (from config/production.jsonc)\n' +
        'available: default, bare, console, deployed, ec2, keys, mysite-prod, personal',
    );
    expect(world.builtProfiles).toEqual([]);
  });

  it('names --profile and AWS_PROFILE as the source of a missing profile', async () => {
    const flag = sessionWorld({ options: { flag: 'nope' } });
    await expect(resolveAwsSession(flag.options)).rejects.toThrow('(from --profile)');
    const env = sessionWorld({ env: { AWS_PROFILE: 'nope' } });
    await expect(resolveAwsSession(env.options)).rejects.toThrow('(from AWS_PROFILE)');
  });

  it('reports "none" available when there are no shared files', async () => {
    const world = sessionWorld({ files: false, options: { flag: 'nope' } });
    await expect(resolveAwsSession(world.options)).rejects.toThrow('available: none');
  });

  it('drops a missing profile under an endpoint override, with an info line', async () => {
    const world = sessionWorld({
      options: { aws: { profile: 'mysite-staging' }, endpointOverride: 'http://localhost:4566' },
    });

    const session = await resolveAwsSession(world.options);

    expect(session.profile.name).toBeNull();
    expect(world.builtProfiles).toEqual([null]);
    expect(world.builtEndpoints).toEqual(['http://localhost:4566']);
    expect(world.logger.lines).toContain(
      'info profile "mysite-staging" not found - using emulator credentials',
    );
  });

  it('takes AWS_ENDPOINT_URL from the host environment as an endpoint override', async () => {
    const world = sessionWorld({ env: { AWS_ENDPOINT_URL: 'http://localhost:4566' } });

    await resolveAwsSession(world.options);

    expect(world.builtEndpoints).toEqual(['http://localhost:4566']);
  });

  it('passes no endpoint override when none is set', async () => {
    const world = sessionWorld();

    await resolveAwsSession(world.options);

    expect(world.builtEndpoints).toEqual([undefined]);
  });
});

describe('resolveAwsSession - account pin', () => {
  it('reports unpinned when no pin is configured', async () => {
    const world = sessionWorld();
    expect((await resolveAwsSession(world.options)).pin).toBe('unset');
  });

  it('refuses another account, naming the profile and where it came from', async () => {
    const world = sessionWorld({
      env: { AWS_PROFILE: 'personal' },
      outcomes: [{ ...IDENTITY, account: OTHER_ACCOUNT }],
      options: { aws: { accountId: ACCOUNT } },
    });

    await expect(resolveAwsSession(world.options)).rejects.toThrow(
      `config/production.jsonc pins AWS account ${ACCOUNT}, but the credentials in use\n` +
        `belong to ${OTHER_ACCOUNT} (AdminRole, profile "personal" from AWS_PROFILE).\n` +
        'Switch credentials with --profile, or change aws.accountId.',
    );
  });

  it('skips the pin under an endpoint override, logging that it did', async () => {
    const world = sessionWorld({
      outcomes: [{ ...IDENTITY, account: '000000000000' }],
      options: { aws: { accountId: ACCOUNT }, endpointOverride: 'http://localhost:4566' },
    });

    const session = await resolveAwsSession(world.options);

    expect(session.pin).toBe('skipped');
    expect(world.logger.lines).toContain('info account pin skipped: endpoint override');
  });
});

describe('resolveAwsSession - login offer', () => {
  it('offers both sign-ins with the sso default, runs the choice, and retries once', async () => {
    const world = sessionWorld({
      outcomes: ['provider-fails', IDENTITY],
      answers: [''],
      options: { flag: 'mysite-prod' },
    });

    const session = await resolveAwsSession(world.options);

    expect(session.identity).toEqual(IDENTITY);
    expect(world.awsLogin.calls).toEqual([['sso', 'login', '--profile', 'mysite-prod']]);
    expect(world.builtProfiles).toEqual(['mysite-prod', 'mysite-prod']);
    expect(world.terminal.statuses).toEqual(['']);
    expect(world.terminal.prompts).toEqual(['choice [1]: ']);
    expect(world.logger.lines).toEqual([
      'warn AWS credentials for profile "mysite-prod" are not usable:\n' +
        '  The SSO session associated with this profile has expired.',
      'info How do you want to sign in?',
      'info   1) aws sso login --profile mysite-prod    (profile uses IAM Identity Center)',
      'info   2) aws login --profile mysite-prod        (AWS console credentials)',
      'info   3) cancel',
    ]);
  });

  it('offers on an STS credential code as well as a provider failure', async () => {
    const world = sessionWorld({
      outcomes: ['expired-token', IDENTITY],
      answers: ['2'],
      options: { flag: 'mysite-prod' },
    });

    await resolveAwsSession(world.options);

    expect(world.awsLogin.calls).toEqual([['login', '--profile', 'mysite-prod']]);
  });

  it.each([
    ['console', 'choice [2]: '],
    ['bare', 'choice [2]: '],
    ['mysite-prod', 'choice [1]: '],
  ])('defaults the %s profile to %s', async (profile, prompt) => {
    const world = sessionWorld({
      outcomes: ['provider-fails', IDENTITY],
      answers: [''],
      options: { flag: profile },
    });

    await resolveAwsSession(world.options);

    expect(world.terminal.prompts).toEqual([prompt]);
  });

  it('follows the default profile style and omits --profile for a null profile', async () => {
    const world = sessionWorld({ outcomes: ['provider-fails', IDENTITY], answers: [''] });

    await resolveAwsSession(world.options);

    expect(world.awsLogin.calls).toEqual([['login']]);
  });

  it('adds the headless flags on a headless host', async () => {
    const world = sessionWorld({
      outcomes: ['provider-fails', IDENTITY],
      answers: ['1'],
      platform: 'linux',
      options: { flag: 'mysite-prod' },
    });

    await resolveAwsSession(world.options);

    expect(world.awsLogin.calls).toEqual([
      ['sso', 'login', '--profile', 'mysite-prod', '--use-device-code'],
    ]);
  });

  it('re-asks an answer that is not 1, 2 or 3', async () => {
    const world = sessionWorld({
      outcomes: ['provider-fails', IDENTITY],
      answers: ['9', '1'],
      options: { flag: 'mysite-prod' },
    });

    await resolveAwsSession(world.options);

    expect(world.logger.lines).toContain('warn answer 1, 2 or 3');
    expect(world.awsLogin.calls).toHaveLength(1);
  });

  it('cancel raises the original failure and runs nothing', async () => {
    const world = sessionWorld({
      outcomes: ['provider-fails'],
      answers: ['3'],
      options: { flag: 'mysite-prod' },
    });

    await expect(resolveAwsSession(world.options)).rejects.toThrow(
      'AWS credentials for profile "mysite-prod" are not usable:\n' +
        '  The SSO session associated with this profile has expired.\nSign-in cancelled.',
    );
    expect(world.awsLogin.calls).toEqual([]);
  });

  it('reports a second failure without offering again', async () => {
    const world = sessionWorld({
      outcomes: ['provider-fails', 'provider-fails'],
      answers: [''],
      options: { flag: 'mysite-prod' },
    });

    await expect(resolveAwsSession(world.options)).rejects.toThrow(
      'Signing in did not help; check the profile.',
    );
    expect(world.awsLogin.calls).toHaveLength(1);
    expect(world.terminal.prompts).toHaveLength(1);
  });

  it('says to install AWS CLI v2 when aws is not on the PATH', async () => {
    const world = sessionWorld({
      outcomes: ['provider-fails'],
      answers: [''],
      logins: [{ ok: false, reason: 'not-installed' }],
      options: { flag: 'mysite-prod' },
    });

    await expect(resolveAwsSession(world.options)).rejects.toThrow(/install AWS CLI v2/);
  });

  it('reports a failed sign-in with its command and exit code', async () => {
    const world = sessionWorld({
      outcomes: ['provider-fails'],
      answers: [''],
      logins: [{ ok: false, reason: 'exit', code: 255 }],
      options: { flag: 'mysite-prod' },
    });

    await expect(resolveAwsSession(world.options)).rejects.toThrow(
      '"aws sso login --profile mysite-prod" exited with code 255',
    );
  });
});

describe('resolveAwsSession - no login offer', () => {
  async function refusal(setup: Parameters<typeof sessionWorld>[0]): Promise<string> {
    const world = sessionWorld({ outcomes: ['provider-fails'], ...setup });
    const failure = await resolveAwsSession(world.options).then(
      () => 'resolved',
      (err: Error) => err.message,
    );
    expect(world.awsLogin.calls).toEqual([]);
    expect(world.terminal.prompts).toEqual([]);
    return failure;
  }

  it('prints the matching command in a non-interactive session', async () => {
    expect(await refusal({ interactive: false, options: { flag: 'mysite-prod' } })).toBe(
      'AWS credentials for profile "mysite-prod" are not usable:\n' +
        '  The SSO session associated with this profile has expired.\n' +
        'Sign in with: aws sso login --profile mysite-prod',
    );
    expect(await refusal({ interactive: false, options: { flag: 'bare' } })).toContain(
      'Sign in with: aws sso login --profile bare  or  aws login --profile bare',
    );
  });

  it('asks for refreshed exports when the credentials came from the environment', async () => {
    const message = await refusal({
      env: { AWS_ACCESS_KEY_ID: 'AKIA', AWS_SECRET_ACCESS_KEY: 's' },
    });
    expect(message).toContain('The AWS credentials exported in the environment are not usable');
    expect(message).toContain('Refresh the exported credentials');
  });

  it('points static keys at aws configure', async () => {
    expect(await refusal({ options: { flag: 'keys' } })).toContain(
      'Update the access keys with: aws configure --profile keys',
    );
  });

  it("names a process profile's credential_process", async () => {
    expect(await refusal({ options: { flag: 'deployed' } })).toContain(
      "Check the profile's credential_process: /usr/local/bin/get-creds",
    );
  });

  it("names an external profile's credential_source", async () => {
    expect(await refusal({ options: { flag: 'ec2' } })).toContain(
      "Check the role's credential_source: Ec2InstanceMetadata",
    );
  });

  it('reports credential failures unchanged under an endpoint override', async () => {
    const message = await refusal({
      outcomes: ['expired-token'],
      options: { flag: 'mysite-prod', endpointOverride: 'http://localhost:4566' },
    });
    expect(message).toBe('sts: ExpiredToken - ExpiredToken message (HTTP 403)');
  });

  it('propagates a failure that is not about credentials unchanged', async () => {
    const message = await refusal({
      outcomes: ['invalid-action'],
      options: { flag: 'mysite-prod' },
    });
    expect(message).toBe('sts: InvalidAction - InvalidAction message (HTTP 400)');
  });
});

describe('identity line', () => {
  const session: Pick<AwsSession, 'identity' | 'profile' | 'pin'> = {
    identity: IDENTITY,
    profile: { name: 'mysite-prod', source: 'config' },
    pin: 'matched',
  };

  it('names the account, identity, profile and pin', () => {
    expect(formatIdentityLine(session)).toBe(
      `aws  ${ACCOUNT} · AdminRole · profile mysite-prod (config) · pinned`,
    );
    expect(
      formatIdentityLine({ ...session, profile: { name: null, source: 'env-keys' }, pin: 'unset' }),
    ).toBe(`aws  ${ACCOUNT} · AdminRole · environment credentials · unpinned`);
    expect(
      formatIdentityLine({
        ...session,
        profile: { name: null, source: 'default' },
        pin: 'skipped',
      }),
    ).toBe(`aws  ${ACCOUNT} · AdminRole · default credentials · pin skipped`);
  });

  it('goes through the logger on an interactive terminal', () => {
    const terminal = createScriptedTerminal({ interactive: true });
    const logger = capturingLogger();
    emitIdentityLine('aws  line', terminal, logger);
    expect(logger.lines).toEqual(['info aws  line']);
    expect(terminal.errors).toEqual([]);
  });

  it('goes to stderr, leaving stdout untouched, otherwise', () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const logger = capturingLogger();
    emitIdentityLine('aws  line', terminal, logger);
    expect(terminal.errors).toEqual(['aws  line']);
    expect(terminal.writes).toEqual([]);
    expect(logger.lines).toEqual([]);
  });
});
