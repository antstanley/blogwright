/*
 * Which AWS credentials an invocation uses, whether they work, and whose they
 * are - decided before any state is loaded. `resolveAwsProfile` applies the
 * profile precedence; `resolveAwsSession` checks the profile exists, builds
 * the clients, calls `sts:GetCallerIdentity`, offers an interactive sign-in
 * when the credentials are expired or missing, and enforces the account pin.
 * `createContext`, `whoami` and `init` are its three callers, so they cannot
 * disagree. The process environment, home directory and platform arrive as
 * data: only the composition root reads them.
 */

import {
  assertAccountPin,
  AwsCredentialsError,
  AwsError,
  createClients,
  readAwsProfiles,
  shortIdentity,
  type AccountPinStatus,
  type AwsClients,
  type AwsConfig,
  type AwsProfiles,
  type CallerIdentity,
  type ClientBundleOptions,
  type FileSystem,
  type ProfileSignIn,
  type ProfileStyle,
  type Terminal,
} from 'blogwright-core';

import type { Logger } from './logger.js';
import type { AwsLogin } from './ports.js';

/** Which precedence row chose the credentials. */
export type AwsProfileSource = 'flag' | 'env' | 'env-keys' | 'config' | 'default';

/** The outcome of profile resolution: a named profile, or `null` for the provider chain. */
export interface ResolvedAwsProfile {
  name: string | null;
  source: AwsProfileSource;
}

/** The parts of the operator's machine AWS resolution reads, injected by the composition root. */
export interface AwsHost {
  processEnv: NodeJS.ProcessEnv;
  home: string;
  platform: NodeJS.Platform;
  /** Working directory the repository root is searched from. */
  cwd: string;
  /** Builds the AWS clients; defaults to core's `createClients`. Tests substitute it. */
  createClients?: ((opts: ClientBundleOptions) => AwsClients) | undefined;
}

export interface AwsSessionOptions {
  /** Region STS (and every client) signs in. */
  region: string;
  /** `--endpoint`; `AWS_ENDPOINT_URL` from the host applies when absent. */
  endpointOverride?: string | undefined;
  /** `--profile` - row 1 of the precedence. */
  flag?: string | undefined;
  /** The environment config's `aws` block, when there is a config. */
  aws?: AwsConfig | undefined;
  /** How messages name the config file, e.g. `config/production.jsonc`. */
  configLabel: string;
  host: AwsHost;
  ports: { fs: FileSystem; terminal: Terminal; awsLogin: AwsLogin };
  logger: Logger;
}

export interface AwsSession {
  profile: ResolvedAwsProfile;
  clients: AwsClients;
  identity: CallerIdentity;
  pin: AccountPinStatus;
}

/** Trim a value, treating blank as absent. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * True when credentials are exported into the environment - an access key
 * pair, a web identity token file, or a container credentials endpoint - as
 * CI exports them.
 */
function hasEnvironmentCredentials(env: NodeJS.ProcessEnv): boolean {
  if (present(env.AWS_ACCESS_KEY_ID) && present(env.AWS_SECRET_ACCESS_KEY)) return true;
  return Boolean(
    present(env.AWS_WEB_IDENTITY_TOKEN_FILE) ||
    present(env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) ||
    present(env.AWS_CONTAINER_CREDENTIALS_FULL_URI),
  );
}

/**
 * The profile precedence; the first matching row wins: `--profile`,
 * `AWS_PROFILE`, exported environment credentials (no name), the config's
 * `aws.profile`, then the default chain (no name). Exported credentials beat
 * the config's profile so a committed `aws.profile` cannot break CI.
 */
export function resolveAwsProfile(input: {
  flag?: string | undefined;
  processEnv: NodeJS.ProcessEnv;
  config?: AwsConfig | undefined;
}): ResolvedAwsProfile {
  const flag = present(input.flag);
  if (flag) return { name: flag, source: 'flag' };
  const env = present(input.processEnv.AWS_PROFILE);
  if (env) return { name: env, source: 'env' };
  if (hasEnvironmentCredentials(input.processEnv)) return { name: null, source: 'env-keys' };
  const config = present(input.config?.profile);
  if (config) return { name: config, source: 'config' };
  return { name: null, source: 'default' };
}

/**
 * True when a browser cannot be opened for sign-in: `BLOGWRIGHT_HEADLESS=1`,
 * an SSH session, or Linux with no display. `BLOGWRIGHT_HEADLESS=0` forces
 * the browser flow.
 */
