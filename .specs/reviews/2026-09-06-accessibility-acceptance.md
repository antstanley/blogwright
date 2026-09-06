# Dashboard and documentation accessibility acceptance

**Status:** Draft · **Date:** 2026-09-06 · **Owner:** Ant Stanley · **Scope:** Dashboard and docs implementation

Source: [accepted change](../changes/2026-09-06-accessibility_visual_tests_and_docs.md).
This record separates code and browser evidence from manual acceptance. The
change remains Accepted while required manual checks are incomplete; this is not
a WCAG conformance declaration. The PR containing this record identifies the exact
implementation commit; the starting revision was `2116d27a`.

## Environment and repeatable evidence

| Environment | Scope |
| --- | --- |
| macOS, Playwright 1.63.0 | Chromium, Firefox and WebKit keyboard/pointer journeys at 390 and 1440 CSS pixels; macOS WebKit uses Option-Tab to traverse links |
| Linux ARM64, Ubuntu Noble | Chromium screenshot baselines at 320, 390, 768 and 1440 CSS pixels in light/dark themes |
| Container | `mcr.microsoft.com/playwright@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27` |
| Automated accessibility | axe-core via `@axe-core/playwright` 4.13.0, WCAG A/AA tags through 2.2, Chromium light/dark states |
| Data/preferences | Synthetic AnalyticsQuery adapter; clock 2026-09-06T12:00:00Z, en-GB, UTC; reduced motion explicitly tested |
| Manual assistive technology | VoiceOver/Safari and NVDA/Firefox not tested; no results are inferred from browser accessibility trees |

[Test harness](../../tests/browser/README.md) documents commands, fixture paths,
reference images and failure artifacts. Local HTML reports and traces are generated
under ignored output directories; CI uploads both suites for 14 days. Screenshot
baselines are committed with the tests. Linux comparisons use exact pixels.

## Baseline findings and fixes

| Finding | Evidence before change | Implementation and verification |
| --- | --- | --- |
| Drag-only chart window | ViewsArea exposes a brush and Reset but no equivalent selection inputs | Both explicit UTC inputs and brush call `showWindow`; tests compare bounds, visible chart window, unchanged query traffic and retained table rows |
| Unassociated validation | Path validation appears in a separate alert without invalid state or error description linkage | Path and date groups reference the reporting error; browser test checks invalid Path and recovery |
| Small date segments | axe reports segments about 15px wide, below applicable target-size/spacing requirements | 24px minimum segment targets; fields stack at narrow widths; both themes and open calendar scanned |
| Partly obscured date target | Open calendar leaves a narrow exposed portion of the next date field | End-aligned calendar avoids slicing that field; open-calendar scan checks the rendered result |
| Inaccessible reference overflow | axe identifies a scrollable reference table without a keyboard entry point | Markdown override gives tables and code blocks keyboard focus; tests exercise focus and scrolling |
| Docs menu state | Keyboard test opens the menu while the button's aria-expanded remains false | Override mirrors Starlight's actual menu state to the button; open/close/focus-return checks cover narrow layouts |
| Decorative docs icon borders | Homepage render uses unrelated coloured icon borders without state meaning | Neutral borders/backgrounds preserve the local indigo brand in functional elements |
| Text-spacing overflow | Narrow dashboard with expanded spacing overflows date controls | Responsive stacked label/field layout; test retains control access without page overflow |

## Criterion inventory

`verified` below means the named sampled check passed, not that a whole criterion
is proven across every page. `not tested` marks remaining manual or exhaustive
coverage. Each applicable criterion still needs full-page/process evaluation before
claiming conformance. The target is [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/).

