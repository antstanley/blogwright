/**
 * Whose AWS credentials are in use, and whether that account is the one an
 * environment's config pins. The pin is checked before any state is loaded:
 * the state bucket name carries the account id, so a later check would
 * already have read, or bootstrap created, state in the wrong account.
 */

/** The answer to `sts:GetCallerIdentity`. */
export interface CallerIdentity {
  /** 12-digit account id. */
  account: string;
  arn: string;
  userId: string;
}

/**
 * How {@link assertAccountPin} settled: the identity matches the pin, no pin
 * is configured, or the check was skipped because an emulator endpoint is in
 * use (an emulator answers with its own fixed account).
 */
export type AccountPinStatus = 'matched' | 'unset' | 'skipped';

/**
 * The role or user name in an STS ARN - `AdminRole` for
 * `arn:aws:sts::123456789012:assumed-role/AdminRole/ant` (the session name is
 * dropped), `ci` for `arn:aws:iam::123456789012:user/ci` (an IAM path is dropped too).
 * Otherwise the last path segment, and `unknown` for an empty ARN.
 */
export function shortIdentity(arn: string): string {
  if (arn.length === 0) return 'unknown';
  const resource = arn.split(':').at(-1) ?? arn;
  const parts = resource.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return arn;
  const [kind, name] = parts;
  if (kind === 'assumed-role' && name !== undefined) return name;
  return parts.at(-1) ?? arn;
}

export interface AccountPinCheck {
  /** True when an endpoint override (emulator) is in effect. */
  override: boolean;
  /** Where the pin was read from, for the refusal - normally the config file path. */
  pinSource: string;
  /** Who the credentials are, for the refusal - e.g. `AdminRole, profile "x" from AWS_PROFILE`. */
  credentialsDescription: string;
}

/**
 * Refuse credentials for any account other than the pinned one. Passes when
 * no pin is configured or the accounts match, and skips the comparison under
 * an endpoint override. There is deliberately no bypass: deploying to another
 * account means changing the credentials or the pin.
 */
export function assertAccountPin(
  pin: string | undefined,
  identity: CallerIdentity,
  check: AccountPinCheck,
): AccountPinStatus {
  if (pin === undefined) return 'unset';
  if (check.override) return 'skipped';
  if (identity.account === pin) return 'matched';
  throw new Error(
    `${check.pinSource} pins AWS account ${pin}, but the credentials in use\n` +
      `belong to ${identity.account} (${check.credentialsDescription}).\n` +
      'Switch credentials with --profile, or change aws.accountId.',
  );
}
