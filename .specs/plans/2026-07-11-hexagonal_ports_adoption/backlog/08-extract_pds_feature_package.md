# Task 08 — Extract the PDS feature package

**Plan:** [plan.md](../plan.md)

**Implements:** [DEVELOPMENT.md §Hexagonal architecture — ports and adapters](../../../../DEVELOPMENT.md) (dependency direction; feature packages own their domain) and §Clean Code — the pervasive style (single responsibility at package granularity)
**Depends on:** 01, 03, 05, 07
**Produces:** the standard.site integration lives in its own publishable package `blogwright-pds` (`packages/pds`); the CLI consumes it as a dependency and keeps the `blogwright/rkey` subpath export working via re-export
**Pointers:** `packages/cli/src/pds/` (the modules to move), `packages/cli/package.json` (`exports["./rkey"]`), `packages/cli/src/cli.ts` (`runPds` dispatch), `packages/cli/src/commands.ts` (`syncAfterDeploy` call in the deploy path), `knip.json`, `.github/workflows/publish.yml`

## Steps

- [ ] Create `packages/pds` (`blogwright-pds`, publishable, version matching core/cli) and move `packages/cli/src/pds/*` — sources and tests — into it, depending only on `blogwright-core` (ports, config types, secrets client) and `@atproto/oauth-client-node`.
- [ ] Define the package's narrow dependency surface (config, secrets client, logger, `FileSystem`/`Terminal` ports, repo root) in its own types; the CLI adapts `OpsContext` to it at the dispatch boundary — the package never imports CLI types.
- [ ] Rewire the CLI: `runPds` and `syncAfterDeploy` import from `blogwright-pds`; `blogwright/rkey` re-exports from the new package so the consuming-site contract is unchanged.
- [ ] Update the workspace plumbing: root tsconfig references if any, `knip.json`, CI (build order via workspace deps), and the publish workflow (recursive publish picks the package up).
- [ ] Extend the task 07 lint scoping so the new package's domain/adapter split is enforced the same way.
- [ ] Update README's Packages table and DEVELOPMENT.md (package list in §Error handling table and the closing-block assumption about the package split).

## Definition of done

- [ ] `packages/cli/src` contains no `pds/` directory; all moved tests pass unchanged in `blogwright-pds`.
- [ ] The pinned rkey vectors are byte-identical and `blogwright/rkey` still resolves for consumers (`npm pack --dry-run` on the CLI shows the same export surface).
- [ ] `blogwright-pds` imports nothing from `blogwright`; the dependency arrow points CLI → pds only.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm build && pnpm test`; inspect `packages/pds/package.json` and the CLI's `rkey` re-export; confirm `pnpm exec blogwright pds --help` output is unchanged.
