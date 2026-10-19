import { describe, expect, it } from 'vitest';

import { assertAccountPin, shortIdentity, type CallerIdentity } from './identity.js';

const IDENTITY: CallerIdentity = {
  account: '210987654321',
  arn: 'arn:aws:sts::210987654321:assumed-role/AdminRole/ant',
  userId: 'AROAEXAMPLE:ant',
};

const CHECK = {
  override: false,
  pinSource: 'config/production.jsonc',
  credentialsDescription: 'AdminRole, profile "personal" from AWS_PROFILE',
};

describe('shortIdentity', () => {
  it('names the role of an assumed role, dropping the session name', () => {
    expect(shortIdentity(IDENTITY.arn)).toBe('AdminRole');
  });

  it('names an IAM user or role, dropping any IAM path', () => {
    expect(shortIdentity('arn:aws:iam::123456789012:user/ci')).toBe('ci');
    expect(shortIdentity('arn:aws:iam::123456789012:role/team/Deploy')).toBe('Deploy');
  });

  it('falls back to the last segment, then the ARN, then "unknown"', () => {
    expect(shortIdentity('arn:aws:iam::123456789012:root')).toBe('root');
    expect(shortIdentity('arn:aws:iam::123456789012:federated-user/x/y')).toBe('y');
    expect(shortIdentity('')).toBe('unknown');
  });
});

describe('assertAccountPin', () => {
  it('passes when no pin is configured', () => {
    expect(assertAccountPin(undefined, IDENTITY, CHECK)).toBe('unset');
  });

  it('passes when the accounts match', () => {
    expect(assertAccountPin('210987654321', IDENTITY, CHECK)).toBe('matched');
  });

  it('refuses another account, naming the pin source, both accounts and the credentials', () => {
    expect(() => assertAccountPin('123456789012', IDENTITY, CHECK)).toThrow(
      'config/production.jsonc pins AWS account 123456789012, but the credentials in use\n' +
        'belong to 210987654321 (AdminRole, profile "personal" from AWS_PROFILE).\n' +
        'Switch credentials with --profile, or change aws.accountId.',
    );
  });

  it('skips a mismatching pin under an endpoint override', () => {
    expect(assertAccountPin('123456789012', IDENTITY, { ...CHECK, override: true })).toBe(
      'skipped',
    );
  });
});
