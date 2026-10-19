/**
 * The shared AWS config and credentials files: where they are, which profiles
 * they define, and how each profile signs in. Parsing is pure; the one read
 * ({@link readAwsProfiles}) goes through the FileSystem port. Blogwright never
 * writes these files - the AWS CLI performs every sign-in.
 */

import { join } from 'node:path';

import type { FileSystem } from '../ports.js';

/**
 * How a profile obtains credentials, which decides what repairs a failure:
 * `sso` (`aws sso login`), `login` (`aws login`), `process`
 * (`credential_process`), `static` (access keys), `external` (a role assumed
 * from environment, instance or container credentials), `web-identity` (a
 * role assumed with a `web_identity_token_file`), `mfa` (a role whose
 * `mfa_serial` needs a code blogwright cannot prompt for) or `unconfigured`.
 */
export type ProfileStyle =
  | 'sso'
  | 'login'
  | 'process'
  | 'static'
  | 'external'
  | 'web-identity'
  | 'mfa'
  | 'unconfigured';

/** A profile's sign-in style plus the setting that names its source, when there is one. */
export interface ProfileSignIn {
  style: ProfileStyle;
  /**
   * The profile the style was read from: the requested one, or the source
   * profile at the end of a `source_profile` chain. A sign-in targets this one.
   */
  profile: string;
  /**
   * The `credential_process` (style `process`), `credential_source` (style
   * `external`), `web_identity_token_file` (style `web-identity`) or
   * `mfa_serial` (style `mfa`).
   */
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
  /** The sign-in of profile `name`; the default chain reads it from `default`. */
  signIn(name: string): ProfileSignIn;
}

/** The profile the default credential chain reads from the shared files. */
export const DEFAULT_PROFILE = 'default';

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
 * How `profile` signs in, classified in the order the SDK's `fromIni`
 * resolves it, so the advice matches the provider that actually failed:
 *
 * 1. a role (`role_arn` with exactly one of `source_profile` or
 *    `credential_source`): `mfa` when it sets `mfa_serial`; otherwise the
 *    source profile's style, followed recursively (a cycle is unconfigured),
 *    or `external` for a `credential_source`;
 * 2. access keys (`aws_access_key_id` and `aws_secret_access_key`): `static`;
 * 3. `role_arn` with `web_identity_token_file`: `web-identity`;
 * 4. `credential_process`: `process`;
 * 5. any `sso_*` setting: `sso`;
 * 6. `login_session`: `login`;
 * 7. anything else, or an absent profile: `unconfigured`.
 *
 * Inside a role chain, a source profile's access keys win over everything,
 * and a `credential_source` without a `role_arn` is `external`, as in the
 * SDK. `profile` in the result names where the style was found - the source
 * profile at the end of a role chain - because that is the profile a
 * sign-in must target.
 */
export function readProfileStyle(
  configText: string,
  credentialsText: string,
  profile: string,
): ProfileSignIn {
  const config = configProfiles(configText);
  const credentials = parseIni(credentialsText);
  const visited = new Set<string>();

  const follow = (name: string, isSource: boolean): ProfileSignIn => {
    if (visited.has(name)) return { style: 'unconfigured', profile };
    visited.add(name);
    const settings = profileSettings(config, credentials, name);
    const setting = (key: string) => nonBlank(settings?.get(key));
    const isStatic = Boolean(setting('aws_access_key_id') && setting('aws_secret_access_key'));
    if (isSource && isStatic) return { style: 'static', profile: name };

    const role = setting('role_arn');
    const source = setting('source_profile');
    const external = setting('credential_source');
    const isRole = Boolean(role) && Boolean(source) !== Boolean(external);
    if (isRole || (isSource && !role && external)) {
      const mfa = setting('mfa_serial');
      if (role && mfa) return { style: 'mfa', profile: name, detail: mfa };
      if (source) return follow(source, true);
      return { style: 'external', profile: name, detail: external };
    }
    if (isStatic) return { style: 'static', profile: name };
    const tokenFile = setting('web_identity_token_file');
    if (role && tokenFile) return { style: 'web-identity', profile: name, detail: tokenFile };
    const process = setting('credential_process');
    if (process) return { style: 'process', profile: name, detail: process };
    if (SSO_SETTINGS.some((key) => setting(key))) return { style: 'sso', profile: name };
    if (setting('login_session')) return { style: 'login', profile: name };
    return { style: 'unconfigured', profile: name };
  };

  return follow(profile, false);
}

/** Settings any one of which makes the SDK resolve a profile through SSO. */
const SSO_SETTINGS = [
  'sso_session',
  'sso_start_url',
  'sso_account_id',
  'sso_region',
  'sso_role_name',
] as const;

/**
 * Read a file through the port, treating one that cannot be read - absent,
 * a directory, unreadable - as empty, as the SDK does. Exported credentials
 * and the default chain must keep working when `~/.aws` is unusable.
 */
async function readOptional(fs: FileSystem, path: string): Promise<string> {
  try {
    return await fs.readText(path);
  } catch {
    return '';
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
    signIn: (name) => readProfileStyle(configText, credentialsText, name),
  };
}