export function isHeadless(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  const forced = present(env.BLOGWRIGHT_HEADLESS);
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (present(env.SSH_CONNECTION) || present(env.SSH_TTY)) return true;
  return platform === 'linux' && !present(env.DISPLAY) && !present(env.WAYLAND_DISPLAY);
}

/** STS error codes that mean the signing credentials themselves are bad or expired. */
const CREDENTIAL_ERROR_CODES = new Set([
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidClientTokenId',
  'UnrecognizedClientException',
  'SignatureDoesNotMatch',
]);

/**
 * True when a `GetCallerIdentity` failure is about the credentials - the
 * provider failed, or STS rejected them - rather than the network, endpoint
 * or region, which propagate unchanged.
 */
export function isCredentialFailure(err: unknown): boolean {
  if (err instanceof AwsCredentialsError) return true;
  return err instanceof AwsError && CREDENTIAL_ERROR_CODES.has(err.code);
}

const SOURCE_LABELS: Readonly<Record<AwsProfileSource, string>> = {
  flag: '--profile',
  env: 'AWS_PROFILE',
  'env-keys': 'environment credentials',
  config: 'config',
  default: 'default credentials',
};

/** How an operator names a precedence row: `--profile`, `AWS_PROFILE`, `config`, ... */
export function profileSourceLabel(source: AwsProfileSource): string {
  return SOURCE_LABELS[source];
}

/** Where the profile came from, naming the config file itself for the config row. */
function profileOrigin(source: AwsProfileSource, configLabel: string): string {
  return source === 'config' ? configLabel : profileSourceLabel(source);
}

/** `profile mysite-prod (config)`, or `environment credentials` / `default credentials`. */
function describeProfile(profile: ResolvedAwsProfile): string {
  const label = profileSourceLabel(profile.source);
  return profile.name === null ? label : `profile ${profile.name} (${label})`;
}

/** How failures name the credentials: `AWS credentials for profile "x"`, or the unnamed kind. */
function credentialsSubject(profile: ResolvedAwsProfile): string {
  if (profile.name !== null) return `AWS credentials for profile "${profile.name}"`;
  return profile.source === 'env-keys'
    ? 'The AWS credentials exported in the environment'
    : 'The default AWS credentials';
}

/**
 * Refuse a named profile the shared files do not define, before any AWS call.
 * Under an endpoint override it is dropped instead: the emulator never checks
 * credentials, and a committed `aws.profile` must not break emulator runs on
 * machines without it.
 */
function checkProfileExists(
  profile: ResolvedAwsProfile,
  profiles: AwsProfiles,
  opts: { override: boolean; configLabel: string; notice: (line: string) => void },
): ResolvedAwsProfile {
  if (profile.name === null || profiles.has(profile.name)) return profile;
  if (opts.override) {
    opts.notice(`profile "${profile.name}" not found - using emulator credentials`);
    return { name: null, source: 'default' };
  }
  const available = profiles.names.length > 0 ? profiles.names.join(', ') : 'none';
  throw new Error(
    `AWS profile "${profile.name}" not found (from ${profileOrigin(profile.source, opts.configLabel)})\n` +
      `available: ${available}`,
  );
}

/** One sign-in command the login offer can run. */
interface LoginChoice {
  /** argv for the AWS CLI, without the leading `aws`. */
  args: string[];
  hint: string;
}

/** Both sign-in commands, `aws sso login` first, and which one is the default. */
export interface LoginMenu {
  choices: [LoginChoice, LoginChoice];
  /** Index into `choices`. */
  defaultIndex: 0 | 1;
}

/**
 * The two sign-in commands for a profile. The default follows the style: SSO
 * profiles default to `aws sso login`, console and unconfigured ones to
 * `aws login`. Headless hosts get each command's browserless flag.
 */
export function buildLoginChoices(
  profileName: string | null,
  style: ProfileStyle,
  headless: boolean,
): LoginMenu {
  const profileArgs = profileName === null ? [] : ['--profile', profileName];
  const sso: LoginChoice = {
    args: ['sso', 'login', ...profileArgs, ...(headless ? ['--use-device-code'] : [])],
    hint: style === 'sso' ? 'profile uses IAM Identity Center' : 'IAM Identity Center',
  };
  const login: LoginChoice = {
    args: ['login', ...profileArgs, ...(headless ? ['--remote'] : [])],
    hint: style === 'login' ? 'profile uses AWS console credentials' : 'AWS console credentials',
  };
  return { choices: [sso, login], defaultIndex: style === 'sso' ? 0 : 1 };
}

function commandLine(choice: LoginChoice): string {
  return ['aws', ...choice.args].join(' ');
}

