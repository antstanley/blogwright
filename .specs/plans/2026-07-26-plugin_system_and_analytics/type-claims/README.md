# Type-claim gate

A compiled harness that pins every type-level claim the three 2026-07-26
change specs and their task files make, against this repo's real types and its
own TypeScript. It exists because this corpus repeatedly broke the same way:
a remediation changes a proposed type's shape, and task files written against
the old shape keep asserting the old truth - a class of defect that is
mechanically checkable and was previously being found by expensive full-corpus
review, several rounds late.

## What it is

- **`transcriptions.ts`** - the proposed SPI types, which do not exist in
  `packages/` yet: `PluginContext<TConfig>`, `Plugin<TConfig>`,
  `PluginCommand`, `ResourceNode<Ctx>`, the engine's structural constraint
  (`EngineContext` and `applyGraphProposed`), `SiteState`, `PluginLogger`,
  `PluginPorts`, `ServiceDescriptor`, `ProposedPdsConfig`,
  `ResolvedPdsConfig`, `ProposedPdsContext`, `AnalyticsConfig`. Each
  declaration cites the spec section it is copied from, so a reader can see
  what must be updated when the spec changes.
- **`claims.ts`** - one compiled assertion per claim, in BOTH directions.
  Claims the documents say must fail to compile sit under `@ts-expect-error`
  with the exact error code the document quotes (TS2739, TS2344, TS2345,
  TS2339, TS7053, TS18048, TS2542, TS2322, TS2578-guarded), so a claim that
  silently stops erroring also fails the gate. Claims that must compile are
  plain code. Every claim carries a `// CLAIM Cnn [document §section / task]
  expects <code|clean>` comment.
- **Real types are imported, never transcribed**: `OpsContext`, `OpsConfig`,
  `OpsState`, `AwsClients` (via `OpsContext.clients`), `StateStore`,
  `ResourceOutputs`, `PdsConfig`, `ServiceKey`, `SendOptions` come from
  `packages/` sources, so the assertions are against ground truth.
  `tsconfig.json` extends the root `tsconfig.base.json` (same strictness that
  makes the quoted diagnostics real: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) and maps `blogwright-core` onto
  `packages/core/src`, so nominal classes resolve to one declaration.

## How to run

```
node .specs/plans/2026-07-26-plugin_system_and_analytics/type-claims/check.mjs
```

No network, no AWS, no build step. It uses the repo's own `typescript`
(resolved from `packages/cli`), so `pnpm install` must have run. Exit 0 means
every claim held; non-zero output names each broken claim and the compiler
error under it.

## The rule

**When a spec changes a proposed type, update the transcription here and
re-run. Anything that breaks names a task or spec section that needs
updating.** The failure output is the review checklist: each broken claim
cites the document that now asserts a stale truth. Never repair a broken claim
by editing the claim alone - either the transcription is behind the spec
(update it), or the document's assertion is now false (fix the document, then
the claim).

Three claims are deliberately **ground-truth-today** pins that retire when
implementation lands: C23 (core's `PdsConfig.secretName` still required -
retires at task 27), C26 (`SendOptions.service` still the closed union -
retires at task 31), C28 (`AwsClients` without `signingUsEast1` - retires at
task 38). When one of those tasks lands, the gate fails on its claim; delete
the claim (its "today" statements in the corpus have become history at that
commit) and re-run.

Known limit: `@ts-expect-error` suppresses *any* error on the next line, not
only the quoted code - which is why each negative claim is kept to a single
minimal expression, and each has a positive sibling nearby that would break if
the types drifted wholesale.

## Why it lives here

Outside `packages/` on purpose: `pnpm-workspace.yaml` globs only `packages/*`
and `docs`, `knip.json` scans only the four package workspaces' `src/`, and
the production build never sees this directory - verified by running
`pnpm knip` and `pnpm build` with the harness in place. One toolchain surface
does reach it: the root `pnpm exec oxfmt --check .` formats every `.ts`/`.mjs`
in the repo, this directory included, so run `pnpm exec oxfmt` over edited
harness files before pushing. It is plan
infrastructure owned by task 00 (see `plan.md`), not shipped code, and it is
deliberately not wired into CI or the root `package.json` (proposed, not
done - see task 00's decision note).
