# Retired planning type-claim gate

Retired by task 63 on 2026-09-05 after the plugin, PDS and analytics runtime
requirements were integrated. These proposal-era transcriptions were deliberately
outside the production workspace and CI. Shipped declarations and ordinary
`pnpm typecheck` are now authoritative; keeping duplicate proposed interfaces
would allow the specification and implementation to drift independently.

## Final pre-retirement evidence

The gate ran after integrating tasks 59, 60 and 62, immediately before retirement
in jj change `krvxmzqk`. Its unchanged checker, 29 claims, TypeScript configuration
and transcriptions remain readable in reachable task60 commit
`55c2f0f5dcbc5ae26b302c7924c29553415b5dd3`, in this `type-claims/` directory.
No historical verdict is rewritten.

Command, run 2026-09-05 with Node 24.19.0 and the repository's TypeScript:

```sh
node .specs/plans/2026-07-26-plugin_system_and_analytics/type-claims/check.mjs
```

Exit 0; exact output:

```text
PASS: 29 claims held (12 compiled positives, 17 pinned compile-errors) against the repo's TypeScript.
```

The duplicate executable `check.mjs`, `claims.ts`, `transcriptions.ts` and
`tsconfig.json` were removed after this pass. The command above is historical
evidence and is no longer an active command on the final tree.

## Current proof and enduring checks

A separate compile probe against the actual exported `PluginContext` passed
`ctx.pluginConfig.foo` as `string` and rejected `ctx.config.foo` with exactly
TS2339. It uses the CLI's real compiler options and the built `blogwright-core`
package export, without suppressing the negative diagnostic or copying types.
The [current closure report](../../../reviews/2026-09-05-specification-closure.md)
records the final rerun, current test evidence, and source-spec conformance.

The enduring gates are `pnpm build`, `pnpm typecheck`,
`TZ=America/New_York pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`,
and `pnpm knip`. Runtime assertions run in the test suite; package declarations
are checked by the ordinary TypeScript projects. The retired proposal gate was
never a substitute for these checks.
