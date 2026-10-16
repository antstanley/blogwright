# Change: AWS profiles, account detection and account pinning

**Status:** Merged · **Date:** 2026-10-16 · **Merged:** 2026-10-16 · **Owner:** Ant Stanley · **Target:** CLI composition root, core credentials and config, `init`, analytics credential wiring

Let an operator choose which AWS credentials Blogwright uses, and make
Blogwright check which account those credentials belong to before it touches
anything. A named profile comes from a new global `--profile` flag, from
`AWS_PROFILE`, or from a new `aws.profile` key in the environment's config
file. Credentials exported into the environment (as CI exports them) take
precedence over the config's profile. Every context-building command calls
`sts:GetCallerIdentity`, prints one identity line, and, when the config pins
`aws.accountId`, refuses to continue if the credentials belong to a
different account. When credentials are expired or missing, an interactive
session offers to run `aws sso login` or `aws login`. The operator picks
which, and Blogwright retries once. A new `blogwright whoami` command reports
the resolved profile, identity and pin without loading state. `blogwright
init` asks for a profile and offers to detect and pin the account.

---

## Motivation

The state bucket name is `<env>-<siteName>-<accountId>`
([`deriveNames`](../../../packages/core/src/config.ts)), and the account id comes
from whatever credentials happen to be ambient. Credentials for the wrong
account therefore do not fail. They find no state, so `status` reports
nothing deployed and `bootstrap` builds a second, complete stack in the wrong
account. Nothing in the product today tells the operator which account a
command ran against. The only way to choose a profile is to export
`AWS_PROFILE` by hand before every command.

The sibling `watch-tail` project solved the same operator problem. It
offers `--profile`, reads profiles from the shared AWS files, uses
`GetCallerIdentity` as its credential check, and shows a login advisor that
maps a failure and the profile's sign-in style to the command that fixes it.
This change adopts those parts and adds the one thing a deploy tool needs and
a log viewer does not: a pinned account that a deploy refuses to leave.

---

## What this change does not do

- **No region from the profile.** `config.region` stays the only source of
  the deploy region. A profile's `region` setting is never read for signing,
  because the region is where the stack lives, not a property of the operator.
  (watch-tail deliberately does the opposite.)
- **No per-command profile picker.** Ordinary commands never ask which
  profile to use. Deploys stay deterministic, and only `init` asks.
- **No pin override.** There is no `--account` flag or similar escape hatch.
  To deploy to another account, the operator changes the config or the
  credentials.
- **No pin, no profile check and no login offer against an emulator.** With
  an endpoint override (`--endpoint` or `AWS_ENDPOINT_URL`), the account check
  is skipped, a named profile missing from the shared files is dropped rather
  than refused, and credential failures are reported as they are today.
- **No login offer** in non-interactive sessions (including `--plain` and
  piped output), for environment-key credentials, or for profiles whose
  credentials come from static keys, a `credential_process` or a role
  `credential_source`. Those cases print guidance and exit 1.
- **No writes to `~/.aws`** and no credential storage of Blogwright's own.
  The AWS CLI performs every sign-in.
- **No change to in-AWS credentials.** The builder MicroVM
  (`packages/build-agent`) and the analytics transform Lambda
  (`packages/analytics/src/transform/entry.ts`) keep resolving their
  execution-role credentials as they do today.
- **No JSON Schema change.** `aws` is site-owned config of the same kind as
  `microvm` and `paths`. `OpsConfig` is not modelled in
  `canonical-types.schema.json`.

---

## Affected spec pages