/** Styles a sign-in command can repair. */
const SIGN_IN_STYLES: ReadonlySet<ProfileStyle> = new Set(['sso', 'login', 'unconfigured']);

const DEFAULT_PROFILE_NAME = 'default';

/**
 * The profile a repair targets: the one whose settings decided the style,
 * which for a `source_profile` chain is its source - the login that repairs
 * a role chain is the login of its source profile. A null profile stays null
 * (no `--profile`) unless the default profile chains to another one.
 */
function repairProfile(profile: ResolvedAwsProfile, signIn: ProfileSignIn): string | null {
  if (profile.name === null && signIn.profile === DEFAULT_PROFILE_NAME) return null;
  return signIn.profile;
}

/** The one line of guidance shown when no login is offered. */
function credentialGuidance(
  profile: ResolvedAwsProfile,
  signIn: ProfileSignIn,
  headless: boolean,
): string {
  if (profile.source === 'env-keys') {
    return 'Refresh the exported credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN).';
  }
  const target = repairProfile(profile, signIn);
  const named = target === null ? '' : ` --profile ${target}`;
  switch (signIn.style) {
    case 'sso':
    case 'login':
    case 'unconfigured': {
      const menu = buildLoginChoices(target, signIn.style, headless);
      const commands =
        signIn.style === 'unconfigured'
          ? menu.choices.map(commandLine).join('  or  ')
          : commandLine(menu.choices[menu.defaultIndex]);
      return `Sign in with: ${commands}`;
    }
    case 'static':
      return `Update the access keys with: aws configure${named}`;
    case 'process':
      return `Check the profile's credential_process: ${signIn.detail ?? '(unset)'}`;
    case 'external':
      return `Check the role's credential_source: ${signIn.detail ?? '(unset)'}`;
  }
}

/** Raised when a sign-in cannot repair the credentials; the message is the whole report. */
function unusableCredentials(cause: unknown, profile: ResolvedAwsProfile, advice: string): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(`${credentialsSubject(profile)} are not usable:\n  ${reason}\n${advice}`, {
    cause,
  });
}

/** Maximum invalid answers to the sign-in menu before it is treated as cancel. */
const MENU_ATTEMPTS = 3;

/** Ask which sign-in to run; resolves the chosen command, or undefined for cancel. */
async function askLoginChoice(
  menu: LoginMenu,
  terminal: Terminal,
  logger: Logger,
): Promise<LoginChoice | undefined> {
  const commands = menu.choices.map(commandLine);
  const width = Math.max(...commands.map((command) => command.length)) + 4;
  logger.info('How do you want to sign in?');
  menu.choices.forEach((choice, index) => {
    logger.info(`  ${index + 1}) ${commands[index]!.padEnd(width)}(${choice.hint})`);
  });
  logger.info('  3) cancel');
  const fallback = String(menu.defaultIndex + 1);
  for (let attempt = 0; attempt < MENU_ATTEMPTS; attempt++) {
    const answer = (await terminal.question(`choice [${fallback}]: `)).trim() || fallback;
    if (answer === '1' || answer === '2') return menu.choices[Number(answer) - 1];
    if (answer === '3') return undefined;
    logger.warn('answer 1, 2 or 3');
  }
  return undefined;
}

/** Run the chosen sign-in, raising on a missing AWS CLI or a failed command. */
async function runLogin(choice: LoginChoice, ports: AwsSessionOptions['ports']): Promise<void> {
  ports.terminal.status('');
  const result = await ports.awsLogin.run(choice.args);
  if (result.ok) return;
  if (result.reason === 'not-installed') {
    throw new Error(
      `cannot run "${commandLine(choice)}": the aws command was not found on the PATH - ` +
        'install AWS CLI v2 (https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)',
    );
  }
  throw new Error(`"${commandLine(choice)}" exited with code ${result.code}`);
}

/**
 * Repair a credential failure: offer a sign-in when one applies, run it, and
 * return so the caller retries; otherwise raise the failure with guidance.
 */
async function repairCredentials(
  failure: unknown,
  profile: ResolvedAwsProfile,
  profiles: AwsProfiles,
  opts: AwsSessionOptions,
): Promise<void> {
  const signIn = profiles.signIn(profile.name);
  const headless = isHeadless(opts.host.processEnv, opts.host.platform);
  const offered =
    opts.ports.terminal.isInteractive &&
    profile.source !== 'env-keys' &&
    SIGN_IN_STYLES.has(signIn.style);
  if (!offered)
    throw unusableCredentials(failure, profile, credentialGuidance(profile, signIn, headless));

  const reason = failure instanceof Error ? failure.message : String(failure);
  opts.logger.warn(`${credentialsSubject(profile)} are not usable:\n  ${reason}`);
  const choice = await askLoginChoice(
    buildLoginChoices(repairProfile(profile, signIn), signIn.style, headless),
    opts.ports.terminal,
    opts.logger,
  );
  if (!choice) throw unusableCredentials(failure, profile, 'Sign-in cancelled.');
  await runLogin(choice, opts.ports);
}

