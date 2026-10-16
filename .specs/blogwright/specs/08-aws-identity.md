# AWS profiles, caller identity and account pinning

**Status:** Implemented · **Date:** 2026-10-16 · **Owner:** Ant Stanley · **Scope:** blogwright product

Read first: [overview](00-overview.md), [domain model](01-domain-model.md) and [development guidelines](../../../DEVELOPMENT.md).

## Responsibilities

Before any state is loaded, the composition root decides which AWS
credentials an invocation uses, confirms they work, and records whose they
are. [aws-session.ts](../../../packages/cli/src/aws-session.ts) owns
`resolveAwsProfile`, `resolveAwsSession` and the login offer.
[core aws/profiles.ts](../../../packages/core/src/aws/profiles.ts) owns
shared-file discovery and parsing.
[core aws/identity.ts](../../../packages/core/src/aws/identity.ts) owns
`CallerIdentity`, `shortIdentity` and `assertAccountPin`. `createContext`,
`whoami` and `init` are the three callers of `resolveAwsSession`.

## Config block

An environment's config may carry an `aws` block, validated by
`mergeConfig` as site-owned config:

| Key | Validation | Meaning |
|---|---|---|
| `profile` | Optional nonblank string | Named profile for this environment; row 4 of profile resolution |
| `accountId` | Optional string of exactly 12 digits | The only account this environment's commands accept |

The block is optional and has no defaults; `OpsConfig.aws` stays undefined
when it is absent. A non-object block, an unknown key, a blank `profile`, or
an `accountId` that is not a 12-digit string is refused with a message
naming the key. A numeric `accountId` is refused with "quote it", because
a number drops leading zeros.

There is no flag or environment variable that bypasses the pin. Deploying
to another account means changing the credentials or `aws.accountId`.

## Profile resolution

`resolveAwsProfile({ flag, processEnv, config })` is pure. It returns
`ResolvedAwsProfile = { name: string | null; source }`. The first matching
row wins. Every value is trimmed, and a blank value counts as absent.

| # | Source | `source` | Matches when |
|---|---|---|---|
| 1 | `--profile <name>` | `flag` | the flag is given |
| 2 | `AWS_PROFILE` | `env` | the variable is set |
| 3 | Ambient environment credentials | `env-keys` | `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are both set, or `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` or `AWS_CONTAINER_CREDENTIALS_FULL_URI` is set |
| 4 | `aws.profile` in the env config | `config` | the key is set |
| 5 | none | `default` | always |

Rows 3 and 5 return `name: null`. When row 3 wins while the config names a
profile, one info line says so: `ignoring aws.profile "<name>": environment
credentials are set`.

A named profile (rows 1, 2 and 4) must appear in the shared AWS files
before any AWS call is made. Otherwise the command fails like this:

```text
AWS profile "mysite-prod" not found (from config/production.jsonc)
available: default, mysite-dev, personal
```

The parenthetical names the source: `--profile`, `AWS_PROFILE`, or the
config path. Under an endpoint override a missing profile is not an error:
the info line `profile "<name>" not found - using emulator credentials` is
logged and the profile resolves to `name: null`, so the emulator fallback
below applies.

## Shared AWS files

The config file is `AWS_CONFIG_FILE`, or `~/.aws/config` when that is unset.
The credentials file is `AWS_SHARED_CREDENTIALS_FILE`, or
`~/.aws/credentials` when that is unset. Both are read through the
`FileSystem` port, and a missing file reads as empty. The config file
contributes `[default]` and `[profile <name>]` sections, and other section
kinds (for example `[sso-session x]`) are ignored. The credentials file
contributes `[<name>]` sections. The profile list is de-duplicated, with
`default` first and the rest in code-point order. Each profile has a
sign-in style:

- `sso`: `sso_session` or `sso_start_url`.
- `login`: `login_session`.
- `process`: `credential_process`.
- `static`: `aws_access_key_id`.
- `role` + `source_profile`: the style of the source profile, followed
  recursively. A cycle resolves to `unconfigured`.
- `external`: `role_arn` with `credential_source` (environment, instance
  or container credentials).
- `unconfigured`: none of these, or the profile is absent.

They are checked in that order. The style of a null profile is the style of
the `default` profile.

## Credential provider

`createCredentialProvider({ override, profile })` builds one of two
providers. With a profile name, it uses `fromIni({ profile })`, which
resolves SSO, `login_session`, `credential_process`, `source_profile` and
role assumption exactly as the AWS CLI does. Environment keys are never
consulted on this path. Without a name, it uses `fromNodeProviderChain()`,
as before. Either provider is memoized until its credentials expire: the
chain memoizes itself, and the `fromIni` provider is wrapped in core's own
expiry-aware memoizer, which refreshes credentials within five minutes of
their expiry and never caches a failure. The existing emulator fallback
applies to both: when `override` is true and resolution fails, the provider
returns `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from the
environment, each falling back to `test`. Any other resolution failure is
raised as core's `AwsCredentialsError`, keeping the SDK error as `cause`, so
the CLI can tell a provider failure from a rejected request without reading
vendor error types.

