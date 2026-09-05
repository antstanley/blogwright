# Task 63 — Close specification coverage and documentation against the integrated code

**Plan:** [plan.md](../plan.md) · **Certificate:** [63-specification_closure-certificate.md](63-specification_closure-certificate.md)

**Implements:** [Plugin spec](../../../changes/merged/2026-07-26-cli_plugin_system.md), [PDS spec](../../../changes/merged/2026-07-26-migrate_pds_to_plugin_system.md), [analytics spec](../../../changes/merged/2026-07-26-analytics_plugin.md): all Merge plan steps; task00 retirement decision and [review reconciliation](../reviews/2026-09-05-historical-coverage.md).
**Depends on:** 20, 30, 58, 60, 61, 62, 64, 65
**Produces:** Internal canonical pages/schema and accurate consumer docs cover all integrated requirements; both pending specs merge with complete evidence and the temporary type-claim gate retires.
**Pointers:** `.specs/README.md`, source specs, `README.md`, `DEVELOPMENT.md`, docs reference/cli.md, analytics README; core exported types, CLI context/discovery tests; plan type-claims/.

**Scope transfer:** this task now owns the unfulfilled closure obligations formerly assigned to tasks 20, 58 and 60; task61 analytics history stays merged. It must not flip any spec while runtime tasks59/60/62/64/65 or its own documentation obligations are incomplete.

## Steps

- [ ] Write internal canonical overview, plugin architecture/contracts, PDS and analytics pages plus a Draft2020-12 canonical-types.schema.json. Describe current code only, including beta.3 fourteen-node observability. Link source/tests and index each page; retain root DEVELOPMENT.md as the rules-of-road source.
- [ ] Fold PluginManifest, PdsConfig, AnalyticsConfig and PageView JSON entities into the schema, distinguishing on-disk optional config from resolved types. TypeScript callable interfaces are documented in prose/source, not misrepresented as JSON values. Carry explicit open questions; do not invent SPI versioning, hooks, aliases, retention configuration or new public API.
- [ ] Correct CLI reference invocation/exit descriptions and document plugin add/list/remove/init/lifecycle, PDS lifecycle, bootstrap warnings and teardown refusal including environments. Update README package/release counts and analytics listing; align DEVELOPMENT.md six-gate baseline and toolchain descriptions.
- [ ] Correct analytics privacy claims in consumer docs: page_views contains no raw viewer IP; failed Firehose objects can retain rawData/c-ip, and the existing CloudWatch log copy is separate. Preserve ProcessingFailed behavior and cite AWS failure-handling documentation. Explain the actual PDS raw validator/consumer resolver and PackageManagerFactory seams.
- [ ] Reconcile historical grouped DoD evidence from the review appendix: prove pluginConfig.foo positive and config.foo negative against exported types, verify bundled-only discovery and sole cliPackageDir source, and explicitly map inherited task58 PARTIAL closure to this task. Preserve old reports rather than overwriting verdicts.
- [ ] Run the 29-claim planning gate once and retain its output, then retire its executable transcriptions/checker (retain a README with retirement rationale and revision evidence). Ordinary typecheck/tests remain the enduring gate; update current index references.
- [ ] Run spec conformance against integrated code and account for every merge-plan step. Only after no required gaps remain, move both pending specs to merged/ with date, fix every incoming/outgoing link, and remove their pending entries; analytics remains merged. Final report must distinguish reviewed historical evidence from freshly executed checks.

## Definition of done

- [ ] Canonical overview/plugin/PDS/analytics pages and schema are indexed and describe implemented contracts, entities, state, fourteen-node pipeline, observability and backfill limits; internal docs confer no supported public SPI.
- [ ] Schema JSON passes Draft 2020-12 meta-validation with valid local references, includes every supplied JSON entity/field with the intended optionality/defaults, and each entity is described in prose. Each source spec Merge plan step maps to a concrete final artifact.
- [ ] CLI reference and README accurately document plugin/PDS invocation, lifecycle, removal/teardown behavior, environment-specific warnings, four publishable packages and six gates; consumer analytics privacy text distinguishes page_views from raw failure/log storage.
- [ ] Historical coverage gaps are explicitly evidenced: positive/negative config typing, bundled-only dispatch and single helper source. Existing historical partial/delta verdicts remain intact, with current closure proved here rather than inherited.
- [ ] The planning type-claim gate passes before retirement; output and rationale are retained, executable duplicate transcriptions/checker retire, and typecheck still checks shipped declarations/tests.
- [ ] Both remaining change specs have Merged status/date in merged/, no pending linked specs remain, all incoming/outgoing Markdown links resolve, and all source requirements map to implemented evidence or explicitly non-required open questions.
- [ ] Meets the repo definition of done: `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip`; user-facing behavior has a changeset, and new assertions are demonstrated failing before the fix or under a reverted mutation.
- [ ] Reviewable: inspect the built CLI help and built docs, run the final conformance/coverage and link/schema checks, and verify every outstanding row of the review report has named evidence and no required gap.

**Current conformance additions:** Tasks 64 and 65 close the discovered normative transform-diagnostic and state-shape-validation gaps. Final canonical prose and evidence must reflect their verified implementation; do not replace those promises with the prior missing behavior.
