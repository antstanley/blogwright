# Development Guidelines

**Status: Canonical · Date: 2026-09-05 · Owner: Ant Stanley · Scope: Repo-wide**

The rules of the road for everyone - humans and AI agents - writing code in this
repository. Covers the toolchain, the pervasive coding style (Clean Code), error
handling and boundaries, limits, version control (jujutsu), TypeScript conventions,
repository hygiene, agent-specific emphases, and the definition of done.

## Toolchain

| Tool       | Version / channel        | Notes                                                                 |
| ---------- | ------------------------ | --------------------------------------------------------------------- |
| TypeScript | ^6 (strict)              | shared `tsconfig.base.json`; see [TypeScript conventions](#typescript-conventions) |
| Node       | ≥ 22 (CI runs 24)        | `engines` in every package; ESM only (`"type": "module"`)             |
| pnpm       | 11                       | five packages under `packages/`, plus private docs workspace                         |
| oxlint     | ^1.72                   | linter; per-package `pnpm lint`, config in `.oxlintrc.json`           |
| oxfmt      | ^0.57                   | formatter; config in `.oxfmtrc.json`, run via `pnpm exec oxfmt`       |
| vitest     | 4                        | test runner in every package; `pnpm test` at the root runs all        |
| knip       | 6                        | dead code / unused dependency check; `pnpm knip` at the root          |
| rolldown   | ^1.1                   | bundles the build-agent server and analytics transform Lambda          |
| Vite / SvelteKit | 8 / 2 (Svelte 5)   | builds the analytics dashboard only (`packages/analytics/app` → `dist/app`); static adapter, no server |
| jj         | 0.43+                    | version-control front end (colocated Git backend)                     |

CI (`.github/workflows/ci.yml`) runs `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`,
`pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` on every push to `main`
and every pull request. There are no local pre-commit or pre-push hooks; CI is
the enforcement gate.

## Clean Code - the pervasive style

This project adopts **Clean Code** as its pervasive coding style. This is the default,
not a recommendation. Deviations require a written reason in the change description.

The short form: **make the code reveal its intent.** A reader should understand a unit
from its name and shape without tracing it. Prefer clarity to cleverness. When a clever
construction and a clear one compete, the clear one wins even at a cost in lines.

Load-bearing principles:

- **Meaningful names.** Intention-revealing, pronounceable, searchable. The name states
  what a thing is or does; no encodings, no abbreviations that need a key.
- **Small functions that do one thing.** A function operates at a single level of
  abstraction. Few parameters (prefer 0–2; avoid boolean flag arguments - they signal a
  function doing two things). No hidden side effects; separate commands from queries.
- **Single responsibility.** A module has one reason to change. High cohesion, low
  coupling. The package boundaries encode this: `blogwright-core` owns transport,
  config, state, and shared ports; the CLI owns the graph, commands, and dispatch;
  `blogwright-pds` owns standard.site (PDS) publishing; the build-agent owns the
  in-MicroVM build server.
- **No duplication (DRY).** Duplicated logic has one home - tempered by judgment:
  prefer a little duplication over the wrong abstraction.
- **Self-documenting code; comments are a last resort.** A comment is often a failure
  to express something in code. Good comments explain *why* or warn of consequences
  (see the rkey warning below); they never paraphrase the code, and commented-out code
  is deleted.

## Hexagonal architecture - ports and adapters

This project adopts **hexagonal architecture** (ports and adapters). Domain logic -
the graph engine, deploy orchestration, PDS reconciliation, config and naming - never
touches the outside world directly. Every side effect crosses a **port**: a small,
repo-owned interface defined next to the domain code that needs it. **Adapters**
implement ports against real infrastructure and live at the edge; the **composition
root** (`context.ts` / `bin.ts`) is the only place adapters are constructed and wired.

The rule, stated once: **a domain module imports ports and other domain modules -
never `node:fs`, `node:child_process`, `fetch`, or a vendor SDK.** Only adapters and
the composition root may.

Existing ports are the model for new ones:

| Port                        | Defined in                    | Real adapter                    | Test adapter |
| --------------------------- | ----------------------------- | ------------------------------- | ------------ |
| `Transport`                 | `core/src/aws/signer.ts`      | `fetchTransport`                | transport-level mocks in every AWS client test |
| `XrpcTransport`             | `pds/src/xrpc.ts`             | OAuth session `fetchHandler`    | stub transports in `xrpc.test.ts` |
| `StateStore`                | `core/src/state.ts`           | S3-backed store                 | in-memory / mocked transport |
| `Logger`                    | `cli/src/logger.ts`           | terminal logger                 | capturing logger |
| `FileSystem`                | `core/src/ports.ts`           | `createNodeFileSystem` (`core/src/adapters/node-fs.ts`) | `createMemoryFileSystem` (Map-backed) |
| `Terminal`                  | `core/src/ports.ts`           | `createNodeTerminal` (`core/src/adapters/node-terminal.ts`) | `createScriptedTerminal` |
| `Vcs`                       | `cli/src/ports.ts`            | `createProcessVcs` (`cli/src/adapters/process-vcs.ts`) | fake `Vcs` via `createTestContext` `ports.vcs` overrides |
| `PingBuilder`               | `cli/src/ports.ts`            | `createFetchPing` (`cli/src/adapters/fetch-ping.ts`) | no-op / recording ping via `createTestContext` `ports.ping` overrides |
| `ModuleLoader`              | `cli/src/ports.ts`            | `createNodeModuleLoader` (`cli/src/adapters/node-module-loader.ts`) | fail-fast fake via `createTestContext` `ports.loader` overrides |
| `PackageManager`            | `cli/src/ports.ts`            | `createProcessPackageManager` (`cli/src/adapters/process-package-manager.ts`) | `createRecordingPackageManager` (`cli/src/test-support.ts`), passed as `main`'s `PackageManagerFactory` |
| `AnalyticsQuery`            | `analytics/src/ports.ts`      | `createDuckDbAnalyticsQuery` (`analytics/src/adapters/duckdb-query.ts`) | `createFixtureAnalyticsQuery` (`analytics/src/fixture-query.ts`), fixture-backed |
| `TransformDiagnostics`      | `analytics/src/transform/diagnostics.ts` | JSON-line adapter wired to console.info in Lambda entry | recording callback |
| `AnalyticsIngest`           | `analytics/src/ports.ts`      | `createDuckDbAnalyticsIngest` (`analytics/src/adapters/duckdb-ingest.ts`) | `createRecordingAnalyticsIngest` (`analytics/src/fixture-ingest.ts`), recording |

Conventions:

- **Ports are minimal.** A port exposes the operations the domain needs, in domain
  vocabulary - not a re-export of the underlying API's surface. (`Transport` is one
  function, not an HTTP client.)
