# Change: Accessibility, visual regression coverage, and docs-site updates

**Status:** Accepted · **Date:** 2026-09-06 · **Owner:** Ant Stanley · **Target:** Repo-wide visual surfaces

Adopt an accessibility target for the analytics dashboard and documentation site,
update both interfaces to meet it, and add repeatable browser acceptance checks.
The docs-site work includes its rendered pages and navigation, not only internal
specification text. Preserve the incumbent identities and functional behavior.

## Motivation

Shared guidelines define interaction and visual discipline, but leave the formal
accessibility target, browser matrix and permanent visual tests unresolved.
Previous dashboard evidence is historical and does not establish current behavior
or cover the documentation site. The docs workspace currently exposes dev, build
and preview scripts, without its own browser acceptance suite.

Source inspection identifies areas to inspect; it does not establish defects or
conformance. Implementation begins with a current baseline, fixes observed barriers,
and adds checks that detect their recurrence. Implementation is authorized by the user on 2026-09-06. The
[current acceptance report](../reviews/2026-09-06-accessibility-acceptance.md)
records shipped-in-branch code and outstanding manual evidence; this change is
not marked Implemented or Merged while required acceptance remains incomplete.

## Affected spec pages

| Canonical page | Sections and change |
| --- | --- |
| [Design guidelines](../design-guidelines.md) | Interaction and adaptation: Modify accessibility target; Design definition of done: Add automated evidence; Assumptions and open questions: Modify resolved questions |
| [Dashboard design](../blogwright/specs/05-design.md) | Design definition of done: Modify browser coverage and evidence; Context and visual foundations: Modify overlay wording |
| [Development guidelines](../../DEVELOPMENT.md) | Toolchain and Definition of done: Add browser gates; Testing: Modify runner scope |
| [Product overview](../blogwright/specs/00-overview.md) | Detail pages: Add documentation design entry; Scope summary: Modify verification description |
| New `.specs/blogwright/specs/06-docs-design.md` | Add a documentation-specific design page inheriting global guidelines; page does not exist yet |

## Proposed changes

The following blocks are merged-form prose. They become canonical only after the
corresponding implementation and evidence exist. Unmentioned content stays in force.

### Design guidelines → Interaction and adaptation (Modify)

Replace the sentence stating that no formal target has been adopted:

> The dashboard and documentation site target WCAG 2.2 Level AA, covering applicable
> Level A and AA criteria across complete pages and journeys. This target is a
> requirement, not a certification. Known barriers and untested requirements remain
> explicit in acceptance evidence. Reduced-motion alternatives remain additional
> project policy. Consumer-generated sites are outside this repository's UI scope.

### Design guidelines → Design definition of done (Add)

> Automated browser acceptance combines semantic interaction assertions,
> accessibility scans and reviewed screenshot comparisons. Manual keyboard,
> zoom/text-spacing, visual and assistive-technology checks supplement automation.
> A clean scan or unchanged screenshot alone does not establish conformance.
>
> Chromium, Firefox and WebKit run interaction smoke checks at narrow and wide
> widths. Chromium runs accessibility scans in both themes and screenshot
> comparisons in a pinned Linux environment. VoiceOver with Safari on macOS and
> NVDA with Firefox on Windows cover the selected manual journeys; records include
> exact browser, operating-system and assistive-technology versions.
>
> A failing assertion, unexpected screenshot difference or applicable automated
> accessibility violation fails the browser gate. Baseline updates require a
> reviewed explanation; CI does not approve its own new images. Scanner findings
> are triaged rather than hidden by broad exclusions. Confirmed false positives
> have narrowly scoped, documented exclusions and equivalent manual evidence.

### Design guidelines → Assumptions and open questions (Modify)

Replace the three current accessibility-target, automation and verification questions
with the following decision and open question after evidence is collected:

> **Decisions — addition:**
> - *Accessibility acceptance.* **Adopted WCAG 2.2 AA with automated and manual evidence.**
>   Both maintained visual surfaces share the target while retaining their identities.
>
> **Open questions — replacement:**
> - Which remaining barriers or unsupported environments are recorded in the current
>   acceptance report? Missing checks remain unverified and do not imply conformance.

### Dashboard design → Context and visual foundations (Modify)

Replace “Border and spacing separate surfaces without decorative shadows or imagery.”
with:

> Border and spacing separate reporting surfaces. Calendar popovers and country
> dialogs use elevation to distinguish overlays; decorative coloured edges remain
> prohibited by the global guidelines.

### Dashboard design → Design definition of done (Modify)

Retain the existing viewport and report checks. Replace the paragraph claiming there
is no permanent visual suite, and append these requirements:

