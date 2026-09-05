# Analytics dashboard design

**Status:** Active · **Date:** 2026-09-05 · **Owner:** Ant Stanley · **Scope:** Analytics dashboard

Read first: [global design guidelines](../../design-guidelines.md) and
[analytics contracts](04-analytics.md).

## Context and visual foundations

The dashboard helps a site operator inspect traffic for a UTC date range.
[App styles](../../../packages/analytics/app/src/app.css) own exact values and
LayerChart aliases. The observed implementation uses system sans-serif typography,
a blue accent, neutral bordered surfaces, and automatic light/dark colors. These
incumbent choices are preserved for this refinement; they are not a newly approved
repo-wide brand. A different visual direction remains an open product choice.

The reusable hierarchy is page heading, reporting controls, report heading, and
muted measurement explanation. Use the accent for emphasis and keyboard focus;
use the error role for failures in both themes. Border and spacing separate
surfaces without decorative shadows or imagery. Numeric totals use tabular figures.

## Reporting surface

[Page composition](../../../packages/analytics/app/src/routes/+page.svelte) keeps
all seven reports and places the primary traffic chart across the grid. Other
reports occupy two columns on larger screens and one column on narrow screens.
Filters wrap; date fields share a row and the bot selector receives a full row on
narrow screens. The reporting window explicitly identifies UTC.

[Query panels](../../../packages/analytics/app/src/lib/QueryPanel.svelte) reserve
more height for ranked results. Server-provided row meanings remain visible,
including the distinction between summed daily uniques and distinct visitors
across a date range. Ranking order and the top-twelve disclosure remain intact.
Expandable native disclosures expose the plotted values and full labels in semantic
tables. Chart interaction layers are contained within their report at zoom.
Report errors do not block other panels. Invalid dates suppress requests and show
a single message near the controls.

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
