# Design guidelines

**Status:** Draft · **Date:** 2026-09-06 · **Owner:** Ant Stanley · **Scope:** Repo-wide

These guidelines govern changes to human-facing visual interfaces. They do not
impose a shared brand on the documentation site and the operational dashboard.
Read [development guidelines](../DEVELOPMENT.md) for toolchain and code rules.

## Context and authority

A requested UI change should preserve established visual foundations unless its
brief calls for a new direction. Local styles own exact values; package design
pages record surface-specific conventions. Observed implementation is evidence,
not proof of brand intent or accessible rendered behavior.

This page preserves established policy and records current source observations.
It covers the operator dashboard and documentation reading surface. CLI and
backend changes inherit these acceptance checks only when they affect a visual
interface. Consumer sites built by Blogwright retain their own design systems.

| Source | Authority | Evidence scope |
| --- | --- | --- |
| [Dashboard styles](../packages/analytics/app/src/app.css) | Dashboard theme roles, typography, layout and component styling | Current CSS inspected; rendered behavior not verified by this update |
| [Documentation configuration](../docs/astro.config.mjs) | Starlight shell, navigation groups and logo selection | Current configuration inspected |
| [Documentation styles](../docs/src/styles/custom.css) | Documentation accent overrides and prose wrapping | Current CSS inspected; contrast comments are not fresh measurements |
| [Development guidelines](../DEVELOPMENT.md) and [CI](../.github/workflows/ci.yml) | Code health requirements and automated gates | Script definitions inspected; these are not visual acceptance tests |

## Visual foundations

Preserve each surface's authoritative styles and component conventions when
extending it. Do not copy a complete token inventory into a spec; exact values
remain in the linked sources.

| Foundation | Reusable convention | Observed implementation |
| --- | --- | --- |
| Color | Use semantic roles for surfaces, readable text, muted explanation, borders, actions and failure feedback | Dashboard uses `--color-surface-*`, `--color-primary` and `--color-danger`; documentation uses Starlight `--sl-color-accent*` overrides |
| Themes | Keep state and information meaning consistent across supported themes | Dashboard supports System, Dark and Light; documentation defines light/dark accent overrides |
| Typography | Preserve the surface's type hierarchy; distinguish headings, controls, explanatory prose and numeric values | Dashboard uses system sans-serif and tabular numeric totals; documentation retains Starlight typography and custom paragraph wrapping |
| Layout | Group related controls and let available width determine wrapping; keep full content accessible | Dashboard uses a bounded grid with a narrow-screen adaptation; documentation retains Starlight navigation and reading layout |
| Shape and depth | Use neutral boundaries to group content; preserve functional overlay elevation | Dashboard panels use neutral borders, while calendar popovers and country dialogs use shadows to distinguish overlays |
| Icons and assets | Retain existing assets and descriptive control names; decorative icons do not replace labels | Dashboard uses Lucide controls; documentation configuration selects the existing Blogwright logo and favicons |

The dashboard's blue palette and the documentation site's indigo accents are
local identities. Neither becomes a required palette for another surface.

## Design principles

- Put the user's primary task before decoration. Group related controls and make
  headings distinguish the page, report, and supporting explanation.
- Keep results honest: retain units, time boundaries, ranking limits, and caveats.
- Use semantic theme roles for text, surfaces, borders, emphasis, and errors.
- Preserve usable controls and readable content as available width changes.

## Borders and decorative accents

Decorative coloured border accents are prohibited across project interfaces.
Do not add coloured top or side strips, accent outlines, or coloured edge shadows
to cards, charts, panels, or sections merely to decorate or emphasize them. Use
neutral borders, spacing, typography, and layout to establish hierarchy.

Colour may still communicate a concrete meaning: keyboard focus, selected or
active controls, validation and status feedback, links, and chart data. Such uses
must identify an interaction, state, or value; calling a decorative stripe an
“accent” does not exempt it. Preserve non-colour cues for states and feedback.

## Interaction and adaptation

Use native labeled controls where they meet the task. Keyboard focus must be
visible. Loading, empty, invalid input, and failed requests need distinct text;
color alone must not carry their meaning. Independent reports should remain
usable when another report fails.

Inspect narrow and wide layouts, both supported color schemes, long labels, and
text enlargement. Reflow controls before they become inaccessible. Do not hide
meaningful data to make a layout fit; disclose truncation and provide full values
when abbreviations would otherwise remove access to information.

Operational screens need no decorative motion. Added motion must have a usable
reduced-motion alternative. The dashboard and documentation site target WCAG 2.2
Level AA across applicable full pages and journeys. This is adopted policy, not a
certification. The [acceptance report](reviews/2026-09-06-accessibility-acceptance.md)
records sampled checks and remaining manual evidence. Consumer-generated sites
retain their own design systems and accessibility responsibilities.