- **Function-typed ports are preferred** where one operation suffices; interfaces
  where the operations cohere (a store, a VCS).
- **Adapters translate errors** into the repo's own `Error` types at the boundary
  (see [Error handling and boundaries](#error-handling-and-boundaries)); a vendor
  error never crosses a port.
- **Tests substitute at the port**, not by patching modules or globals. If a test
  needs a module mock or an env-var override to isolate a side effect, that side
  effect is missing a port.
- **The dependency direction is inward.** Adapters import domain types; domain code
  never imports an adapter. `blogwright-core` hosts ports shared across packages
  (transport, filesystem, terminal) and their adapters; a package hosts privately
  the ports only it uses (the CLI's VCS and builder-ping ports).
- **Features live in their own packages, and the plugin manifest is the mechanism.**
  A coherent feature with its own domain - the standard.site integration in
  `blogwright-pds` is the model - is its own workspace package depending on
  `blogwright-core`. It announces itself by declaring
  `"blogwright": { "plugin": "<namespace>" }` in its own `package.json`: that
  manifest field is what CLI discovery scans a dependency tree for, and the
  package's default export is then the `Plugin` declaring its namespace, its
  commands, the config key it owns and validates, and the resource nodes it
  contributes. The CLI owns discovery, dispatch and wiring, not feature logic:
  `cli.ts` carries no branch for a feature package and no mention of `pds`. A
  feature's commands still take the narrow surface that feature actually needs
  (`PdsContext`, a `Pick` over core's `PluginContext<PdsConfig>`, satisfied
  structurally by the CLI's `OpsContext` - no import in either direction and no
  adapter, pinned by a plain assignment in `packages/cli/src/context.test.ts`);
  only the `nodes` contributor takes the full `PluginContext`, because only a
  lifecycle verb's dispatch boundary builds one.

## Error handling and boundaries

### Where validation lives

Validate where data crosses from a place you do not control into one you do, and
translate the failure into the repo's own vocabulary at that line.

| Boundary                      | What to validate                       | How |
| ----------------------------- | -------------------------------------- | --- |
| Config file → CLI             | Shape, required fields, value ranges   | `parseConfig` / `mergeConfig` / `validateConfig` in `blogwright-core` - the parsed JSONC never escapes unvalidated |
| AWS API → core                | Status, body shape                     | Per-service clients in `blogwright-core` over the SigV4 transport; the CLI never issues a raw AWS call |
| PDS / OAuth → pds package     | Token responses, record shapes         | `blogwright-pds` owns the atproto surface; nothing outside it touches OAuth state |
| S3 state read                 | Round-trip integrity                   | StateStore parses site/plugin JSON and validates envelope/output shapes; malformed data raises bucket/key/field context instead of empty state |
| CLI arguments                 | Command, positionals, flags            | `parseArgs` plus a `KNOWN_COMMANDS` membership test in `cli.ts`; every other first word is taken as a plugin namespace and dispatched generically by `runPlugin` (`cli/src/plugin-commands.ts`), which refuses an unknown namespace by naming `blogwright plugin list` and an unknown action by listing that plugin's own actions. Only a bare invocation with no command prints usage |

### Error handling in TypeScript

- Throw `Error` with enough **context** to locate the cause - the operation that
  failed, the offending value, and what would fix it (the config validators are the
  model: `config.siteName must be lowercase alphanumeric/dashes, got "…"`). Never log
  a secret in that context - `pds secret status` shows metadata, never values.
- **Never return or accept `null`/`undefined` for a domain value.** Return an empty
  collection, or make absence explicit in the type (`domain?: string | undefined`
  under `exactOptionalPropertyTypes`).
- Wrap third-party surfaces behind a repo-owned module (the AWS clients in core, the
  OAuth client in `pds/src/oauth.ts`); the rest of the code never sees a vendor error.
- Validate inbound data at the boundary, then work with trusted shapes inside. A
  `JSON.parse(…) as T` cast is acceptable only when the very next step validates the
  result (as `parseConfig` does); it is never a substitute for validation.

### Use exceptions, not return codes

- Signal failure with exceptions, not error codes a caller may forget to check.
- Throw early with context; catch only where the failure can be handled or reported.
  Deliberate non-fatal paths are the exception and are logged as warnings - the
  post-deploy PDS sync is the model (a failed sync warns; the next deploy heals).
- Every catch handles or re-raises with more information; errors are never swallowed.

### Make intent explicit

- Prefer types that make an invalid value hard to construct - union types over free
  strings (`RobotsMode`, `'auto' | 'on' | 'off'`), required fields over defaults that
  guess (`siteName` has no default because a wrong guess names real AWS resources).
- When behaviour is hard to read, the fix is a better name or a smaller function - not
  a comment.
- Match exhaustively over unions; `noFallthroughCasesInSwitch` is on, and the
  unexpected case raises rather than falling through.

## Limits and bounds

Magic numbers are replaced with **named constants or config fields** that state their
meaning. Any genuine limit - MicroVM memory and duration, log retention, invalidation
path counts - is a named config field with its default in `DEFAULT_CONFIG` and its
range enforced in `validateConfig`, not a literal at the call site. Derived-name
limits that come from AWS (the S3 63-character bucket-name cap) are checked where the
name is derived, with an error that says how to fix it.

## Version control

- **Commits are small and well-described.** One coherent change per commit. Squash
  noise before pushing.
- **Empty commit descriptions are not accepted.** The subject is an imperative,
  sentence-case summary (`Hash the agent source, not the built bundle, for
  reproducible image keys`); the description states the *why*.
- **The integration branch (`main`) stays releasable.** Feature work happens on named
  bookmarks; pull requests target `main`.
- **Do not rewrite published history** unless the change is yours and unmerged. If a
  force-push is required, call it out.

### jujutsu workflow

- **`jj` is the sole version-control front end.** Do not run `git commit` / `git add` /
  `git status` against the working copy - the repo is colocated, and the index /
  working-copy mismatch is exactly what jj removes.
- **Describe before pushing.** `jj describe` sets the *why*.
- **Feature work happens on named bookmarks** (`jj bookmark create feat/x`); pull
  requests are pushed with `jj git push`.
- **Resolve conflicts in jj** (`jj resolve`), not by editing plain-text markers.
- **Destructive `jj` operations need explicit confirmation** - `jj abandon`,
  `jj op restore`, force-fetches, bookmark deletion - even when they look like the
  cleanest path.
- The `.jj/` directory is local; it is not committed.

## TypeScript conventions

### Formatting and linting

- oxfmt owns line length and layout; it runs clean before a change is pushed.
- oxlint runs clean before push (`pnpm lint`); CI re-runs it on every push and PR.
- knip runs clean (`pnpm knip`): no dead exports, no unused dependencies. Deliberate
  exceptions are recorded in `knip.json` with the reason (the build-agent entry in the
  CLI's devDependencies exists purely for pnpm build ordering).

### Code style

- **No `any`.** Use `unknown` plus narrowing. Casts are bugs unless the next line
  validates the result or a comment justifies them.
- **Strict compiler settings are load-bearing:** `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `verbatimModuleSyntax` - all inherited from `tsconfig.base.json`; packages do not
  weaken them.
- **Domain types are imported from `blogwright-core`** (`OpsConfig`, `Names`, the
  client interfaces), never hand-redefined in the CLI or build-agent.
- **Functions are small and single-purpose,** operating at one level of abstraction;
  when a second level appears, extract a named helper.
- **Prefer 0–2 parameters; no boolean flag arguments** - a flag means the function
  does two things, so split it.
- **Separate commands from queries** - a function either changes state or returns a
  value, not both.
- **Comments explain *why*.** Doc comments on exported symbols state constraints and
  units (see `config.ts`); no comment paraphrases the code.

### Naming

- `camelCase` for functions and variables, `PascalCase` for types, and
  `SCREAMING_SNAKE_CASE` for module-level constants (`DEFAULT_CONFIG`, `COMMIT_FILE`).
- **Intention-revealing and searchable.** Type names are nouns; function names are
  verbs or verb phrases (`deriveNames`, `findRepoRoot`, `stripJsonComments`).
- **No abbreviations** in identifiers beyond ecosystem-standard short names
  (`ctx`, `cfg`, `env`, `id`).

### Testing

- vitest is the sanctioned runner; `pnpm test` at the root runs every package.
- **Unit tests run with no cloud access.** AWS interactions are covered by
  transport-level mocks. Integration tests against the floci emulator are opt-in
  (`FLOCI=1 AWS_ENDPOINT_URL=http://localhost:4566 pnpm test`); the
  `lambda-microvms` control plane is not emulated, so MicroVM orchestration stays
  mock-covered.
- **Positive and negative space.** Every happy-path test is paired with a test that
  the adjacent bad input is rejected (the config validator tests are the model).
- **Test the validity boundary** - one below a limit, at the limit, one above.
- **Pinned vectors are contracts.** `packages/pds/src/rkey.test.ts` pins rkey/TID
  vectors that are on-the-wire identity: they must never change for an existing post
  path. Changing a pinned vector is a breaking protocol change, not a test fix.
- **No flaky tests.** A flaky test is a bug to fix now, not a known issue to retry
  around.
- **Determinism.** Inject clocks and identifiers; no wall-clock or randomness in test
  bodies.

### Documentation

- Public exports of `blogwright-core`, `blogwright-pds`, `blogwright-analytics`, and
  the `blogwright/rkey` subpath carry doc comments.
- Each module opens with a comment stating what it owns (see `config.ts`,
  `repo-root.ts`).
- No bare `// TODO` without an owner and a tracking reference.

## Repository hygiene

- **`DEVELOPMENT.md` (this page) is the canonical home for development guidelines**;
  `README.md` documents the product surface for consumers.
- **Local, untracked operator data stays untracked.** `HANDOFF.md` is temporary
  session context and is excluded via `.git/info/exclude`. Never commit secrets: PDS
  keys and OAuth sessions live only in Secrets Manager, and AWS credentials come from
  the ambient provider chain.
- **Build artifacts are gitignored, never committed** - `dist/` everywhere, and
  `packages/cli/agent/` (the copied build-agent bundle, produced by
  `scripts/copy-agent.mjs` and shipped only in the npm tarball).
- **Reproducibility is deliberate.** The build-agent manifest hashes the agent's
  *source*, not the built bundle, so image keys do not vary by platform. Do not
  change hashing inputs casually - a changed hash forces a builder-image rebuild for
  every consumer.
- **`blogwright-build-agent` stays `private: true`.** It ships inside the CLI
  package; it is never published on its own.

## Guidelines for AI agents

Where agents most often slip in this repo:

1. **Optimize for the reader.** Prefer the clear construction; do not introduce
   cleverness to save lines.
2. **Use jj, not git,** for all version-control operations (see
   [Version control](#version-control)); do not run destructive operations without
   explicit confirmation.
3. **Never change pinned rkey vectors or slug derivation.** Post slugs and rkeys are
   on-the-wire identity for published standard.site records.
4. **Never publish.** No `npm publish` / `pnpm publish`; releases go through the
   GitHub-release workflow, deliberately.
5. **Keep functions small and single-purpose.** When a function grows a second level
   of abstraction, extract it with an intention-revealing name.
6. **No null in, no null out.** Return empty collections or make absence explicit in
   the type.
7. **Express intent in names, not comments.** Do not add a comment that restates the
   code; if a comment is needed to explain *what*, rename instead.
8. **Tests are first-class.** A change ships with tests written alongside it;
   "compiles" is not "works" - run `pnpm build && pnpm test && pnpm lint && pnpm knip`
   and report the actual output. Point tests at agent artifacts through
   `createTestContext` (an injected `agentDir` plus the in-memory `FileSystem`);
   do not weaken the runtime `../agent` resolution.
9. **No duplication.** Before adding logic, check whether it already has a home -
   especially in `blogwright-core`, whose clients and config own their surfaces.
   **Stay inside the architecture:** a new side effect goes through a port
   (see [Hexagonal architecture](#hexagonal-architecture--ports-and-adapters));
   do not call `node:fs`, `node:child_process`, or `fetch` from domain modules.
10. **Errors are raised with context, never swallowed.** Every catch handles or
    re-raises with more information; the only warn-and-continue paths are the
    deliberately non-fatal ones (post-deploy PDS sync).

## Definition of done

A change is done when:

- The behaviour is covered by tests written with the change; new validation paths
  have negative-space tests.
- Functions are small and single-purpose; names reveal intent without comments.
- No duplicated logic was introduced.
- Magic numbers are named constants or validated config fields.
- Errors are raised with context; no `null` is returned or passed for a domain value.
- New external interactions (network, disk, process, terminal) go through a port;
  no direct Node API or vendor-SDK calls were added to domain modules.
- `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`, `pnpm lint`,
  `pnpm exec oxfmt --check .`, and `pnpm knip` all pass locally - the same six gates CI runs.
- A user-facing change ships with a changeset (`pnpm changeset`) describing its
  semver impact; internal-only changes (docs, tests, refactors) do not need one.
- Pinned rkey vectors and derived AWS resource names are unchanged for existing
  inputs (or the change description calls out the migration).
- The commit description states the *why*.

## Assumptions and open questions

**Assumptions**

- The package split (core / cli / pds / analytics / build-agent) is stable; new code
  joins an existing package, and a new package is added only for a coherent feature
  with its own domain. `blogwright-pds` (extracted 2026-07-11) and
  `blogwright-analytics` (added 2026-07-26, installed on demand and never shipped with
  the CLI) are the two worked instances of that exception.
- Consumers run the CLI via `pnpm exec` in their own repos; global installs are not a
  supported surface (the `bw` bin collides with Bitwarden's CLI when global).

**Decisions**

- *Style.* **Clean Code.** The codebase already practices it - exceptions with
  contextual messages throughout, no assertion discipline, vitest as the
  correctness net - so the guidelines codify the existing style rather than impose a
  migration.
- *Placement.* **Retain root DEVELOPMENT.md.** The canonical spec set indexes this
  page as its rules-of-road source. Keeping the established root path preserves
  contributor visibility and avoids a duplicated guidelines page.
- *VCS.* **jujutsu only.** The repo is jj-colocated and driven with jj; git
  conventions are deliberately not documented to avoid prescribing two workflows.
- *Enforcement.* **CI as the sole gate.** No local hooks;
  `pnpm build/typecheck/test/lint`, `pnpm exec oxfmt --check .` and `pnpm knip` in
  `.github/workflows/ci.yml` are the enforcement point, and contributors run the
  same six commands locally before pushing.
- *Architecture.* **Hexagonal (ports and adapters), adopted 2026-07-11.** The repo
  already practiced it at its two network seams (`Transport`, `XrpcTransport`) -
  transport-level mocking is why the test suite needs no cloud - so the adoption
  generalizes an existing strength rather than importing a foreign structure. Hexagonal
  here means port discipline inside packages first; once a feature's side effects sat
  behind ports, the standard.site integration was extracted into `blogwright-pds`
  (2026-07-11) per the feature-package convention above.
- *Hexagonal enforcement.* **A lint rule, not convention, active 2026-07-11.**
  `no-restricted-imports` in the root `.oxlintrc.json` errors on `node:fs`,
  `node:fs/promises`, `node:child_process`, and `node:readline`(`/promises`) -
  with and without the `node:` prefix - everywhere except the adapter directories
  (`packages/core/src/adapters/`, `packages/cli/src/adapters/`), the CLI
  composition root (`bin.ts`, `context.ts`), the tmp-dir test helpers
  (`cli/src/test-support.ts` and `pds/src/test-support.ts`, which back the
  node-adapter integration tests), and `packages/build-agent` - the in-MicroVM build server is an edge component whose
  whole job is spawning builds and writing artifacts. oxlint scopes the exception
  with config `overrides`; the glob paths resolve relative to the root config, so
  one rule covers every package even though `pnpm lint` runs per package.

**Open questions**

- oxfmt already runs in CI via `pnpm exec oxfmt --check .`; should root
  `fmt`/`fmt:check` convenience scripts also be added?
- Should a pre-push hook mirror the six CI gates locally, or is CI-only enforcement
  sufficient at this repo's size?
- Commit subjects follow an imperative sentence-case convention, not Conventional
  Commits - adopt Conventional Commits before the first external contribution, or
  keep the current convention?
- Boundary validation is hand-rolled (`validateConfig`); if config surface keeps
  growing, is a schema validator (zod/valibot) worth the dependency?