`createClients` accepts `profile` and exposes the provider it built as
`AwsClients.credentials`. An `endpointOverride` key that is present, even
as `undefined`, is the caller's decision; only an omitted key falls back to
`AWS_ENDPOINT_URL`, so the session's own override resolution is final. Every local AWS caller signs through that one
provider, including plugin-local clients and the analytics DuckDB secret.

## Identity and the account pin

`StsClient.getCallerIdentity()` returns
`CallerIdentity = { account, arn, userId }`. `getAccountId()` is a wrapper
that returns `account`. `resolveAwsSession` runs these steps in order:

1. Resolve the profile.
2. Check that a named profile exists.
3. `createClients({ region, endpointOverride, profile })`.
4. `getCallerIdentity()`. A credential failure goes to the login offer.
5. `assertAccountPin(config.aws?.accountId, identity, { override, pinSource, credentialsDescription })`,
   which returns the pin status (`matched`, `unset` or `skipped`) the identity
   line and `whoami` report.

`createContext` then derives names and loads state as before.
`OpsContext.accountId` equals `identity.account`.

`assertAccountPin` passes when no pin is configured or the accounts match.
It skips the check when an endpoint override is in effect, and the session
logs `account pin skipped: endpoint override`. Otherwise it throws:

```text
config/production.jsonc pins AWS account 123456789012, but the credentials in use
belong to 210987654321 (AdminRole, profile "personal" from AWS_PROFILE).
Switch credentials with --profile, or change aws.accountId.
```

Because this check comes before `StateStore.load`, a mismatched account
never reads or creates the state bucket.

Each context-building command then emits one identity line:

```text
aws  123456789012 · AdminRole · profile mysite-prod (config) · pinned
```

The last field is `pinned`, `unpinned`, or `pin skipped`. A null profile
shows as `environment credentials` or `default credentials`.
`shortIdentity(arn)` returns the role or user name, and drops the session
name of an assumed role and the IAM path of a role or user. When `terminal.isInteractive` is true the line
goes through `logger.info`. Otherwise (`--plain`, piped output or CI) it is
written with `terminal.error` to stderr, so the non-interactive stdout of
`history` and `status` stays byte-identical.

## Login offer

`getCallerIdentity` failures are classified as either credential failures
or other failures. A credential failure is one of these:

- an error thrown by the credential provider;
- an STS error code of `ExpiredToken`, `ExpiredTokenException`,
  `InvalidClientTokenId`, `UnrecognizedClientException` or
  `SignatureDoesNotMatch`.

Other failures, such as network, endpoint or region errors, propagate
unchanged.

Blogwright offers a login only when all of the following hold:

- the terminal is interactive;
- there is no endpoint override;
- the profile source is not `env-keys`;
- the profile's style (after following `source_profile`) is `sso`,
  `login` or `unconfigured`.

The prompt always offers both sign-in commands, with the one that matches
the profile's style as the default:

```text
AWS credentials for profile "mysite-prod" are not usable:
  The SSO session associated with this profile has expired.
How do you want to sign in?
  1) aws sso login --profile mysite-prod    (profile uses IAM Identity Center)
  2) aws login --profile mysite-prod        (AWS console credentials)
  3) cancel
choice [1]:
```

