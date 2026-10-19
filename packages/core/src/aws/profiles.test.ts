import { describe, expect, it } from 'vitest';

import { createMemoryFileSystem } from '../adapters/memory-fs.js';
import type { FileSystem } from '../ports.js';
import { collectProfiles, profileFiles, readAwsProfiles, readProfileStyle } from './profiles.js';

const SSO_CONFIG = `[profile acme-prod]
sso_session = acme
region = eu-west-1

[sso-session acme]
sso_start_url = https://acme.awsapps.com/start/#
sso_region = eu-west-1
`;

const LOGIN_CONFIG = `[profile console]
login_session = arn:aws:signin:::devtools/same-device
region = us-east-1
`;

const STATIC_CONFIG = `[profile keys]
aws_access_key_id = AKIAEXAMPLE
aws_secret_access_key = secret
`;

const PROCESS_CONFIG = `[profile deployed]
credential_process = /usr/local/bin/get-creds --profile deployed
`;

describe('collectProfiles', () => {
  const config = [
    '# ~/.aws/config',
    '[default]',
    'region = us-west-1',
    '',
    '[profile acme-prod]',
    'sso_session = acme-prod-session',
    'region = us-east-2',
    '[sso-session acme-prod-session]',
    'sso_start_url = https://example.awsapps.com/start/#',
    '[profile playroom]',
    'region = us-east-1',
    '; a comment',
  ].join('\n');

  it('reads `[profile NAME]` from the config file and `[NAME]` from credentials', () => {
    const names = collectProfiles(config, '[work]\naws_access_key_id = AKIA\n');
    expect(names).toEqual(['default', 'acme-prod', 'playroom', 'work']);
  });

  it('puts default first and sorts the rest by code point', () => {
    expect(
      collectProfiles('[default]\na = 1\n', '[zeta]\na = 1\n[alpha]\na = 1\n[Beta]\na = 1\n'),
    ).toEqual(['default', 'Beta', 'alpha', 'zeta']);
    expect(collectProfiles('', '[zeta]\na = 1\n[alpha]\na = 1\n')).toEqual(['alpha', 'zeta']);
  });

  it('takes `[default]` from either file', () => {
    expect(collectProfiles('', '[default]\naws_access_key_id = AKIA\n')).toEqual(['default']);
  });

  it('de-duplicates names that appear in both files', () => {
    expect(collectProfiles('[profile shared]\na = 1\n', '[shared]\nb = 2\n')).toEqual(['shared']);
  });

  it('ignores comments, blank lines and config sections that are not profiles', () => {
    const names = collectProfiles(config, '# comment\n\n; comment\n');
    expect(names).not.toContain('sso-session acme-prod-session');
    expect(names).toEqual(['default', 'acme-prod', 'playroom']);
  });

  it('keeps names with dashes, dots and @, and drops names the SDK cannot read (spaces)', () => {
    expect(
      collectProfiles(
        '[profile my sso role]\na = 1\n[profile team.prod@acme]\na = 1\n',
        '[legacy-key]\na = 1\n[two words]\na = 1\n',
      ),
    ).toEqual(['legacy-key', 'team.prod@acme']);
  });

  it('does not count a section with no settings as a profile, as the SDK does not', () => {
    expect(collectProfiles('[profile empty]\n# nothing\n', '[blank]\n')).toEqual([]);
  });

  it('strips inline comments after whitespace, from headers and values', () => {
    const commented = '[profile prod] # production\nsso_session = corp ; the corp portal\n';
    expect(collectProfiles(commented, '')).toEqual(['prod']);
    expect(readProfileStyle(commented, '', 'prod').style).toBe('sso');
    expect(
      readProfileStyle('[profile p]\ncredential_process = /bin/creds#1\n', '', 'p').detail,
    ).toBe('/bin/creds#1');
  });

  it('reads quoted profile names without their quotes', () => {
    expect(collectProfiles('[profile "prod"]\na = 1\n[profile \'dev\']\na = 1\n', '')).toEqual([
      'dev',
      'prod',
    ]);
  });

  it('ignores the settings under a header it cannot read, rather than giving them to the previous profile', () => {
    const unreadable = '[default]\nregion = us-east-1\n[profile two words]\nsso_session = s\n';
    expect(readProfileStyle(unreadable, '', 'default').style).toBe('unconfigured');
  });

  it('returns an empty list for missing files', () => {
    expect(collectProfiles('', '')).toEqual([]);
  });
});

