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
  /**
   * The profile the style was read from: the requested one, or the source
   * profile at the end of a `source_profile` chain. A sign-in targets this one.
   */
  profile: string;
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

type IniSections = Map<string, Map<string, string>>;

/**
 * A section header the SDK reads as `<kind> <name>` (`profile x`,
 * `sso-session x`), optionally quoted. A header that does not match is kept
 * whole (`default`, a credentials-file `[name]`).
 */
const PREFIXED_SECTION_PATTERN = /^([\w-]+)\s(["'])?([\w-@+.%:/]+)\2$/;

/** Section kinds the SDK recognises in a prefixed header; any other prefix is ignored. */
const SECTION_KINDS: ReadonlySet<string> = new Set(['profile', 'sso-session', 'services']);

/** Joins a prefixed header's kind and name into its section key (`profile.x`), as the SDK does. */
const SECTION_KIND_SEPARATOR = '.';

/** Header names the SDK refuses outright. */
const BLOCKED_SECTIONS: ReadonlySet<string> = new Set(['__proto__', 'profile __proto__']);

/** The section key a header opens, or undefined when the SDK would ignore its settings. */
function sectionKey(header: string): string | undefined {
  if (BLOCKED_SECTIONS.has(header)) return undefined;
  const prefixed = PREFIXED_SECTION_PATTERN.exec(header);
  if (!prefixed) return header;
  const [, kind, , name] = prefixed;
  return kind && SECTION_KINDS.has(kind) ? `${kind}${SECTION_KIND_SEPARATOR}${name}` : undefined;
}

/**
 * One ini file as `section -> key -> value`, parsed the way the SDK's
 * `parseIni` reads it, so a profile this module accepts is one `fromIni` can
 * resolve: `#`/`;` comments are stripped (inline ones too, after whitespace),
 * a key with an empty value opens an indented sub-section (`s3 =` then
 * `  max_concurrent_requests = 20`, stored as `s3.max_concurrent_requests`),
 * and a section exists only once it holds a setting.
 */
function parseIni(text: string): IniSections {
  const sections: IniSections = new Map();
  let current: string | undefined;
  let subSection: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = (raw.split(/(^|\s)[;#]/)[0] ?? '').trim();
    if (line.startsWith('[') && line.endsWith(']')) {
      current = sectionKey(line.slice(1, -1));
      subSection = undefined;
      continue;
    }
    const equals = line.indexOf('=');
    if (current === undefined || equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (value === '') {
      subSection = key;
      continue;
    }
    if (subSection !== undefined && raw.trimStart() === raw) subSection = undefined;
    if (!sections.has(current)) sections.set(current, new Map<string, string>());
    sections.get(current)?.set(subSection === undefined ? key : `${subSection}.${key}`, value);
  }
  return sections;
}

/**
 * The config file's profiles by name: `[default]`, then `[profile NAME]`
 * sections - a `[profile default]` replacing `[default]` outright, as in the
 * SDK. Other section kinds (`[sso-session x]`) are not profiles.
 */
function configProfiles(text: string): IniSections {
  const profiles: IniSections = new Map();
  const sections = parseIni(text);
  const bareDefault = sections.get(DEFAULT_PROFILE);
  if (bareDefault) profiles.set(DEFAULT_PROFILE, bareDefault);
  const profilePrefix = `profile${SECTION_KIND_SEPARATOR}`;
  for (const [key, settings] of sections) {
    if (key.startsWith(profilePrefix)) profiles.set(key.slice(profilePrefix.length), settings);
  }
  return profiles;
}

function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Profile names defined by the shared files: `[default]` and `[profile NAME]`
 * in the config file (other section kinds, such as `[sso-session x]`, are
 * ignored) and `[NAME]` in the credentials file, each holding at least one
 * setting. De-duplicated, `default` first, the rest in code-point order.
 */
export function collectProfiles(configText: string, credentialsText: string): string[] {
  const found = new Set([
    ...configProfiles(configText).keys(),
    ...parseIni(credentialsText).keys(),
  ]);
  const rest = [...found].filter((name) => name !== DEFAULT_PROFILE).sort(compareCodePoints);
  return found.has(DEFAULT_PROFILE) ? [DEFAULT_PROFILE, ...rest] : rest;
}

/** A profile's settings from both files; the credentials file wins a shared key, as in the SDK. */
function profileSettings(
  config: IniSections,
  credentials: IniSections,
  profile: string,
): Map<string, string> | undefined {
  const fromConfig = config.get(profile);
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
 * else, or an absent profile, is unconfigured. `profile` in the result names
 * where the style was found - the source profile at the end of a role chain -
 * because that is the profile a sign-in must target.
 */
export function readProfileStyle(
  configText: string,
  credentialsText: string,
  profile: string,
): ProfileSignIn {
  const config = configProfiles(configText);
  const credentials = parseIni(credentialsText);
  const visited = new Set<string>();

  const follow = (name: string): ProfileSignIn => {
    if (visited.has(name)) return { style: 'unconfigured', profile };
    visited.add(name);
    const settings = profileSettings(config, credentials, name);
    const setting = (key: string) => nonBlank(settings?.get(key));
    if (setting('sso_session') || setting('sso_start_url')) return { style: 'sso', profile: name };
    if (setting('login_session')) return { style: 'login', profile: name };
    const process = setting('credential_process');
    if (process) return { style: 'process', profile: name, detail: process };
    if (setting('aws_access_key_id')) return { style: 'static', profile: name };
    if (setting('role_arn')) {
      const source = setting('source_profile');
      if (source) return follow(source);
      const external = setting('credential_source');
      if (external) return { style: 'external', profile: name, detail: external };
    }
    return { style: 'unconfigured', profile: name };
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