The `sso` style defaults to option 1. The `login` and `unconfigured` styles
default to option 2. For a null profile, `--profile` is omitted. On a
headless host, `aws sso login` gains `--use-device-code` and `aws login`
gains `--remote`. A host is headless when any of these is true:

- `BLOGWRIGHT_HEADLESS=1`;
- `SSH_CONNECTION` or `SSH_TTY` is set;
- on Linux, neither `DISPLAY` nor `WAYLAND_DISPLAY` is set.

`BLOGWRIGHT_HEADLESS=0` forces the browser flow.

The chosen command runs through the `AwsLogin` port with the terminal
attached, after the live status line is cleared. If it exits 0, Blogwright
rebuilds the clients and retries `getCallerIdentity` once. A second failure
is reported and is not offered again. If `aws` is not on the `PATH`, the
error says to install AWS CLI v2. A non-zero exit is reported with the
command and its code. Cancel exits 1 with the original failure.

When no offer applies, the error carries one line of guidance and the exit
code is 1:

- non-interactive with an `sso`, `login` or `unconfigured` profile: the
  matching command(s);
- `static` profile: `aws configure --profile <name>`;
- `process` profile: the profile's `credential_process`;
- `external` profile: the role's `credential_source`;
- `env-keys` source: refresh the exported credentials.

## `whoami`

`blogwright whoami [env]` accepts `--env`, `--config`, `--profile` and
`--endpoint`. It runs `resolveAwsSession` and loads no state. With a
config, it uses `config.region` and `aws.*`. Without one (no candidate file
exists, or the working directory is outside any repository, which
`findRepoRoot` reports by throwing), it signs STS in `us-east-1` and reports
no pin. An explicit `--config` that does not exist is still an error. It prints fixed keys to stdout, and the
plain form is the same text without colour:

```text
account   123456789012
identity  AdminRole
arn       arn:aws:sts::123456789012:assumed-role/AdminRole/ant
profile   mysite-prod (config)
env       production (config/production.jsonc)
region    eu-west-2
pin       matches aws.accountId
```

- `profile` shows `none (environment credentials)` or
  `none (default credentials)` when no profile is named.
- `env` shows `production (no config found)` when there is no config, and
  `production (outside a repository)` when there is no repo root.
- `pin` is one of `matches aws.accountId`, `not set`, or
  `skipped (endpoint override)`.

The command exits 0 when the identity resolves and the pin matches or is
absent. It exits 1 for a missing profile, unusable credentials, or a pin
mismatch, which is printed to stderr as in
[Identity and the account pin](#identity-and-the-account-pin). `whoami` is
dispatched before the `makeContext` call, beside `init` and `plugin`.

## `init` prompts

After the SSR question and any region re-ask it triggers, so the region is
final, `initSite` asks for a profile, but only when the shared files define
at least one:

```text
AWS profile for this environment (blank for default credentials) [mysite-prod]:
```

The default is `--profile`, then `AWS_PROFILE`, then blank. A nonblank
answer must be a listed profile.

It then asks, whether or not the profile question was asked (exported
credentials need no profile), `Detect the AWS account and pin it to this config? [Y/n]`.
Yes runs `resolveAwsSession` with the answer as the `flag` row (blank
answers fall through to the remaining rows), the final region, and no
endpoint override, including the login offer.
When that succeeds, it reports the identity and pins the account. When it
fails or the operator cancels, `init` warns `account not pinned - add
aws.accountId later` and carries on. An AWS failure never fails `init`.
The rendered config gains this block only when there is something to
write, in `renderConfig`'s style (a comma between entries, none after the
last, the comment after any comma; the block's own trailing comma depends
on its position in the file):

```jsonc
  "aws": {
    "profile": "mysite-prod",
    "accountId": "123456789012" // deploys refuse credentials for any other account
  }
```

## Implementation layout