describe('readProfileStyle', () => {
  it('recognises SSO profiles, including through an sso-session', () => {
    expect(readProfileStyle(SSO_CONFIG, '', 'acme-prod')).toEqual({
      style: 'sso',
      profile: 'acme-prod',
    });
    expect(
      readProfileStyle('[default]\nsso_start_url = https://x.awsapps.com/start', '', 'default')
        .style,
    ).toBe('sso');
  });

  it('recognises console sign-in profiles', () => {
    expect(readProfileStyle(LOGIN_CONFIG, '', 'console').style).toBe('login');
  });

  it('recognises static keys, in config or in the credentials file', () => {
    expect(readProfileStyle(STATIC_CONFIG, '', 'keys').style).toBe('static');
    expect(
      readProfileStyle(
        '',
        '[other]\naws_access_key_id = AKIA\naws_secret_access_key = s\n',
        'other',
      ).style,
    ).toBe('static');
  });

  it('merges a profile split across both files', () => {
    expect(
      readProfileStyle(
        '[profile split]\naws_secret_access_key = s\n',
        '[split]\naws_access_key_id = A\n',
        'split',
      ).style,
    ).toBe('static');
  });

  it('recognises credential_process profiles, carrying the command', () => {
    expect(readProfileStyle(PROCESS_CONFIG, '', 'deployed')).toEqual({
      style: 'process',
      profile: 'deployed',
      detail: '/usr/local/bin/get-creds --profile deployed',
    });
  });

  it('follows source_profile to the source profile style', () => {
    const config = `${SSO_CONFIG}
[profile deploy]
role_arn = arn:aws:iam::123456789012:role/Deploy
source_profile = hop

[profile hop]
role_arn = arn:aws:iam::123456789012:role/Hop
source_profile = acme-prod
`;
    expect(readProfileStyle(config, '', 'deploy')).toEqual({ style: 'sso', profile: 'acme-prod' });
  });

  it('resolves a source_profile cycle to unconfigured', () => {
    const config = `[profile a]
role_arn = arn:aws:iam::123456789012:role/A
source_profile = b
[profile b]
role_arn = arn:aws:iam::123456789012:role/B
source_profile = a
`;
    expect(readProfileStyle(config, '', 'a').style).toBe('unconfigured');
  });

  it('reports a role with a credential_source as external', () => {
    const config = `[profile ec2]
role_arn = arn:aws:iam::123456789012:role/Deploy
credential_source = Ec2InstanceMetadata
`;
    expect(readProfileStyle(config, '', 'ec2')).toEqual({
      style: 'external',
      profile: 'ec2',
      detail: 'Ec2InstanceMetadata',
    });
  });

  it('reports a role that needs an MFA code as mfa, ahead of its source', () => {
    const config = `${STATIC_CONFIG}
[profile admin]
role_arn = arn:aws:iam::123456789012:role/Admin
source_profile = keys
mfa_serial = arn:aws:iam::123456789012:mfa/ant
`;
    expect(readProfileStyle(config, '', 'admin')).toEqual({
      style: 'mfa',
      profile: 'admin',
      detail: 'arn:aws:iam::123456789012:mfa/ant',
    });
  });

  it('recognises web identity profiles, carrying the token file', () => {
    const config = `[profile ci]
role_arn = arn:aws:iam::123456789012:role/Ci
web_identity_token_file = /var/run/token
`;
    expect(readProfileStyle(config, '', 'ci')).toEqual({
      style: 'web-identity',
      profile: 'ci',
      detail: '/var/run/token',
    });
  });

  it('reports a source profile with only a credential_source as external', () => {
    const config = `[profile deploy]
role_arn = arn:aws:iam::123456789012:role/Deploy
source_profile = host

[profile host]
credential_source = EcsContainer
`;
    expect(readProfileStyle(config, '', 'deploy')).toEqual({
      style: 'external',
      profile: 'host',
      detail: 'EcsContainer',
    });
    expect(readProfileStyle(config, '', 'host').style).toBe('unconfigured');
  });

  it('checks a role before keys, and keys only as a pair, as the SDK does', () => {
    const mixed = `${SSO_CONFIG}
[profile mixed]
aws_access_key_id = A
aws_secret_access_key = s
role_arn = arn:aws:iam::123456789012:role/Deploy
source_profile = acme-prod
`;
    expect(readProfileStyle(mixed, '', 'mixed').style).toBe('sso');
    expect(readProfileStyle('[default]\naws_access_key_id = A\n', '', 'default').style).toBe(
      'unconfigured',
    );
  });

  it('reads any sso_* setting as SSO', () => {
    expect(
      readProfileStyle('[default]\nsso_account_id = 123456789012\n', '', 'default').style,
    ).toBe('sso');
  });

  it('reports unknown or empty profiles as unconfigured', () => {
    expect(readProfileStyle(SSO_CONFIG, '', 'nope').style).toBe('unconfigured');
    expect(readProfileStyle('[default]\nregion = us-west-1\n', '', 'default').style).toBe(
      'unconfigured',
    );
  });

  it('lets [profile default] replace [default] outright, as the SDK does', () => {
    const config = '[default]\nsso_session = s\n[profile default]\nregion = eu-west-2\n';
    expect(readProfileStyle(config, '', 'default').style).toBe('unconfigured');
  });

  it('keeps indented sub-section keys out of the profile settings', () => {
    const config = '[profile p]\ns3 =\n  aws_access_key_id = nested\nregion = eu-west-2\n';
    expect(readProfileStyle(config, '', 'p').style).toBe('unconfigured');
  });

  it('does not read a bare `[name]` config section as a profile', () => {
    expect(readProfileStyle('[keys]\naws_access_key_id = A\n', '', 'keys').style).toBe(
      'unconfigured',
    );
  });
});