| Canonical page | Nature of change |
|---|---|
| Adds [`.specs/blogwright/specs/08-aws-identity.md`](../../blogwright/specs/08-aws-identity.md) | New page: profile resolution, credential provider, identity check, account pin, login offer, `whoami`, `init` prompts |
| [`.specs/blogwright/specs/00-overview.md`](../../blogwright/specs/00-overview.md) | Problem and goals, Detail pages, Scope summary, Assumptions and open questions |
| [`.specs/blogwright/specs/01-domain-model.md`](../../blogwright/specs/01-domain-model.md) | Relationships and lifecycle (the state bucket's account id is verified first; the `aws` block), Assumptions and open questions |
| [`.specs/blogwright/specs/02-plugin-architecture.md`](../../blogwright/specs/02-plugin-architecture.md) | PluginContext (`clients.credentials`), Discovery (reserved `whoami`), Invocation, management and init (`--profile`, the `awsLogin` port), Plugin AWS service seam |
| [`.specs/blogwright/specs/04-analytics.md`](../../blogwright/specs/04-analytics.md) | DuckDB credentials come from the host's provider, not a provider of their own |
| [`.specs/blogwright/README.md`](../../blogwright/README.md) | Index the new `08` page |
| [`.specs/README.md`](../../README.md) | Index the new page; move this change spec to merged |
| [`DEVELOPMENT.md`](../../../DEVELOPMENT.md) | Repo hygiene: where local AWS credentials come from |

---

## Proposed changes

### Adds `.specs/blogwright/specs/08-aws-identity.md`

The new page has this header and closing block, with the sections below
between them.

> # AWS profiles, caller identity and account pinning
>
> **Status:** Implemented · **Date:** <merge date> · **Owner:** Ant Stanley · **Scope:** blogwright product
>
> Read first: [overview](00-overview.md), [domain model](01-domain-model.md) and [development guidelines](../../../DEVELOPMENT.md).

#### Responsibilities

> Before any state is loaded, the composition root decides which AWS
> credentials an invocation uses, confirms they work, and records whose they
> are. [aws-session.ts](../../../packages/cli/src/aws-session.ts) owns
> `resolveAwsProfile`, `resolveAwsSession` and the login offer.
> [core aws/profiles.ts](../../../packages/core/src/aws/profiles.ts) owns
> shared-file discovery and parsing.
> [core aws/identity.ts](../../../packages/core/src/aws/identity.ts) owns
> `CallerIdentity`, `shortIdentity` and `assertAccountPin`. `createContext`,
> `whoami` and `init` are the three callers of `resolveAwsSession`.

#### Config block

> An environment's config may carry an `aws` block, validated by
> `mergeConfig` as site-owned config:
>
> | Key | Validation | Meaning |
> |---|---|---|
> | `profile` | Optional nonblank string | Named profile for this environment; row 4 of profile resolution |
> | `accountId` | Optional string of exactly 12 digits | The only account this environment's commands accept |
>
> The block is optional and has no defaults; `OpsConfig.aws` stays undefined
> when it is absent. A non-object block, an unknown key, a blank `profile`, or
> an `accountId` that is not a 12-digit string is refused with a message
> naming the key. A numeric `accountId` is refused with "quote it", because
> a number drops leading zeros.
>
> There is no flag or environment variable that bypasses the pin. Deploying
> to another account means changing the credentials or `aws.accountId`.

#### Profile resolution

> `resolveAwsProfile({ flag, processEnv, config })` is pure. It returns
> `ResolvedAwsProfile = { name: string | null; source }`. The first matching
> row wins. Every value is trimmed, and a blank value counts as absent.
>
> | # | Source | `source` | Matches when |
> |---|---|---|---|
> | 1 | `--profile <name>` | `flag` | the flag is given |
> | 2 | `AWS_PROFILE` | `env` | the variable is set |
> | 3 | Ambient environment credentials | `env-keys` | `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are both set, or `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` or `AWS_CONTAINER_CREDENTIALS_FULL_URI` is set |
> | 4 | `aws.profile` in the env config | `config` | the key is set |
> | 5 | none | `default` | always |
>
> Rows 3 and 5 return `name: null`. When row 3 wins while the config names a
> profile, one info line says so: `ignoring aws.profile "<name>": environment
> credentials are set`.
>
> A named profile (rows 1, 2 and 4) must appear in the shared AWS files
> before any AWS call is made. Otherwise the command fails like this:
>
> ```text
> AWS profile "mysite-prod" not found (from config/production.jsonc)
> available: default, mysite-dev, personal
> ```
>
> The parenthetical names the source: `--profile`, `AWS_PROFILE`, or the
> config path. Under an endpoint override a missing profile is not an error:
> the info line `profile "<name>" not found - using emulator credentials` is
> logged and the profile resolves to `name: null`, so the emulator fallback
> below applies.

#### Shared AWS files

> The config file is `AWS_CONFIG_FILE`, or `~/.aws/config` when that is unset.
> The credentials file is `AWS_SHARED_CREDENTIALS_FILE`, or
> `~/.aws/credentials` when that is unset. Both are read through the
> `FileSystem` port, and a missing file reads as empty. The config file
> contributes `[default]` and `[profile <name>]` sections, and other section
> kinds (for example `[sso-session x]`) are ignored. The credentials file
> contributes `[<name>]` sections. The profile list is de-duplicated, with
> `default` first and the rest in code-point order. Each profile has a
> sign-in style:
>
> - `sso`: `sso_session` or `sso_start_url`.
> - `login`: `login_session`.
> - `process`: `credential_process`.
> - `static`: `aws_access_key_id`.
> - `role` + `source_profile`: the style of the source profile, followed
>   recursively. A cycle resolves to `unconfigured`.
> - `external`: `role_arn` with `credential_source` (environment, instance
>   or container credentials).
> - `unconfigured`: none of these, or the profile is absent.
>
> They are checked in that order. The style of a null profile is the style of
> the `default` profile.

#### Credential provider

> `createCredentialProvider({ override, profile })` builds one of two
> providers. With a profile name, it uses `fromIni({ profile })`, which
> resolves SSO, `login_session`, `credential_process`, `source_profile` and
> role assumption exactly as the AWS CLI does. Environment keys are never
> consulted on this path. Without a name, it uses `fromNodeProviderChain()`,
> as before. Either provider is memoized until its credentials expire. The
> existing emulator fallback applies to both: when `override` is true and
> resolution fails, the provider returns `AWS_ACCESS_KEY_ID` and
> `AWS_SECRET_ACCESS_KEY` from the environment, each falling back to
> `test`.
>
> `createClients` accepts `profile` and exposes the provider it built as
> `AwsClients.credentials`. Every local AWS caller signs through that one
> provider, including plugin-local clients and the analytics DuckDB secret.

#### Identity and the account pin

> `StsClient.getCallerIdentity()` returns
> `CallerIdentity = { account, arn, userId }`. `getAccountId()` is a wrapper
> that returns `account`. `resolveAwsSession` runs these steps in order:
>
> 1. Resolve the profile.
> 2. Check that a named profile exists.
> 3. `createClients({ region, endpointOverride, profile })`.
> 4. `getCallerIdentity()`. A credential failure goes to the login offer.
> 5. `assertAccountPin(config.aws?.accountId, identity, { override })`.
>
> `createContext` then derives names and loads state as before.
> `OpsContext.accountId` equals `identity.account`.
>
> `assertAccountPin` passes when no pin is configured or the accounts match.
> It skips the check when an endpoint override is in effect, and logs
> `account pin skipped: endpoint override`. Otherwise it throws:
>
> ```text
> config/production.jsonc pins AWS account 123456789012, but the credentials in use
> belong to 210987654321 (AdminRole, profile "personal" from AWS_PROFILE).
> Switch credentials with --profile, or change aws.accountId.
> ```
>
> Because this check comes before `StateStore.load`, a mismatched account
> never reads or creates the state bucket.
>
> Each context-building command then emits one identity line:
>
> ```text
> aws  123456789012 · AdminRole · profile mysite-prod (config) · pinned
> ```
>
> The last field is `pinned`, `unpinned`, or `pin skipped`. A null profile
> shows as `environment credentials` or `default credentials`.
> `shortIdentity(arn)` returns the role or user name, and drops the session
> name of an assumed role. When `terminal.isInteractive` is true the line
> goes through `logger.info`. Otherwise (`--plain`, piped output or CI) it is
> written with `terminal.error` to stderr, so the non-interactive stdout of
> `history` and `status` stays byte-identical.

#### Login offer

> `getCallerIdentity` failures are classified as either credential failures
> or other failures. A credential failure is one of these:
>
> - an error thrown by the credential provider;
> - an STS error code of `ExpiredToken`, `ExpiredTokenException`,
>   `InvalidClientTokenId`, `UnrecognizedClientException` or
>   `SignatureDoesNotMatch`.
>
> Other failures, such as network, endpoint or region errors, propagate
> unchanged.
>
> Blogwright offers a login only when all of the following hold:
>
> - the terminal is interactive;
> - there is no endpoint override;
> - the profile source is not `env-keys`;
> - the profile's style (after following `source_profile`) is `sso`,
>   `login` or `unconfigured`.
>
> The prompt always offers both sign-in commands, with the one that matches
> the profile's style as the default:
>
> ```text
> AWS credentials for profile "mysite-prod" are not usable:
>   The SSO session associated with this profile has expired.
> How do you want to sign in?
>   1) aws sso login --profile mysite-prod    (profile uses IAM Identity Center)
>   2) aws login --profile mysite-prod        (AWS console credentials)
>   3) cancel
> choice [1]:
> ```
>
> The `sso` style defaults to option 1. The `login` and `unconfigured` styles
> default to option 2. For a null profile, `--profile` is omitted. On a
> headless host, `aws sso login` gains `--use-device-code` and `aws login`
> gains `--remote`. A host is headless when any of these is true:
>
> - `BLOGWRIGHT_HEADLESS=1`;
> - `SSH_CONNECTION` or `SSH_TTY` is set;
> - on Linux, neither `DISPLAY` nor `WAYLAND_DISPLAY` is set.
>
> `BLOGWRIGHT_HEADLESS=0` forces the browser flow.
>
> The chosen command runs through the `AwsLogin` port with the terminal
> attached, after the live status line is cleared. If it exits 0, Blogwright
> rebuilds the clients and retries `getCallerIdentity` once. A second failure
> is reported and is not offered again. If `aws` is not on the `PATH`, the
> error says to install AWS CLI v2. A non-zero exit is reported with the
> command and its code. Cancel exits 1 with the original failure.
>
> When no offer applies, the error carries one line of guidance and the exit
> code is 1:
>
> - non-interactive with an `sso`, `login` or `unconfigured` profile: the
>   matching command(s);
> - `static` profile: `aws configure --profile <name>`;
> - `process` profile: the profile's `credential_process`;
> - `external` profile: the role's `credential_source`;
> - `env-keys` source: refresh the exported credentials.

#### `whoami`

> `blogwright whoami [env]` accepts `--env`, `--config`, `--profile` and
> `--endpoint`. It runs `resolveAwsSession` and loads no state. With a
> config, it uses `config.region` and `aws.*`. Without one (no candidate file
> exists, or the working directory is outside any repository, which
> `findRepoRoot` reports by throwing), it signs STS in `us-east-1` and reports
> no pin. An explicit `--config` that does not exist is still an error. It prints fixed keys to stdout, and the
> plain form is the same text without colour:
>
> ```text
> account   123456789012
> identity  AdminRole
> arn       arn:aws:sts::123456789012:assumed-role/AdminRole/ant
> profile   mysite-prod (config)
> env       production (config/production.jsonc)
> region    eu-west-2
> pin       matches aws.accountId
> ```
>
> - `profile` shows `none (environment credentials)` or
>   `none (default credentials)` when no profile is named.
> - `env` shows `production (no config found)` when there is no config, and
>   `production (outside a repository)` when there is no repo root.
> - `pin` is one of `matches aws.accountId`, `not set`, or
>   `skipped (endpoint override)`.
>
> The command exits 0 when the identity resolves and the pin matches or is
> absent. It exits 1 for a missing profile, unusable credentials, or a pin
> mismatch, which is printed to stderr as in
> [Identity and the account pin](#identity-and-the-account-pin). `whoami` is
> dispatched before the `makeContext` call, beside `init` and `plugin`.

#### `init` prompts

> After the SSR question and any region re-ask it triggers, so the region is
> final, `initSite` asks for a profile, but only when the shared files define
> at least one:
>
> ```text
> AWS profile for this environment (blank for default credentials) [mysite-prod]:
> ```
>
> The default is `--profile`, then `AWS_PROFILE`, then blank. A nonblank
> answer must be a listed profile.
>
> It then asks `Detect the AWS account and pin it to this config? [Y/n]`.
> Yes runs `resolveAwsSession` with the answer as the `flag` row (blank
> answers fall through to the remaining rows), the final region, and no
> endpoint override, including the login offer.
> When that succeeds, it reports the identity and pins the account. When it
> fails or the operator cancels, `init` warns `account not pinned - add
> aws.accountId later` and carries on. An AWS failure never fails `init`.
> The rendered config gains this block only when there is something to
> write, in `renderConfig`'s style (a comma between entries, none after the
> last, the comment after any comma; the block's own trailing comma depends
> on its position in the file):
>
> ```jsonc
>   "aws": {
>     "profile": "mysite-prod",
>     "accountId": "123456789012" // deploys refuse credentials for any other account
>   }
> ```

#### Implementation layout

> | Concern | Module |
> |---|---|
> | Shared-file paths, profile list, sign-in style | `packages/core/src/aws/profiles.ts` |
> | `CallerIdentity`, `shortIdentity`, `assertAccountPin` | `packages/core/src/aws/identity.ts` |
> | `getCallerIdentity` | `packages/core/src/aws/sts.ts` |
> | Profile-aware provider | `packages/core/src/aws/credentials.ts` |
> | `aws` config block validation | `packages/core/src/config.ts` |
> | Precedence, session, failure classification, login offer, headless detection | `packages/cli/src/aws-session.ts` |
> | `AwsLogin` port and process adapter | `packages/cli/src/ports.ts`, `packages/cli/src/adapters/process-aws-login.ts` |
> | `whoami` | `packages/cli/src/whoami.ts` |

#### Closing block

> **Assumptions**
>
> - AWS CLI v2 is installed wherever the operator expects a login offer. `aws login` needs AWS CLI v2 with console-credential sign-in. `--use-device-code` needs 2.22.0 or later.
> - `fromIni` in the SDK pinned by core resolves `sso_session`, `login_session`, `credential_process` and role chains the same way the AWS CLI does.
>
> **Decisions**
>
> - *Precedence.* **Exported environment credentials beat the config's profile; a flag or `AWS_PROFILE` beats both.** CI exports keys and has no profiles, so a committed `aws.profile` must not break it. An explicit operator choice still wins, and the pin catches stale exported keys.
> - *Provider choice.* **`fromIni` for a named profile instead of `fromNodeProviderChain({ profile })`.** The chain currently skips environment keys when a profile is set, but its own warning says a future version may prefer environment keys. Calling `fromIni` makes the resolved profile authoritative and silences that warning.
> - *Pin placement.* **Checked before `StateStore.load`.** The bucket name contains the account id, so any later check would already have read, or bootstrap created, state in the wrong account.
> - *Login choice.* **Always offer both commands, defaulting by profile style.** The operator knows how they sign in better than a heuristic does. A wrong pick fails in the AWS CLI with its own message, and nothing is changed.
> - *Headless flags.* **`--use-device-code` for `aws sso login`, `--remote` for `aws login`.** These are the browserless flags each command documents. `aws sso login` has no `--remote` option.
> - *Identity line off a TTY.* **Routed on `terminal.isInteractive`, not on `--plain`.** A piped run without `--plain` is non-interactive but not plain; routing on interactivity keeps every non-interactive stdout of `history` and `status` unchanged while CI logs keep the account on stderr.
> - *No pin override.* **None.** A bypass flag would be the one thing an operator reaches for when the pin is doing its job.
> - *Emulator runs.* **Missing profiles are dropped, not refused.** A committed `aws.profile` must not break floci runs on machines that do not have it; the emulator never checks credentials.
> - *Role chains.* **Follow `source_profile` for the sign-in style.** The login that repairs a role chain is the login of its source profile.
> - *`--profile` and plugins.* **Not forwarded into plugin `args`.** Like `plain`, it is session-level: the host consumes it to build the context, and a plugin sees its effect through `ctx.clients`.
> - *Region.* **Never taken from the profile.** The deploy region belongs to the stack, not to whoever deploys it.
>
> **Open questions**
>
> (None at this stage.)

### `.specs/blogwright/specs/00-overview.md` → Problem and goals (Modify)

Append a paragraph:

> Every invocation that reaches AWS first resolves which credentials to use,
> from `--profile`, `AWS_PROFILE`, exported environment credentials, or the
> config's `aws.profile`. It then confirms whose they are with
> `sts:GetCallerIdentity`. An environment may pin `aws.accountId`, and a
> command refuses to run against any other account. Expired sign-ins are
> repaired interactively through `aws sso login` or `aws login`.

### `.specs/blogwright/specs/00-overview.md` → Detail pages (Add row)

> | [AWS identity](08-aws-identity.md) | Profile resolution, caller identity, account pin, login offer, `whoami` |

### `.specs/blogwright/specs/00-overview.md` → Scope summary (Add row)

> | AWS identity | `--profile`/`AWS_PROFILE`/env-credentials/`aws.profile` precedence, identity line on every context-building command, optional `aws.accountId` pin checked before state loads, interactive SSO/console login offer, `whoami` |

### `.specs/blogwright/specs/00-overview.md` → Assumptions and open questions (Modify)

Under **Assumptions**, replace the bullet "Installed packages are trusted
code; AWS services and the ambient credential provider remain external
dependencies." with:

> - Installed packages are trusted code. AWS services, the shared AWS config files and the AWS CLI (for sign-in) remain external dependencies.

### `.specs/blogwright/specs/01-domain-model.md` → Relationships and lifecycle (Modify)

Insert before the paragraph that starts "The site owns resource naming prefix":

> The account id in the state bucket name (`<env>-<siteName>-<accountId>`)
> comes from `sts:GetCallerIdentity` for the resolved credentials
> ([AWS identity](08-aws-identity.md)); every other derived name uses the
> `<env>-<siteName>` prefix alone. An environment's config document may carry
> an `aws` block (`profile`, `accountId`), validated by core as site-owned
> config like `ssr`. When it pins `aws.accountId`, a mismatch fails before
> `StateStore.load`, so the state bucket is never derived from, read in, or
> created in an unintended account.

### `.specs/blogwright/specs/01-domain-model.md` → Assumptions and open questions (Modify)

Under **Assumptions**, replace the bullet "Installed packages are trusted
code; AWS services and the ambient credential provider remain external
dependencies." with:

> - Installed packages are trusted code. AWS services, the shared AWS config files and the AWS CLI (for sign-in) remain external dependencies.

### `.specs/blogwright/specs/02-plugin-architecture.md` → PluginContext (Modify row)

> | `clients` | Required shared `AwsClients`, including primary `signing`, `signingUsEast1`, and `credentials` (the host's resolved provider, already bound to the selected profile) |

Append to the section:

> Plugin code that needs raw credentials (analytics's DuckDB S3 Tables
> secret) reads `ctx.clients.credentials`. It never constructs its own
> provider, so `--profile` reaches every local AWS call.

### `.specs/blogwright/specs/02-plugin-architecture.md` → Discovery (Modify)

> The reserved namespaces are init, bootstrap, deploy, rollback, delete,
> destroy, history, logs, status, preview, plugin and whoami.

### `.specs/blogwright/specs/02-plugin-architecture.md` → Invocation, management and init (Modify)

Append to the first paragraph:

> `--profile <name>` is global. It reaches `createContext`, `whoami` and
> `init` as the first row of profile resolution
> ([AWS identity](08-aws-identity.md)). Plugin dispatch and the
> answered-yes teardown of `plugin remove` build their context through the
> same path, so they get the same identity line, pin and login offer.

In the package-management paragraph, replace "`ModuleLoader` stays on CLI
Ports alongside fs, terminal, vcs and ping; plugin ports expose only
fs/terminal." with:

> `ModuleLoader` and `AwsLogin` stay on CLI Ports alongside fs, terminal,
> vcs and ping; plugin ports expose only fs/terminal. `AwsLogin`'s process
> adapter ([process-aws-login.ts](../../../packages/cli/src/adapters/process-aws-login.ts))
> runs `aws` with the terminal attached and reports a missing binary as
> `not-installed`.

Append to the init paragraph:

> First-run init also asks for an AWS profile and offers to detect and pin
> the account (`aws` block). Generic `<plugin> init` asks neither.

### `.specs/blogwright/specs/02-plugin-architecture.md` → Plugin AWS service seam (Modify)

Append:

> `AwsClients.credentials` is the same provider both signers hold, so a
> plugin-local client built over `signing` or `signingUsEast1` and a
> plugin-built raw-credential consumer resolve identical credentials.

### `.specs/blogwright/specs/04-analytics.md` → Dashboard, queries and ports (Modify)

In the paragraph on DuckDB adapters, replace "Credentials resolve through
core's provider chain and are explicitly supplied to DuckDB's secret;" with:

> Credentials come from the host's resolved provider
> (`ctx.clients.credentials`, bound to the selected profile; see
> [AWS identity](08-aws-identity.md)) and are explicitly supplied to DuckDB's
> secret;

### `.specs/blogwright/README.md` → page list (Add row)

Insert after the Web Functions entry:

> - [AWS identity](specs/08-aws-identity.md)

### `DEVELOPMENT.md` → Repo hygiene (Modify)

Replace "AWS credentials come from the ambient provider chain." with:

> AWS credentials come from the shared AWS profiles or the ambient provider
> chain, resolved by the CLI (see `.specs/blogwright/specs/08-aws-identity.md`).

---

## Type changes

None in `canonical-types.schema.json` (see "What this change does not do").
The TypeScript contracts the implementation adds are:

```ts
// packages/core/src/config.ts
export interface AwsConfig {
  /** Named profile from the shared AWS files. Ignored when env credentials are set. */
  profile?: string | undefined;
  /** 12-digit account id, as a string. Commands refuse other accounts. */
  accountId?: string | undefined;
}
// OpsConfig gains: aws?: AwsConfig | undefined;   (not defaulted)

