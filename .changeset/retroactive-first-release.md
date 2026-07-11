---
"blogwright": minor
"blogwright-core": minor
"blogwright-pds": minor
---

First changesets-managed release, recapping the 0.1.x line and shipping a real
package README.

New in this release:

- A full getting-started README on the `blogwright` npm package (the npmjs page
  previously showed a three-line stub): requirements, the
  `init` → `bootstrap` → `deploy` path, a command reference, configuration
  with the non-Astro knobs, a copy-paste OIDC CI workflow, and output modes.

Recap of what 0.1.0 shipped, for the changelog record:

- **Deploy any static site**: `paths.app`/`paths.dist` for monorepo apps,
  `spa: true` for client-side-routing fallback, and `sourceInclude` for
  pre-built gitignored artifacts (wasm bundles built in CI) — alongside the
  original Astro-shaped defaults.
- **A CLI that helps**: `blogwright init` first-run wizard, live MicroVM build
  progress, a deploy summary card, `status` as a drift tree, `history` with a
  `← live` marker — pretty on a TTY, stable plain text for CI and agents
  (`--plain`, `NO_COLOR`).
- **Hexagonal internals**: every side effect behind a port (filesystem,
  terminal, VCS, network), enforced by lint; the standard.site integration
  extracted into `blogwright-pds` with the `blogwright/rkey` contract intact.
- **A full-project review's worth of hardening**: devDependencies install
  correctly in MicroVM builds, domains added after bootstrap attach to the
  existing distribution, OIDC trust policies reconcile on `githubRepo` change,
  concurrent deploys can no longer destroy the standard.site OAuth session,
  wrong-region S3 responses fail loudly, and JSONC configs accept trailing
  commas.
