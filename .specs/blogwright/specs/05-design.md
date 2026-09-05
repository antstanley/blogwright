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
all seven reports and places the traffic and Countries reports across the grid. Daily unique visitors and Referrers share the next row on larger screens;
Status codes and Cache hit ratio share the final row. Paired reports stack on narrow screens.
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

Views over time uses a LayerChart area chart with a horizontal brush. Dragging
zooms the local chart window; Reset zoom restores the full reporting period.
Brushing does not change the global dates, issue queries, or truncate the table.
A pill-shaped native radio group offers 15m, 1h, 6h, 12h, and 24h (default),
with full-duration accessible labels. The selection highlight slides between
options over 180ms; reduced-motion preference disables that transition. Changing it refetches only Views over time and resets its brush. Buckets
are computed from event timestamps on the server, not interpolated from daily
counts. Intraday axes, tooltips, and the table show UTC bucket start times.
Date axes and the selected-window message use UTC. A new result resets the zoom.

Top paths spans the full grid width, with pie and legend side by side on wide
screens and stacked on narrow screens. It uses a pie chart with the top twelve paths and a summed Other paths
slice for remaining returned rows. Shares use all returned requests as their
denominator. The legend shows full paths, counts, and percentages; the data table
retains every returned path. Zero totals show an empty state.

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

The shared `PillRadio` component owns compact radio styling, sliding selection,
keyboard focus, and reduced-motion behavior. Traffic uses the same component
with All (explicitly including bots), Include bots, and Exclude bots, in a row above the From/To date
inputs in Reporting window. Radio groups remain independent.

Reporting window uses minute-step datetime inputs explicitly labelled UTC. Presets
sit between the Traffic selector and the date/time inputs. Preset
buttons offer 3H, 6H, 12H, 24H, 5D, 1W, 4W, 3M, 6M,
and 1Y. Every activation computes fresh bounds ending at the current UTC
minute, including activation of an already selected preset. Hours/days/weeks are
elapsed durations; months/year use calendar subtraction with month-end clamping.
Manual edits select Custom. Clicking Custom keeps the current bounds for editing.
The initial thirty-day window also selects Custom. Presets do not continuously move while
the report is being read. Exact timestamp bounds apply to all charts; the end is
exclusive. The initial window remains thirty days ending at the current minute.

All traffic displays stacked Non-bot and Bot series in Views over time and every
bar view, including Countries. Colours and series order are shared across charts,
and both contributions remain available in data tables. Pie and map views retain
total values. Include bots shows combined totals; Exclude bots omits flagged rows.
Daily unique keys present in both groups count once as Non-bot. Cache-hit stacks
show each group's cache hits divided by all requests, preserving the overall ratio.