// packages/core/src/aws/identity.ts
export interface CallerIdentity { account: string; arn: string; userId: string }

// packages/cli/src/aws-session.ts
export type ProfileStyle =
  'sso' | 'login' | 'process' | 'static' | 'external' | 'unconfigured';  // core/aws/profiles.ts
export type AwsProfileSource = 'flag' | 'env' | 'env-keys' | 'config' | 'default';
export interface ResolvedAwsProfile { name: string | null; source: AwsProfileSource }

// packages/cli/src/ports.ts
export type AwsLoginResult =
  | { ok: true }
  | { ok: false; reason: 'not-installed' }
  | { ok: false; reason: 'exit'; code: number };
export interface AwsLogin { run(args: readonly string[]): Promise<AwsLoginResult> }
// Ports gains: awsLogin: AwsLogin

// packages/core/src/clients.ts
// ClientBundleOptions gains: profile?: string | null | undefined;
// AwsClients gains:          credentials: CredentialProvider;

// packages/cli/src/context.ts
// ContextOptions gains: profile?: string | undefined; processEnv?: NodeJS.ProcessEnv | undefined;
// OpsContext gains:     identity: CallerIdentity; awsProfile: ResolvedAwsProfile;
```

The `aws` validation rules are part of the new page's
[Config block](#config-block) section, so they reach the canonical spec on
merge.

---

## Implementation notes

Order matters: core first, then the CLI, then the plugin, then docs.

```
1. core/aws/sts.ts:8 - add getCallerIdentity (Account, Arn, UserId via textTag);
   getAccountId delegates to it.