| Concern | Module |
|---|---|
| Shared-file paths, profile list, sign-in style | `packages/core/src/aws/profiles.ts` |
| `CallerIdentity`, `shortIdentity`, `assertAccountPin` | `packages/core/src/aws/identity.ts` |
| `getCallerIdentity` | `packages/core/src/aws/sts.ts` |
| Profile-aware provider | `packages/core/src/aws/credentials.ts` |
| `aws` config block validation | `packages/core/src/config.ts` |
| Precedence, session, failure classification, login offer, headless detection | `packages/cli/src/aws-session.ts` |
| `AwsLogin` port and process adapter | `packages/cli/src/ports.ts`, `packages/cli/src/adapters/process-aws-login.ts` |
| `whoami` | `packages/cli/src/whoami.ts` |
| `AwsHost` (environment, home, platform, client factory) and its real values | `packages/cli/src/aws-session.ts`, `createAwsHost` in `packages/cli/src/context.ts` |
| `AwsAccessFactory`, `main`'s sixth parameter, built in `bin.ts` for `whoami` and `init` | `packages/cli/src/cli.ts` |

`whoami` and `init` run before any `OpsContext` exists, so they cannot take
`awsLogin` from `Ports`. The composition root hands them an `AwsAccess`
(`AwsHost` plus `AwsLogin`) through `main`'s `AwsAccessFactory`, the same
way `PackageManagerFactory` reaches `plugin add`. `createContext` reads the
same host from `ContextOptions` (`processEnv`, `home`, `createClients`),
defaulting to `process.env`, `os.homedir()` and core's `createClients`.

## Assumptions and open questions

**Assumptions**

- AWS CLI v2 is installed wherever the operator expects a login offer. `aws login` needs AWS CLI v2 with console-credential sign-in. `--use-device-code` needs 2.22.0 or later.
- `fromIni` in the SDK pinned by core resolves `sso_session`, `login_session`, `credential_process` and role chains the same way the AWS CLI does.

**Decisions**

- *Precedence.* **Exported environment credentials beat the config's profile; a flag or `AWS_PROFILE` beats both.** CI exports keys and has no profiles, so a committed `aws.profile` must not break it. An explicit operator choice still wins, and the pin catches stale exported keys.
- *Provider choice.* **`fromIni` for a named profile instead of `fromNodeProviderChain({ profile })`.** The chain currently skips environment keys when a profile is set, but its own warning says a future version may prefer environment keys. Calling `fromIni` makes the resolved profile authoritative and silences that warning.
- *Pin placement.* **Checked before `StateStore.load`.** The bucket name contains the account id, so any later check would already have read, or bootstrap created, state in the wrong account.
- *Login choice.* **Always offer both commands, defaulting by profile style.** The operator knows how they sign in better than a heuristic does. A wrong pick fails in the AWS CLI with its own message, and nothing is changed.
- *Headless flags.* **`--use-device-code` for `aws sso login`, `--remote` for `aws login`.** These are the browserless flags each command documents. `aws sso login` has no `--remote` option.
- *Identity line off a TTY.* **Routed on `terminal.isInteractive`, not on `--plain`.** A piped run without `--plain` is non-interactive but not plain; routing on interactivity keeps every non-interactive stdout of `history` and `status` unchanged while CI logs keep the account on stderr.
- *No pin override.* **None.** A bypass flag would be the one thing an operator reaches for when the pin is doing its job.
- *Emulator runs.* **Missing profiles are dropped, not refused.** A committed `aws.profile` must not break floci runs on machines that do not have it; the emulator never checks credentials.
- *Role chains.* **Follow `source_profile` for the sign-in style.** The login that repairs a role chain is the login of its source profile.
- *`--profile` and plugins.* **Not forwarded into plugin `args`.** Like `plain`, it is session-level: the host consumes it to build the context, and a plugin sees its effect through `ctx.clients`.
- *Region.* **Never taken from the profile.** The deploy region belongs to the stack, not to whoever deploys it.
- *Memoizer.* **Core's own, not `@smithy/property-provider`.** That package is no longer in the SDK's dependency tree (its exports moved into `@smithy/core`), and a dozen lines in `credentials.ts` avoid a new dependency for one function.
- *Pin question in `init`.* **Asked even when no profiles are defined.** Exported environment credentials (or a default chain without files) can still be detected and pinned.

**Open questions**

(None at this stage.)