describe('profileFiles', () => {
  it('defaults to ~/.aws/config and ~/.aws/credentials', () => {
    expect(profileFiles({}, '/home/ant')).toEqual({
      configFile: '/home/ant/.aws/config',
      credentialsFile: '/home/ant/.aws/credentials',
    });
  });

  it('honours AWS_CONFIG_FILE and AWS_SHARED_CREDENTIALS_FILE, expanding ~', () => {
    expect(
      profileFiles(
        { AWS_CONFIG_FILE: '/etc/aws/config', AWS_SHARED_CREDENTIALS_FILE: '~/creds' },
        '/home/ant',
      ),
    ).toEqual({ configFile: '/etc/aws/config', credentialsFile: '/home/ant/creds' });
  });

  it('treats blank overrides as unset', () => {
    expect(profileFiles({ AWS_CONFIG_FILE: '  ' }, '/h').configFile).toBe('/h/.aws/config');
  });
});

describe('readAwsProfiles', () => {
  it('reads both files through the FileSystem port', async () => {
    const fs = createMemoryFileSystem({
      '/home/ant/.aws/config': `[default]\nsso_session = x\n${PROCESS_CONFIG}`,
      '/home/ant/.aws/credentials': '[keys]\naws_access_key_id = A\naws_secret_access_key = s\n',
    });
    const profiles = await readAwsProfiles(fs, {}, '/home/ant');
    expect(profiles.names).toEqual(['default', 'deployed', 'keys']);
    expect(profiles.has('keys')).toBe(true);
    expect(profiles.has('missing')).toBe(false);
    expect(profiles.signIn('keys').style).toBe('static');
  });

  it('reads a file that cannot be read as empty, as the SDK does', async () => {
    const fs: FileSystem = {
      ...createMemoryFileSystem(),
      readText: (path) => Promise.reject(new Error(`EISDIR: illegal operation on ${path}`)),
    };
    const profiles = await readAwsProfiles(fs, {}, '/h');
    expect(profiles.names).toEqual([]);
    expect(profiles.signIn('default').style).toBe('unconfigured');
  });

  it('reads missing files as empty', async () => {
    const profiles = await readAwsProfiles(createMemoryFileSystem(), {}, '/h');
    expect(profiles.names).toEqual([]);
    expect(profiles.signIn('default').style).toBe('unconfigured');
  });

  it('reads the files the environment overrides name', async () => {
    const fs = createMemoryFileSystem({
      '/alt/config': '[profile alt]\nsso_session = x\n',
      '/alt/credentials': '[other]\naws_access_key_id = A\n',
    });
    const env = { AWS_CONFIG_FILE: '/alt/config', AWS_SHARED_CREDENTIALS_FILE: '/alt/credentials' };
    expect((await readAwsProfiles(fs, env, '/h')).names).toEqual(['alt', 'other']);
  });
});