> Repository browser checks cover deterministic dashboard states and interactions.
> The September 2026 styling review remains historical evidence; the current
> acceptance report identifies the tested revision and environments.
>
> Filters, theme choices, disclosures, country search/detail dialogs and chart
> controls remain usable by keyboard with visible focus. Modal dismissal restores
> focus to the invoking control. Validation identifies the relevant field and
> provides accessible recovery guidance; asynchronous status updates are exposed
> without stealing focus. Full chart values and labels remain available in tables.
>
> Chart-window selection has a keyboard and single-pointer alternative to dragging
> that selects the same bounds. Reset alone is not an equivalent selection control.
> Automated tests exercise the alternative and verify that chart-only zoom leaves
> the global range, API requests and full data table unchanged.
>
> Fixtures cover populated, loading, empty, invalid-input and partial-failure states,
> long paths, country detail, theme-storage failure and reduced motion. Existing UTC,
> traffic-mode, ranking and unique-visitor meanings remain intact.

### Development guidelines → Toolchain (Add)

> Playwright owns browser interaction tests and screenshot comparisons;
> `@axe-core/playwright` supplies automated accessibility scans. Root scripts
> `pnpm test:ui` and `pnpm test:a11y` run against locally built dashboard and docs
> surfaces. The toolchain and browser revisions are locked for reproducibility.
> `pnpm test:ui:update` regenerates reference screenshots for explicit review.
> These commands are separate from package unit tests and do not need AWS access.

### Development guidelines → Testing (Modify)

Replace “vitest is the sanctioned runner; `pnpm test` at the root runs every package.”
with:

> Vitest is the sanctioned package-test runner; `pnpm test` at the root runs every
> package. Playwright is the sanctioned browser-test runner, invoked by the separate
> UI and accessibility scripts. Domain tests continue to substitute at ports;
> browser tests exercise built interfaces against local fixture-backed servers.

### Development guidelines → Definition of done (Add)

> UI changes pass `pnpm test:ui` and `pnpm test:a11y` alongside the existing six
> gates. CI runs the browser commands against local production builds and retains
> failure reports, traces and image diffs for 14 days. Relevant manual design
> evidence accompanies the change; CI cannot replace screen-reader acceptance.
> Unrelated backend changes do not acquire a manual screenshot requirement.

### Product overview → Detail pages (Add)

> Add a row linking `06-docs-design.md`, labelled “Documentation design”, with
> contract “Starlight reading surface, navigation, accessibility and visual acceptance”.

### Product overview → Scope summary (Modify)

Replace the Verification row's contract:

> Six code gates, browser interaction/accessibility/visual checks for both maintained
> interfaces, and scoped manual design acceptance; unit tests retain the existing
> `TZ=America/New_York` execution requirement.

### New documentation design page (Add)

Create `.specs/blogwright/specs/06-docs-design.md` with the standard header,
`Scope: Documentation site`, and Read first links to global design guidelines and
root development guidelines. Its body contains these local contracts:

> **Context and visual foundations:** The documentation site serves people installing,
> operating and troubleshooting Blogwright. Starlight owns the reading shell and
> navigation. `docs/astro.config.mjs` owns configuration, `docs/src/styles/custom.css`
> owns local overrides, and existing logo/favicon assets retain the indigo identity.
> Typography, readable line lengths and content hierarchy support long-form reading.
>
> **Navigation and reading:** The homepage exposes Get started and repository actions.
> Getting started, Guides and Reference retain their routes and sidebar groups.
> Skip navigation reaches main content; mobile navigation and search support keyboard
> entry, dismissal and focus return. Search announces results and no-results feedback.
> Current-page state and link purpose remain understandable without color alone.
>
> **Content conventions:** Headings form a meaningful outline. Code examples retain
> exact commands, accessible copy controls and visible overflow access. Wide tables
> retain headers and full values in bounded scroll regions when two-dimensional
> layout is necessary. Page chrome and prose reflow without horizontal page scrolling.
> Links and callouts communicate their purpose in text; purely ornamental card edges
> are neutral. Meaningful images have alternatives and decorative images add no noise.
>
> **Design definition of done:** Inherit global acceptance. Exercise the homepage,
> introduction, quickstart, configuration reference and troubleshooting pages, plus
> mobile navigation, search results/no results, theme selection and code copying.
> Test long headings, URLs, code and tables in both themes. Keep Markdown exports,
> `llms.txt`, existing URLs and documented CLI commands intact. Record fresh browser
> and assistive-technology evidence for navigation and reading journeys.

The closing block records preservation of the Starlight identity as a decision,
upstream component behavior as an assumption requiring verification, and any
remaining barriers as questions linked to the implementation evidence.

## Implementation notes

1. Inventory rendered dashboard states and docs routes before editing. Map each
   applicable WCAG A/AA criterion to automated/manual evidence or a reasoned
   not-applicable result. This is broader than the sampled regression suite.
2. Update dashboard components and docs templates/styles/content to fix measured
   barriers. Review bundled Starlight cards, callouts, focus styling, mobile shell
   and search output; prefer scoped configuration/CSS or supported overrides over
   replacing the framework. Preserve status-bearing color and existing branding.
