/*
 * `blogwright whoami [env]` - which AWS credentials this repo's commands
 * would use, whose they are, and whether the account pin accepts them. Runs
 * the same session resolution as every context-building command but loads no
 * state, and works without a config (signing STS in us-east-1, no pin) or
 * outside a repository, because it is most useful before a repo is set up.
 */

import { relative } from 'node:path';

import {
  findRepoRoot,
  RepoRootNotFoundError,
  shortIdentity,
  type AccountPinStatus,
  type FileSystem,
  type OpsConfig,
  type Terminal,
} from 'blogwright-core';

import {
  isNamedProfile,
  profileSourceLabel,
  resolveAwsSession,
  type AwsHost,
  type ResolvedAwsProfile,
} from './aws-session.js';
import { ConfigNotFoundError, loadConfig } from './context.js';
import type { Logger } from './logger.js';
import type { AwsLogin } from './ports.js';

/** Region STS signs in when there is no config to name one. */
const NO_CONFIG_REGION = 'us-east-1';

export interface WhoamiOptions {
  env: string;
  configPath?: string | undefined;
  profile?: string | undefined;
  endpointOverride?: string | undefined;
}

export interface WhoamiDeps {
  fs: FileSystem;
  terminal: Terminal;
  logger: Logger;
  awsLogin: AwsLogin;
  host: AwsHost;
}

/** The environment's config, or why there is none. */
type LocatedConfig =
  | { found: true; config: OpsConfig; label: string }
  | { found: false; reason: 'no config found' | 'outside a repository' };

async function repoRootOrUndefined(fs: FileSystem, cwd: string): Promise<string | undefined> {
  try {
    return await findRepoRoot(fs, cwd);
  } catch (err) {
    if (err instanceof RepoRootNotFoundError) return undefined;
    throw err;
  }
}

/**
 * Load the environment's config. An explicit `--config` must exist; without
 * one, a missing candidate or a missing repository is reported, not raised.
 */
async function locateConfig(
  fs: FileSystem,
  cwd: string,
  opts: WhoamiOptions,
): Promise<LocatedConfig> {
  const root = await repoRootOrUndefined(fs, cwd);
  if (root === undefined && !opts.configPath)
    return { found: false, reason: 'outside a repository' };
  const base = root ?? cwd;
  try {
    const { config, path } = await loadConfig(fs, {
      env: opts.env,
      root: base,
      configPath: opts.configPath,
    });
    return { found: true, config, label: relative(base, path) || path };
  } catch (err) {
    if (err instanceof ConfigNotFoundError && !opts.configPath) {
      return { found: false, reason: 'no config found' };
    }
    throw err;
  }
}

/** `mysite-prod (config)`, or `none (default credentials)` when no profile is named. */
function describeProfileValue(profile: ResolvedAwsProfile): string {
  const name = isNamedProfile(profile) ? profile.name : 'none';
  return `${name} (${profileSourceLabel(profile.source)})`;
}

const PIN_VALUES: Readonly<Record<AccountPinStatus, string>> = {
  matched: 'matches aws.accountId',
  unset: 'not set',
  skipped: 'skipped (endpoint override)',
};

/**
 * Print the resolved identity as fixed `key  value` lines on stdout. Exits 0
 * when the identity resolves and the pin matches or is absent; a missing
 * profile, unusable credentials or a pin mismatch is raised (exit 1).
 */
export async function whoami(opts: WhoamiOptions, deps: WhoamiDeps): Promise<number> {
  const located = await locateConfig(deps.fs, deps.host.cwd, opts);
  const config = located.found ? located.config : undefined;
  const session = await resolveAwsSession({
    region: config?.region ?? NO_CONFIG_REGION,
    endpointOverride: opts.endpointOverride,
    flag: opts.profile,
    aws: config?.aws,
    configLabel: located.found ? located.label : 'config',
    host: deps.host,
    ports: { fs: deps.fs, terminal: deps.terminal, awsLogin: deps.awsLogin },
    logger: deps.logger,
  });
  const rows: [string, string][] = [
    ['account', session.identity.account],
    ['identity', shortIdentity(session.identity.arn)],
    ['arn', session.identity.arn],
    ['profile', describeProfileValue(session.profile)],
    ['env', `${opts.env} (${located.found ? located.label : located.reason})`],
    ['region', session.clients.region],
    ['pin', PIN_VALUES[session.pin]],
  ];
  for (const [key, value] of rows) deps.logger.info(`${key.padEnd(10)}${value}`);
  return 0;
}