| Criteria | Applicability and evidence disposition |
| --- | --- |
| 1.1.1 | Charts/icons/logo: named controls and full data tables checked in sampled browser states; complete equivalent-text review not tested |
| 1.2.1–1.2.5 | Not applicable to sampled maintained pages: no audio/video media; new content requires reevaluation |
| 1.3.1, 1.3.2 | Headings, table headers, labels, reading order: automated scans and table interactions verified; screen-reader reading order not tested |
| 1.3.3 | Text labels and UTC instructions inspected; complete content audit not tested |
| 1.3.4 | Responsive widths verified; physical-device orientation changes not tested |
| 1.3.5 | Not applicable: no forms collecting personal information in these journeys |
| 1.4.1 | Chart series labels/tables and selected-state semantics checked; complete non-colour review not tested |
| 1.4.2 | Not applicable: no automatically playing audio |
| 1.4.3, 1.4.11 | Sampled theme scans and renders checked; exhaustive graphical/non-text contrast measurement not tested |
| 1.4.4 | Manual 200% text resize not tested |
| 1.4.5 | Source and sampled renders use real text for reading/controls; complete image-content inventory not tested |
| 1.4.10 | 320px reflow and bounded reference overflow checked; manual 400% browser zoom from 1280px not tested |
| 1.4.12 | Automated text-spacing overrides verified; full manual review of enlarged content not tested |
| 1.4.13 | Chart hover/focus disclosures: complete dismissibility, hoverability and persistence review not tested |
| 2.1.1, 2.1.2 | Filters, menu/search, country dialog, chart window, table access and dismissal checked; full keyboard traversal not tested |
| 2.1.4 | No single-character shortcuts identified in sampled journeys; exhaustive dependency behavior not tested |
| 2.2.1 | Not applicable to sampled journeys: no user-interaction time limit |
| 2.2.2 | No auto-refreshing reporting period or persistent animated reading content; full motion inventory not tested |
| 2.3.1 | No flashing content identified; formal flashing analysis not tested |
| 2.4.1 | Docs skip link traversal and activation checked; complete bypass behavior not tested |
| 2.4.2, 2.4.4, 2.4.6 | Sampled titles, link purpose, headings and labels checked; complete docs-content review not tested |
| 2.4.3, 2.4.7, 2.4.11 | Dialog/menu focus return and sampled focus visibility checked; full focus-order/obscuration review not tested |
| 2.4.5 | Docs sidebar, search and in-page links provide multiple routes; dashboard is a single page |
| 2.5.1, 2.5.7 | Explicit UTC chart-window inputs provide equivalent pointer/keyboard selection; drag equivalence checked |
| 2.5.2 | Native buttons and controls used; full pointer-cancellation review not tested |
| 2.5.3 | Visible labels and accessible names scanned in sampled states; voice-control evaluation not tested |
| 2.5.4 | Not applicable: no device-motion operation |
| 2.5.8 | Sampled target-size scans, including date popover, checked; full maps/legends/small-territory target review not tested |
| 3.1.1 | Document language scanned; content-level verification not tested |
| 3.1.2 | Not applicable to sampled English prose; foreign-language passages in future docs need language markup |
| 3.2.1, 3.2.2 | Focus/open/close and explicit query actions checked; full predictability evaluation not tested |
| 3.2.3, 3.2.4 | Shared Starlight navigation and labels retained across sampled routes; exhaustive comparison not tested |
| 3.2.6 | No repeated dedicated help mechanism added; consistency across complete docs content not tested |
| 3.3.1–3.3.3 | Associated errors, clear chart-window validation and recovery checked; screen-reader announcements not tested |
| 3.3.4 | Not applicable: no legal/financial submissions or destructive user-data operations in these web journeys |
| 3.3.7 | Not applicable: no multi-step process requiring redundant data entry |
| 3.3.8 | Not applicable: neither maintained web surface has an authentication flow |
| 4.1.2 | Sampled roles/names/states scanned and menu expanded-state regression checked; assistive-technology behavior not tested |
| 4.1.3 | Loading/empty/error/status regions inspected; actual screen-reader announcements not tested |
| Reduced motion (project policy) | Pill transition becomes 0s with reduced-motion preference; source retains pie override; this policy is stronger than an AA motion claim |

## Patch verification

### Automated results

| Check | Result |
| --- | --- |
| Production build, typecheck, lint, formatting, knip | Passed; existing lint warnings remain |
| Package tests | 1,777 passed, one existing skip |
| Linux UI gate | 81 passed, four intentional non-Chromium clipboard skips |
| Accessibility gate | Four state/route suites passed |
| Final Linux screenshot stability | All 16 visual tests passed twice with exact-pixel comparison (32 reference images) |
| Final keyboard table-scroll check | Six browser/viewport combinations passed, including actual horizontal scroll where content overflows |
| Intentional semantic regression | An unlabeled button caused the expected `button-name` violation |
| Intentional image regression | A changed background caused the expected screenshot mismatch |

The deliberate regressions ran only in an isolated container copy; the original
test file was restored afterward. Initial tall-table element captures included a
sticky-header artifact. Final reference-table captures use the focused table's
viewport, with no increase in pixel tolerance.

Function resolution: both `ViewsArea.applyWindow` and the LayerChart brush callback
call the component-local `showWindow`. It changes only local domain, form and status
state. Neither path calls `runNamedQuery`. QueryPanel owns requests and keys the
chart by each new result, so refresh/granularity/filter changes reset chart zoom.
`resetZoom` clears local state without changing the reporting range or table.

Sufficiency: the form selects arbitrary supported bounds, rather than offering only
Reset. New validation rejects inverted/sub-bucket ranges and permits correction.
Docs overrides retain upstream components; the menu observer changes the button's
semantic state while Starlight continues to own focus, inertness and dismissal.

Regression paths: tests retain complete chart tables, assert no query on local
zoom, check requests after filter/refresh/granularity changes, and exercise docs
routes, search, machine-readable exports and clipboard behavior. Existing package
tests protect query/UTC semantics. Manual accessibility completeness remains open.

VERDICT: CONCERNS
CONFIDENCE: high
SUMMARY: The implemented paths have automated regression evidence, but full design acceptance requires the manual checks listed here.

## Assumptions and open questions

**Assumptions**

- Synthetic traffic is adequate for UI regression checks, not evidence of live AWS integration.
- The pinned container and committed lockfile remain the reference rendering environment.

**Decisions**

- *Evidence.* **Kept manual gaps visible.** Automated checks cannot stand in for VoiceOver or NVDA results.
- *Scope.* **Preserved the accepted target.** Missing evidence does not lower WCAG requirements or mark the change complete.

**Open questions**

- Who will complete VoiceOver/Safari on macOS and NVDA/Firefox on Windows for both journeys?
- When will manual 200% resize, 400% zoom, full focus traversal and remaining criterion checks be recorded?