2. core/aws/identity.ts (new) - CallerIdentity, shortIdentity (port watch-tail
   src/cli/preflight.ts shortIdentity), assertAccountPin.
3. core/aws/profiles.ts (new) - profileFiles(env, home), collectProfiles,
   readProfileStyle (follows source_profile with a visited set; role_arn +
   credential_source -> 'external'), readAwsProfiles(fs, env, home). Port the pure parsers and
   their spec fixtures from watch-tail src/lib/cli/aws.ts and
   src/lib/cli/credentials.ts. Reads go through the FileSystem port; treat
   FileNotFoundError as empty.
4. core/aws/credentials.ts:19 - add `profile`; named -> fromIni({ profile }),
   else fromNodeProviderChain() (which already memoizes). Wrap the fromIni
   path in memoize from @smithy/property-provider with an expiry check, and
   ADD @smithy/property-provider to packages/core/package.json dependencies
   (it is not declared today; pnpm strictness and knip will both catch it).
   Keep the existing override fallback (env keys, else 'test') for both.
5. core/clients.ts:14,55 - ClientBundleOptions.profile; AwsClients.credentials.
   Export new symbols from core's index.
6. core/config.ts:224,447 - AwsConfig, OpsConfig.aws, validation in mergeConfig
   (keep `aws` out of DEFAULT_CONFIG, the way `ssr` is).
