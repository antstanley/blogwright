/**
 * The shared AWS config and credentials files: where they are, which profiles
 * they define, and how each profile signs in. Parsing is pure; the one read
 * ({@link readAwsProfiles}) goes through the FileSystem port. Blogwright never
 * writes these files - the AWS CLI performs every sign-in.
 */

import { join } from 'node:path';

import { FileNotFoundError, type FileSystem } from '../ports.js';

/**
 * How a profile obtains credentials, which decides what repairs a failure:
 * `sso` (`aws sso login`), `login` (`aws login`), `process`
 * (`credential_process`), `static` (access keys), `external` (a role assumed
 * from environment, instance or container credentials) or `unconfigured`.
 */
export type ProfileStyle = 'sso' | 'login' | 'process' | 'static' | 'external' | 'unconfigured';

/** A profile's sign-in style plus the setting that names its source, when there is one. */
export interface ProfileSignIn {
  style: ProfileStyle;
  /** The `credential_process` (style `process`) or `credential_source` (style `external`). */
  detail?: string | undefined;
}

/** Paths of the shared config and credentials files. */
export interface ProfileFiles {
  configFile: string;
  credentialsFile: string;
}

/** The parsed shared files, ready for profile queries. */
export interface AwsProfiles {
  /** Every profile name, de-duplicated, `default` first and the rest in code-point order. */
  readonly names: readonly string[];
  has(name: string): boolean;
  /** The sign-in of `name`, or of `default` when `name` is null. */
  signIn(name: string | null): ProfileSignIn;
}

const DEFAULT_PROFILE = 'default';

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function expandHome(path: string, home: string): string {
  return path === '~' || path.startsWith('~/') ? join(home, path.slice(1)) : path;
}

/**
 * The shared file paths: `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE`
 * when set (a leading `~` expands to `home`), else `~/.aws/config` and
 * `~/.aws/credentials`.
 */
export function profileFiles(env: NodeJS.ProcessEnv, home: string): ProfileFiles {
  const config = nonBlank(env.AWS_CONFIG_FILE);
  const credentials = nonBlank(env.AWS_SHARED_CREDENTIALS_FILE);
  return {
    configFile: config ? expandHome(config, home) : join(home, '.aws', 'config'),
    credentialsFile: credentials
      ? expandHome(credentials, home)
      : join(home, '.aws', 'credentials'),
  };
}

/** One ini file as `section -> key -> value`; comments and blank lines skipped. */
function parseIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const name = (header[1] ?? '').trim();
      // A repeated header continues the same section, as in the AWS CLI.
      if (!sections.has(name)) sections.set(name, new Map<string, string>());
      current = sections.get(name);
      continue;
    }
    const pair = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (current && pair) current.set((pair[1] ?? '').toLowerCase(), (pair[2] ?? '').trim());
  }
  return sections;
}

/** Profile name a config-file section header declares, or undefined for other kinds. */
function configProfileName(header: string): string | undefined {
  if (header === DEFAULT_PROFILE) return DEFAULT_PROFILE;
  const named = /^profile\s+(.+)$/.exec(header);
  return named ? (named[1] ?? '').trim() : undefined;
}

function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Profile names defined by the shared files: `[default]` and `[profile NAME]`
 * in the config file (other section kinds, such as `[sso-session x]`, are
 * ignored) and `[NAME]` in the credentials file. De-duplicated, `default`
 * first, the rest in code-point order.
 */
export function collectProfiles(configText: string, credentialsText: string): string[] {
  const found = new Set<string>();
  for (const header of parseIni(configText).keys()) {
    const name = configProfileName(header);
    if (name) found.add(name);
  }
  for (const header of parseIni(credentialsText).keys()) found.add(header);
  const rest = [...found].filter((name) => name !== DEFAULT_PROFILE).sort(compareCodePoints);
  return found.has(DEFAULT_PROFILE) ? [DEFAULT_PROFILE, ...rest] : rest;
}

/** A profile's settings from both files; the credentials file wins a shared key, as in the SDK. */
function profileSettings(
  config: Map<string, Map<string, string>>,
  credentials: Map<string, Map<string, string>>,
  profile: string,
): Map<string, string> | undefined {
  const fromConfig =
    profile === DEFAULT_PROFILE
      ? (config.get(DEFAULT_PROFILE) ?? config.get(`profile ${DEFAULT_PROFILE}`))
      : config.get(`profile ${profile}`);
  const fromCredentials = credentials.get(profile);
  if (!fromConfig && !fromCredentials) return undefined;
  return new Map([...(fromConfig ?? []), ...(fromCredentials ?? [])]);
}

/**
 * How `profile` signs in, checked in this order: `sso_session` or
 * `sso_start_url` (sso), `login_session` (login), `credential_process`
 * (process), `aws_access_key_id` (static), `role_arn` with `source_profile`
 * (the source profile's style, followed recursively - a cycle is
 * unconfigured), `role_arn` with `credential_source` (external). Anything
 * else, or an absent profile, is unconfigured.
 */
export function readProfileStyle(
  configText: string,
  credentialsText: string,
  profile: string,
): ProfileSignIn {
  const config = parseIni(configText);
  const credentials = parseIni(credentialsText);
  const visited = new Set<string>();

  const follow = (name: string): ProfileSignIn => {
    if (visited.has(name)) return { style: 'unconfigured' };
    visited.add(name);
    const settings = profileSettings(config, credentials, name);
    const setting = (key: string) => nonBlank(settings?.get(key));
    if (setting('sso_session') || setting('sso_start_url')) return { style: 'sso' };
    if (setting('login_session')) return { style: 'login' };
    const process = setting('credential_process');
    if (process) return { style: 'process', detail: process };
    if (setting('aws_access_key_id')) return { style: 'static' };
    if (setting('role_arn')) {
      const source = setting('source_profile');
      if (source) return follow(source);
      const external = setting('credential_source');
      if (external) return { style: 'external', detail: external };
    }
    return { style: 'unconfigured' };
  };

  return follow(profile);
}

/** Read a file through the port, treating an absent file as empty. */
async function readOptional(fs: FileSystem, path: string): Promise<string> {
  try {
    return await fs.readText(path);
  } catch (err) {
    if (err instanceof FileNotFoundError) return '';
    throw err;
  }
}

/** Read and parse the shared AWS files located by {@link profileFiles}. */
export async function readAwsProfiles(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
  home: string,
): Promise<AwsProfiles> {
  const files = profileFiles(env, home);
  const configText = await readOptional(fs, files.configFile);
  const credentialsText = await readOptional(fs, files.credentialsFile);
  const names = collectProfiles(configText, credentialsText);
  const known = new Set(names);
  return {
    names,
    has: (name) => known.has(name),
    signIn: (name) => readProfileStyle(configText, credentialsText, name ?? DEFAULT_PROFILE),
  };
}