| State or pattern | Expected behavior under the existing shared rules |
| --- | --- |
| Loading | Explain that results are pending within the affected report |
| Empty | Identify the absence of data without implying a request failed |
| Error or invalid input | Give distinct, actionable text near the affected task; preserve access to independent results |
| Success | Show the result with its units and scope; do not invent freshness claims |
| Selected or focused | Provide a perceivable state beyond color alone and retain visible keyboard focus |
| Abbreviated content | Keep full labels and values available through the surface's established disclosure pattern |

Accessibility acceptance applies to the affected journey, including navigation,
filter entry, chart-data disclosure and overlays where present. Native controls
and component libraries provide implementation evidence, not proof of keyboard
usability or assistive-technology behavior. Record focus movement, accessible
names and feedback during interaction review, separately from visual inspection.

## Motion

Operational motion communicates an interaction or state change. The dashboard's
[shared pill radios](../packages/analytics/app/src/lib/PillRadio.svelte) use a
180ms selection transition with a reduced-motion override; pie-chart transitions
are defined in the dashboard styles. These are observed local choices, not a
repo-wide duration requirement. The reduced-motion rule above is project policy,
not a claim about a particular accessibility conformance level.

## Content and UX voice

Use direct, descriptive labels. State what a result measures and what a user can
change. Preserve actionable server errors without replacing them with an empty
success state. Avoid implying live data or freshness without supporting metadata.

## Design definition of done

| Requirement | Surface/state and expected result | Evidence | Enforcement |
| --- | --- | --- | --- |
| Decorative borders | No ornamental coloured edges, stripes, or edge shadows; functional colour has an identifiable meaning | CSS/source inspection and rendered review | Manual |
| Hierarchy | Main task, controls, and report headings remain distinguishable | Rendered review | Manual |
| Reflow | Narrow/wide layouts retain controls and meaningful content | Browser at representative widths and text enlargement | Manual |
| Themes | Text, focus, and failure feedback remain legible in supported themes | Light/dark render and keyboard inspection | Manual |
| States | Loading, empty, error, and success are distinguishable | Controlled fixture interactions | Manual |
| Meaning | Units, caveats, and abbreviated data remain available | Source and rendered review | Manual |
| Keyboard and semantics | Affected controls have meaningful names and visible focus; interaction follows a usable order | Keyboard activation, focus inspection and assistive-technology checks for affected journeys | Manual; library usage alone is insufficient |
| Overlays | Review entry, focus containment where modal, dismissal and return to the invoking task | Open and close the affected dialog or popover using the keyboard | Manual |
| Content extremes | Long labels, paths, values and enlarged text retain access to information | Representative content fixtures, zoom and narrow/wide rendered review | Manual |
| Motion | Changed motion retains a usable reduced-motion alternative | Interaction with normal and reduced-motion preferences | Manual |
| Code health | UI change passes repository checks | Commands in development guidelines | Existing build/typecheck/test/lint/format/knip scripts |

Browser checks use Playwright 1.63.0 and axe integration. `pnpm test:ui` exercises
Chromium, Firefox and WebKit journeys at narrow/wide widths; `pnpm test:a11y` scans
sampled states in both themes. Exact screenshot comparisons run in pinned Linux
ARM64 at 320, 390, 768 and 1440 CSS pixels. Unexpected differences and scanner
violations fail; the ordinary commands do not create or update baselines. Reference
updates require visual review and an explanation. These checks supplement manual
acceptance; see [the harness](../tests/browser/README.md) for commands and scope.

Automated code checks do not establish visual usability. Missing browser evidence
must be reported as a limitation, not recorded as a passing design check.

For each applicable check, record the revision, route, state, browser/platform,
viewport, zoom, theme and motion preference; include assistive technology and
version when used. Label results `verified`, `failed`, `not tested`, or
`not applicable` with a rationale. A missing tool or missing observation is
`not tested`. A documented barrier remains a failure of the applicable rule.
Keep revision-specific screenshots and results in task/review artifacts, separate
from this reusable policy. Sampled checks do not certify the whole product.

## Assumptions and open questions

**Assumptions**

- Each existing interface can retain its own identity within shared interaction rules.

**Decisions**

- *Decorative accents.* **Ban coloured border decoration repo-wide.** Explicitly
  requested after removing the traffic chart’s coloured top border. This is a
  design-review requirement, not an automated lint rule or a claim that every
  existing surface has been audited.

- *Scope.* **Shared discipline, local identity.** This task refines an existing
  dashboard; it does not rebrand unrelated surfaces.

- *Sources.* **Retained existing theme authorities.** This update documented the
  dashboard and documentation foundations without introducing another token set.
- *Evidence.* **Separated policy from observations.** Source inspection supports
  implementation descriptions; browser and interaction checks support usability claims.

- *Accessibility target.* **Adopted WCAG 2.2 AA for maintained web surfaces.**
  The accepted change adds browser evidence while keeping incomplete manual checks explicit.

**Open questions**

- *Manual acceptance.* Who will complete VoiceOver/Safari and NVDA/Firefox journeys,
  manual zoom/text resize, and the remaining criterion checks in the acceptance report?
  These checks remain unverified; sampled automation does not establish conformance.
