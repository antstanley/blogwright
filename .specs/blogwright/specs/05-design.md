# Analytics dashboard design

**Status:** Active · **Date:** 2026-09-05 · **Owner:** Ant Stanley · **Scope:** Analytics dashboard

Read first: [global design guidelines](../../design-guidelines.md) and
[analytics contracts](04-analytics.md).

## Context and visual foundations

The dashboard helps a site operator inspect traffic for a UTC date range.
[App styles](../../../packages/analytics/app/src/app.css) own exact values and
LayerChart aliases. The observed implementation uses system sans-serif typography,
a blue accent, neutral bordered surfaces, and light/dark colors. A pill-shaped three-state control offers Lucide monitor (System), moon (Dark),
and sun (Light) icons. Accessible names and hover titles identify each option;
the group has an accessible Theme label without a visible heading.
System follows live OS preference changes; explicit choices override that preference.
The selection is stored locally per origin and restored on mount. If storage is
unavailable, the choice applies to the current visit and the control explains this. These
incumbent choices are preserved for this refinement; they are not a newly approved
repo-wide brand. A different visual direction remains an open product choice.

The reusable hierarchy is page heading, reporting controls, report heading, and
muted measurement explanation. Use accent colour for chart data, links, selected
controls, and keyboard focus;
use the error role for failures in both themes. Border and spacing separate
surfaces without decorative shadows or imagery. All report panels use neutral
borders, including the primary traffic chart, following the global ban on
decorative coloured edges. Numeric totals use tabular figures.

## Reporting surface

[Page composition](../../../packages/analytics/app/src/routes/+page.svelte) keeps
all seven reports and places the traffic and Countries reports across the grid. Other
reports occupy two columns on larger screens and one column on narrow screens.
Filters wrap as label/field pairs, with labels beside their inputs. On narrow
screens the pairs stack into rows with a shared label-column width. Native date and select
controls share explicit sizing and Lucide calendar/chevron icons to avoid differing
browser chrome; date editing and native picker/select behavior remain available. The reporting window explicitly identifies UTC.

[Query panels](../../../packages/analytics/app/src/lib/QueryPanel.svelte) reserve
more height for ranked results. Server-provided row meanings remain visible,
including the distinction between summed daily uniques and distinct visitors
across a date range. Ranking order and the top-twelve disclosure remain intact.
Expandable native disclosures expose the plotted values and full labels in semantic
tables. Chart interaction layers are contained within their report at zoom.
Report errors do not block other panels. Invalid dates suppress requests and show
a single message near the controls.

Countries opens on an offline Equal Earth map rendered with LayerChart GeoPath.
A Map/Bars radio group switches views without another query. Map colour intensity
uses all country rows and a linear request-count scale; absent/zero values use a
neutral surface. Hover titles and the full country data table expose exact values.
Bars retain the top-twelve ranking and disclosure. Unmatched country codes remain
in the table and are listed below the map. Bundled Natural Earth simplified
boundaries can omit small territories; provenance lives beside the map data.

## Design definition of done

Inherit the global definition and apply these dashboard-specific checks:

| Scope/state | Expected result | Evidence |
| --- | --- | --- |
| 320, 390, 768, 1440 CSS pixels | No page overflow; date and bot controls remain available | Browser inspection |
| Light/dark | Accent, text, borders, and error text remain visible | Rendered review |
| Populated reports | Seven headings; readable trends and ranked rows; UTC and unique-count caveats retained | Synthetic fixtures and screenshots |
| Request changes | Dates and bot mode reach the existing API; invalid range shows one message | Browser request inspection |
| Loading/empty/failure | Independent panels provide distinct feedback | Controlled browser responses |
| Keyboard | Native controls and data disclosure remain reachable with visible focus | Keyboard interaction |

Repository checks cover compilation and existing query behavior, not a permanent
visual snapshot suite. The [task review](../../reviews/2026-09-05-dashboard-design.md) records actual browser evidence separately.

## Assumptions and open questions

**Assumptions**

- Existing system fonts and automatic theme preference remain appropriate defaults.

**Decisions**

- *Treatment.* **Refine the existing surface.** Improve hierarchy and reflow within
  the user's styling request while retaining the incumbent framework and palette.

**Open questions**

- The optional choice of a new editorial or dense dark identity is unconfirmed;
  neither is adopted here.