/** The endpoint override in effect: `--endpoint`, else a nonblank `AWS_ENDPOINT_URL`. */
function resolveEndpointOverride(opts: AwsSessionOptions): string | undefined {
  return present(opts.endpointOverride) ?? present(opts.host.processEnv.AWS_ENDPOINT_URL);
}

/**
 * Resolve the profile, confirm it exists, build the clients, learn whose
 * credentials they are, and enforce the account pin - in that order, so a
 * mismatched account never reaches `StateStore.load`. A credential failure
 * goes to the login offer, which retries `GetCallerIdentity` once after a
 * successful sign-in; a second failure is reported, never offered again.
 */
export async function resolveAwsSession(opts: AwsSessionOptions): Promise<AwsSession> {
  const endpointOverride = resolveEndpointOverride(opts);
  const override = endpointOverride !== undefined;
  const resolved = resolveAwsProfile({
    flag: opts.flag,
    processEnv: opts.host.processEnv,
    config: opts.aws,
  });
  const notice = (line: string) => emitSessionLine(line, opts.ports.terminal, opts.logger);
  const configProfile = present(opts.aws?.profile);
  if (resolved.source === 'env-keys' && configProfile) {
    notice(`ignoring aws.profile "${configProfile}": environment credentials are set`);
  }
  const profiles = await readAwsProfiles(opts.ports.fs, opts.host.processEnv, opts.host.home);
  const profile = checkProfileExists(resolved, profiles, {
    override,
    configLabel: opts.configLabel,
    notice,
  });

  const makeClients = opts.host.createClients ?? createClients;
  const buildClients = () =>
    makeClients({ region: opts.region, endpointOverride, profile: profile.name });
  let clients = buildClients();
  let identity: CallerIdentity;
  try {
    identity = await clients.sts.getCallerIdentity();
  } catch (err) {
    if (override || !isCredentialFailure(err)) throw err;
    await repairCredentials(err, profile, profiles, opts);
    clients = buildClients();
    try {
      identity = await clients.sts.getCallerIdentity();
    } catch (retryErr) {
      if (!isCredentialFailure(retryErr)) throw retryErr;
      throw unusableCredentials(retryErr, profile, 'Signing in did not help; check the profile.');
    }
  }

  const pin = assertAccountPin(opts.aws?.accountId, identity, {
    override,
    pinSource: opts.configLabel,
    credentialsDescription: `${shortIdentity(identity.arn)}, ${describeCredentialsOrigin(profile, opts.configLabel)}`,
  });
  if (pin === 'skipped') notice('account pin skipped: endpoint override');
  return { profile, clients, identity, pin };
}

/** `profile "personal" from AWS_PROFILE`, or the unnamed kind of credentials. */
function describeCredentialsOrigin(profile: ResolvedAwsProfile, configLabel: string): string {
  if (profile.name === null) return profileOrigin(profile.source, configLabel);
  return `profile "${profile.name}" from ${profileOrigin(profile.source, configLabel)}`;
}

const PIN_LABELS: Readonly<Record<AccountPinStatus, string>> = {
  matched: 'pinned',
  unset: 'unpinned',
  skipped: 'pin skipped',
};

/** `aws  123456789012 · AdminRole · profile mysite-prod (config) · pinned` */
export function formatIdentityLine(
  session: Pick<AwsSession, 'identity' | 'profile' | 'pin'>,
): string {
  return [
    `aws  ${session.identity.account}`,
    shortIdentity(session.identity.arn),
    describeProfile(session.profile),
    PIN_LABELS[session.pin],
  ].join(' · ');
}

/**
 * Emit a session line - the identity line, or a notice such as `account pin
 * skipped`. Interactive sessions get it through the logger; otherwise
 * (`--plain`, piped output, CI) it goes to stderr, so the non-interactive
 * stdout of `history`, `status` and `whoami` stays byte-identical.
 */
export function emitSessionLine(line: string, terminal: Terminal, logger: Logger): void {
  if (terminal.isInteractive) logger.info(line);
  else terminal.error(line);
}