3. Add browser tests under a root `tests/browser/` directory with one Playwright
   configuration and separate dashboard/docs projects. Serve production builds on
   loopback; use synthetic analytics fixtures and the docs' built search index.
   Existing entry points are [dashboard fixtures](../../packages/analytics/scripts/dev-dashboard.mjs),
   [docs configuration](../../docs/astro.config.mjs),
   [homepage](../../docs/src/content/docs/index.mdx) and
   [docs styles](../../docs/src/styles/custom.css).
4. Freeze clock, timezone, locale, fixtures, fonts and browser versions for snapshots.
   Use 320, 390, 768 and 1440 CSS-pixel widths in both themes for representative
   layouts; run interaction smoke checks at 390 and 1440 in all three engines.
   Test reduced motion explicitly rather than inferring it from frozen screenshots.
5. Add the proposed scripts and a CI browser job after the required production
   builds. Install matching browsers, wait for server readiness and clean up servers
   on success/failure. Block unexpected external requests during tests. Snapshot
   generation is local/reviewed; CI compares committed baselines and never updates them.
6. Record baseline and post-fix observations under `.specs/reviews/`, including
   revision, routes/states, environment, criterion/rule, artifacts and results.
   Do not publish a public compliance claim based on this sampled evidence.

No persisted entities, public API shapes or canonical JSON Schema types change.

## Acceptance criteria

| Obligation | Required evidence |
| --- | --- |
| Both interfaces updated | Before/after evidence and source changes addressing observed barriers in dashboard and docs; no invented defect list |
| Applicable AA requirements | Criterion inventory and triaged results; no unresolved applicable failures or required checks left untested at completion |
| Visual discipline | Reviewed narrow/wide, light/dark baselines; neutral decorative edges; preserved local identities |
| Adaptation | Manual 200% text resize, 400% zoom at a 1280px starting viewport, and text-spacing checks; bounded exceptions documented |
| Input and overlays | Keyboard and screen-reader evidence for the dashboard filtering/detail journey and docs navigation/search/reading journey |
| Drag alternative | Equivalent chart-window selection without dragging, verified by keyboard and single-pointer tests |
| Regression gates | Both proposed commands pass; temporarily introduced semantic and screenshot regressions are detected, then removed |
| Determinism | Two unchanged runs in the pinned environment pass without image churn |
| Existing behavior | Existing six gates pass; UTC/query meanings, docs routes, code examples and machine-readable exports remain intact |

## Standards and testing references

The normative target is [WCAG 2.2](https://www.w3.org/TR/WCAG22/), including applicable
contrast, reflow, keyboard, focus, input, semantic and feedback criteria. Specific
interaction requirements include [Dragging Movements](https://www.w3.org/TR/WCAG22/#dragging-movements)
and [Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum), with
their stated exceptions; the project does not substitute a universal 44px rule.

Use Playwright's official [accessibility-testing guidance](https://playwright.dev/docs/accessibility-testing)
for scanner integration and its [visual-comparison guidance](https://playwright.dev/docs/test-snapshots)
for screenshot assertions and environment-dependent baselines. These are proposed
new tools, not existing repository enforcement.

## Merge plan

1. Require implementation, acceptance evidence and spec/code review before merging.
2. Apply each Modify/Add block above to its named page and exact section; preserve
   unrelated text. Update meaningful revision dates and link the actual acceptance
   report from local design pages. Do not rewrite historical evidence as current.
3. Create `06-docs-design.md`, including the required header and closing block.
   Index it in `.specs/README.md`, `.specs/blogwright/README.md` and the overview table.
4. Resolve the shared accessibility/automation questions using the implemented
   choices and evidence; preserve any outstanding limitation without claiming a pass.
   No schema merge is required.
5. Mark this change Merged, add the merge date, move it to `changes/merged/`, adjust
   its relative links for the extra directory level, and update the pending/history index.

## Assumptions and open questions

**Assumptions**

- The maintained web surfaces are the analytics dashboard and documentation site;
  consumer sites and external destinations remain outside the implementation scope.
- Manual macOS and Windows assistive-technology environments are available during
  implementation; missing access leaves the corresponding check untested.

**Decisions**

- *Scope.* **Included actual docs-site updates.** The user explicitly requested the
  documentation site alongside accessibility and visual-test coverage.
- *Direction.* **Proposed WCAG 2.2 AA while preserving local identity.** Shared
  acceptance closes the documented target gap without imposing a shared palette.
- *Testing.* **Proposed Playwright plus axe and manual review.** The combination
  checks interaction, rendering and accessibility using distinct evidence.

**Open questions**

- Which barriers will the initial rendered and assistive-technology baseline reveal?
  Record them before implementation; no current defect or passing result is assumed.
