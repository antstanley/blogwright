# Done Certificate — Task 47: The Plugin export, the manifest field, the command table, and the analytics init contributor

**Task:** [47-analytics_plugin_export_and_init.md](47-analytics_plugin_export_and_init.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 47. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 47) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `packages/analytics/src/plugin.ts` default-exports a `Plugin` claiming the `analytics` namespace with `configKey: 'analytics'`, task 44's validator, an `init` contributor and a command table consistent with task 16's precedence, and `packages/analytics/package.json` declares the manifest field so the CLI discovers the package as a plugin.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the CLI's plugin discovery and boundary check (`packages/cli/src/plugins.ts` from task 08 and `validatePlugin` in `packages/core/src/plugin.ts`), the analytics package's existing named exports and build scripts from task 32, or task 44's config validator, which this task binds rather than reimplements.

## Obligations

- **O1 — Default export, manifest field, and the discovery-shaped load.**
  - *Claim:* the package default-exports a `Plugin` with `name: 'analytics'`, a one-line description, `configKey: 'analytics'`, task 44's `validateConfig`, an `init` contributor and a `commands` table; `packages/analytics/package.json` carries `{ "blogwright": { "plugin": "analytics" } }`; and a test loads the package as CLI discovery does and passes it through `validatePlugin` by package name.
  - *Evidence to collect:* read `packages/analytics/src/plugin.ts` and `packages/analytics/src/index.ts` for the default export and its six members; read `packages/analytics/package.json` for the manifest block; run `pnpm test -- plugin` in `packages/analytics` and confirm the discovery-shaped case reads the manifest field from `package.json`, takes the module's `default`, and calls `validatePlugin(module, 'blogwright-analytics')` with the package name as the second argument rather than a literal placeholder.
  - *Checks:* resolve `validateConfig` on the exported object — confirm it is task 44's `validateAnalyticsConfig` from `packages/analytics/src/config.ts`, not a second validator declared in `plugin.ts`; feed it an invalid block and confirm task 44's message text.
  - *Status:* ☐ unverified

- **O2 — Command table matches task 16's precedence.**
  - *Claim:* the declared action set is exactly what task 16's precedence leaves to the plugin (under the recommended resolution `init`, `status`, `dashboard`, and neither `bootstrap` nor `destroy`), collides with no generic verb the CLI owns, and every `summary` is non-empty, one help line long, and names `--yes` for any destructive action.
  - *Evidence to collect:* read the precedence paragraph in `packages/cli/src/plugin-commands.ts`'s module comment; read the `commands` table in `packages/analytics/src/plugin.ts`; run `pnpm test -- plugin` in `packages/analytics` and confirm one test enumerates the declared actions against an explicit list of the CLI's reserved and generic verbs (not a sampled subset) and asserts an empty intersection, and one test asserts every `summary` is non-empty.
  - *Checks:* if the table declares any destructive action, confirm its summary contains `--yes` and matches the option documented at `packages/cli/src/cli.ts:61`.
  - *Status:* ☐ unverified

- **O3 — `analytics init` returns a block and writes nothing.**
  - *Claim:* the contributor returns `ConfigBlockEntry[]` for both an all-defaults and a customised answer set, performs no filesystem write, and returns an empty array rather than `undefined` when declined.
  - *Evidence to collect:* run `pnpm test -- plugin` in `packages/analytics` and read the two init cases: confirm both drive `createScriptedTerminal` (`packages/core/src/adapters/script-terminal.ts:22`), that the all-defaults case asserts each entry's rendered property against task 44's default constants by name, and that a `createMemoryFileSystem` handed to the test records no write; read the decline path for an empty-array return.
  - *Checks:* grep `packages/analytics/src/plugin.ts` for `writeText` and `readText` — confirm the init contributor calls neither, so the write stays with the CLI's generic `init` action (task 13).
  - *Status:* ☐ unverified

- **O4 — No CLI type and no `blogwright` dependency.**
  - *Claim:* `PluginContext` from `blogwright-core` is the only host type the package imports, and `packages/analytics/package.json` depends on `blogwright` in neither `dependencies` nor `devDependencies`.
  - *Evidence to collect:* run `grep -rn "from 'blogwright'" packages/analytics/src/` and expect no output; read the `dependencies` and `devDependencies` blocks of `packages/analytics/package.json`.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run `pnpm test -- plugin` inside `packages/analytics` and confirm the discovery-shaped case, the collision list and the manifest block (Reviewable).**
  - *Claim:* a reviewer can run the package's plugin tests and observe the discovery-shaped load naming `blogwright-analytics`, a collision test listing the CLI's reserved verbs explicitly, and a manifest block with no `blogwright` dependency.
  - *Evidence to collect:* run `pnpm test -- plugin` inside `packages/analytics` and read the named cases; run `grep -n '"blogwright"' packages/analytics/package.json` and confirm the only hit is the manifest block.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/plugins.ts` (task 08 discovery) reads `packages/analytics/package.json`'s manifest field and loads the module → expect `validatePlugin` to return a typed `Plugin` naming the `analytics` namespace : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/index.ts` re-exported named symbols (task 32's seeded barrel, task 44's config exports) imported by an existing package test → expect every existing named export still importable beside the new default export : ☐ (PRESERVED / REGRESSION)

## Residue

The `status` and `dashboard` entries point at `packages/analytics/src/commands.ts` functions whose bodies land at tasks 55 and 55; until then they raise an error naming their task, and the validator should confirm the message names the task rather than reading as a bare TODO. If task 16 decided a precedence other than the recommended one, O2's expected action set changes with it — read `plugin-commands.ts`'s module comment first and judge the table against what is recorded there, not against the wording in this certificate. Whether the analytics package ships a changeset here or at task 58 is a closure decision; note which was chosen.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