7. cli/ports.ts:111 - AwsLogin port; adapters/process-aws-login.ts spawns
   `aws` with stdio 'inherit', shell false; ENOENT -> not-installed.
8. cli/aws-session.ts (new) - resolveAwsProfile, isHeadless,
   classifyCredentialFailure, buildLoginChoices, offerLogin, resolveAwsSession
   (returns { profile, clients, identity }). Takes processEnv and home as
   parameters; only the composition root reads process.env / os.homedir().
9. cli/context.ts:80,210 - extract the port defaults into createPorts(overrides)
   so whoami/init share them; replace lines 229-234 with resolveAwsSession;
   emit the identity line; populate identity/awsProfile.
10. cli/cli.ts:52,308 - `profile: { type: 'string' }`; usage line. Pass
    values.profile to all four makeContext call sites: cli.ts:457 (built-in
    switch), cli.ts:533 (runPreview), plugin-commands.ts:705 (runPlugin) and
    plugin-commands.ts:1095 (destroyBeforeRemoval, plugin remove's teardown).
    Add `profile?: string | undefined` to PreviewValues (cli.ts:507) and
    PluginValues (plugin-commands.ts:168). Do NOT add it to FORWARDED_FLAGS
    (plugin-commands.ts:189); it is session-level like `plain`. Dispatch
    `whoami` beside `init` (cli.ts:349).
11. cli/known-commands.ts - add 'whoami' to RESERVED_COMMANDS explicitly (it is
    dispatched before the switch, like init/preview, so not in KNOWN_COMMANDS).
12. cli/whoami.ts (new) - findRepoRoot (a no-repo-root error means "outside
    a repository", not a failure), then load config when found
    (resolveConfigPath; no candidate is not an error, a missing explicit
    --config is), resolveAwsSession, print fixed keys.
13. cli/init.ts:310,351 - initSite gains an options argument carrying
    profile (values.profile), processEnv, home and awsLogin; update both
    call sites (cli.ts:358, the non-interactive early return, and cli.ts:390).
    Ask the profile and pin questions after askSsrFramework and any region
    re-ask (init.ts:391-401). renderConfig gains `aws`; parseConfig(rendered)
    still gates the write.
14. analytics/commands.ts:280,299,365,404-405 - replace every
    createCredentialProvider({}) with ctx.clients.credentials; add 'clients' to
    DashboardCommandContext's Pick. transform/entry.ts:53 is unchanged.
15. cli/src/test-support.ts:85,220 - testClients gains credentials;
    createTestContext gains identity/awsProfile; add a fake AwsLogin.
```

Tests:

- **Precedence.** A table test covering all five rows, including
  "env keys and config profile, no flag" (config ignored, info line) and
  "flag and env keys" (flag wins).
- **Profile files.** Profile-file parsing and sign-in style from the
  watch-tail fixtures, plus `AWS_CONFIG_FILE` and
  `AWS_SHARED_CREDENTIALS_FILE` overrides.
- **Provider selection.** A named profile selects `fromIni`, and no profile
  selects the chain.
- **Pin.** Match, mismatch, absent, and skipped under an endpoint override.
- **Emulator profile.** A configured profile missing from the shared files
  is dropped with an info line under an endpoint override, and refused
  without one.
- **Styles.** `source_profile` chains resolve to the source's style, a cycle
  is `unconfigured`, `credential_source` is `external`, and a null profile
  uses `default`'s style.
- **Ordering.** In `createContext`, a mismatch rejects before any S3 call is
  made, asserted on the transport.
- **Identity line.** Interactive sessions log through the logger. `--plain`
  and a non-TTY session without `--plain` both write to stderr and leave
  stdout untouched.
- **Login offer.**
  - Default choice per style.
  - `--profile` omitted for a null profile.
  - Headless flags.
  - Cancel.
  - Success retries once.
  - A second failure is not offered again.
  - `not-installed` and a non-zero exit.
  - No offer for non-interactive sessions, `env-keys`, `static`, `process`,
    `external`, or an endpoint override.
- **`whoami`.** With config, without a config file, outside a repository,
  a missing explicit `--config`, each `pin` value, and exit codes.
- **Call sites.** `--profile` reaches the context for built-ins, preview,
  plugin dispatch and `plugin remove`'s teardown, and is absent from a
  plugin action's forwarded `args`.
- **`init`.**
  - No profiles found skips the question.
  - An invalid profile answer is re-asked.
  - Pin accepted, declined, and failing.
  - The rendered config parses.
- **Analytics.** Commands receive the host provider.
- **Config.** `mergeConfig` rejects each malformed `aws` shape.

Documentation (the docs site, outside `.specs`):

- **`docs/.../reference/cli.md`:**
  - a `whoami` section under Site commands;
  - a `--profile` row in Global options (applies to all, `init` uses it as
    the default answer);
  - the identity line under Output modes.
- **`docs/.../reference/configuration.md`:** an `aws` section under Core
  identity (`aws.profile`, `aws.accountId`). The block has no defaults, so
  "How overrides merge" is unchanged.
- **`docs/.../guides/ci-github-oidc.md`:** CI ignores `aws.profile` because
  the OIDC action exports keys, and the pin still applies.
- **`docs/.../guides/environments.md`:** one profile and pin per environment
  file.
- **`docs/.../guides/troubleshooting.md`:** pin mismatch, missing profile,
  and the login offer.
- **`docs/.../getting-started/quickstart.md`:** the new `init` questions.
- **Changeset:** minor for `blogwright`, `blogwright-core` and
  `blogwright-analytics` (fixed group).

References: watch-tail `src/lib/cli/aws.ts`, `src/lib/cli/credentials.ts`,
`src/cli/preflight.ts`, `src/lib/server/identity.ts`. AWS CLI reference for
[`sso login`](https://docs.aws.amazon.com/cli/latest/reference/sso/login.html)
and [`login`](https://docs.aws.amazon.com/cli/latest/reference/login/index.html).
`@aws-sdk/credential-provider-node` `defaultProvider` (the warning that
profile-over-environment precedence may change).

---

## Merge plan

1. Create `.specs/blogwright/specs/08-aws-identity.md` from the "Adds" blocks,
   with `**Date:**` set to the merge date. Index it in
   `.specs/blogwright/README.md` and `.specs/README.md`.
2. Apply each Modify/Add block to `00-overview.md`, `01-domain-model.md`,
   `02-plugin-architecture.md` and `04-analytics.md`, and bump each page's
   `**Date:**`. Apply the `DEVELOPMENT.md` replacement.
3. Confirm `canonical-types.schema.json` needs no change, because `OpsConfig`
   is still unmodelled.
4. Set this file's `**Status:**` to `Merged`, add `**Merged:** YYYY-MM-DD`,
   and move it to `.specs/changes/merged/`.
5. In `.specs/README.md`, move this entry from the pending change specs to the
   merged list.

---

## Assumptions and open questions

**Assumptions**

- Operators who want a login offer have AWS CLI v2 on their `PATH`. Blogwright
  never bundles or installs it.
- GitHub OIDC CI exports `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and
  `AWS_SESSION_TOKEN` (as `aws-actions/configure-aws-credentials` does), so
  row 3 of the precedence applies there.
- STS `GetCallerIdentity` needs no IAM permission, so the identity check adds
  no policy requirement to the deploy role.

**Decisions**

- *Config shape.* **A nested `aws: { profile, accountId }` block.** It groups
  operator-identity settings apart from stack settings such as `region`, and
  leaves room for related keys.
- *CI interaction.* **Exported environment credentials beat `aws.profile`.**
  Agreed with the owner on 2026-10-16. A committed profile must not break CI,
  and the pin keeps a stale export from deploying to the wrong account.
- *Login.* **Offer `aws sso login` and `aws login` as an explicit choice.**
  Agreed with the owner on 2026-10-16. The default follows the profile's
  style, and the operator can override it.
- *Scope.* **`whoami` and the `init` prompts ship in this change.** Agreed
  with the owner on 2026-10-16. Without them, pinning is something an
  operator has to discover in the docs rather than something set up at
  first run.
- *Shared session.* **One `resolveAwsSession` for `createContext`, `whoami`
  and `init`.** Three call sites with one precedence, one pin rule and one
  login offer cannot disagree.
- *`whoami` without config.* **Allowed, with STS signed in `us-east-1`.** The
  command is most useful before a repo is configured, which is exactly when
  `init` would also want it.

**Open questions**

- Should `aws.accountId` accept a list, for an environment that legitimately
  deploys from more than one account? No current environment needs it.
- Should the identity line also appear in `blogwright --help` or
  `plugin list`? Neither builds a context today, and adding an STS call to
  either would slow commands that are meant to work offline.
