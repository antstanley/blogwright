# Changesets

Every user-facing change ships with a changeset: run `pnpm changeset`, pick the
affected packages and semver impact, and write a one-line summary — it becomes
the CHANGELOG entry. The three publishable packages are version-fixed, so any
bump moves `blogwright`, `blogwright-core`, and `blogwright-pds` together.

Accumulated changesets are consumed by the "Version Packages" PR that
`.github/workflows/version-pr.yml` maintains; merging it bumps versions and
writes changelogs. Tagging that commit (`git tag vX.Y.Z && git push origin
vX.Y.Z`) triggers the staged npm release (see README §Releasing).
