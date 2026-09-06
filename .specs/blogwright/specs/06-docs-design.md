# Documentation design

**Status:** Draft · **Date:** 2026-09-06 · **Owner:** Ant Stanley · **Scope:** Documentation site

Read first: [global design guidelines](../../design-guidelines.md) and
[development guidelines](../../../DEVELOPMENT.md).
This page records the documentation surface's local conventions and current
implementation. Shared acceptance policy remains inherited.

## Context and visual foundations

The site serves people installing, operating and troubleshooting Blogwright.
Starlight owns navigation and the reading shell. [Configuration](../../../docs/astro.config.mjs)
selects the existing logo/favicon assets and local component overrides;
[styles](../../../docs/src/styles/custom.css) own indigo theme accents, neutral
card-icon boundaries, text wrapping and focus styling for scroll regions.
The dashboard's palette is not copied into this reading surface.

Typography and content hierarchy retain Starlight's reading conventions. Homepage
cards group product capabilities; the primary Get started action leads to the
introduction. Existing Getting started, Guides and Reference routes remain intact.

## Navigation and reading

Starlight supplies skip navigation, mobile navigation, search and theme selection.
The [mobile-menu override](../../../docs/src/components/MobileMenuToggle.astro)
mirrors the custom element's expanded state to its button; Starlight retains
responsibility for opening, Escape dismissal, focus return and background inertness.
Browser tests exercise menu/search entry, dismissal and focus return.

The [Markdown override](../../../docs/src/components/MarkdownContent.astro) makes
code blocks and tables focusable so keyboard users can scroll overflow. Tables
without captions or accessible labels receive a name derived from column headers.
Existing semantics and code examples remain intact. Focused scroll regions have a
visible outline; prose and long labels wrap without widening page chrome.

## Content and UX voice

The homepage uses direct product descriptions. Links and code samples retain their
existing targets and commands. Functional indigo accents remain in links, active
navigation and controls; card icons use neutral decoration. No unrelated brand
or new navigation hierarchy is introduced.

Markdown exports and `llms.txt` remain reading surfaces for machine consumers.
Browser acceptance checks representative exported routes alongside rendered pages.

## Design definition of done

Inherit shared design acceptance and apply these local checks:

| Surface/state | Expected result | Evidence |
| --- | --- | --- |
| Homepage, introduction, quickstart, configuration, troubleshooting | Titles, readable content, usable links and no page overflow | Built-site browser checks and sampled accessibility scans |
| Mobile menu | Button expanded state matches the visible menu; Escape closes and restores focus | Keyboard interaction in three engines |
| Search | Results/no-results are distinct; Escape returns focus | Built search index and keyboard tests; spoken announcements need manual review |
| Code and tables | Full content remains available through focusable scroll regions | Keyboard focus/scroll tests and reference-table screenshot |
| Light/dark and narrow/wide | Local identity and accessible content survive adaptation | 320/390/768/1440 Linux snapshots plus text-spacing checks |
| Machine-readable output | Existing exported URLs remain available | HTTP assertions |

The [acceptance report](../../reviews/2026-09-06-accessibility-acceptance.md) distinguishes
sampled browser evidence from untested manual criteria. The permanent suite does
not establish full WCAG conformance or screen-reader behavior.

## Assumptions and open questions

**Assumptions**

- Upstream Starlight behavior remains subject to verification after dependency updates.

**Decisions**

- *Identity.* **Retained Starlight and the indigo brand.** Scoped overrides address
  measured barriers while preserving navigation and reading conventions.
- *Overflow.* **Kept complete content accessible.** Scrollable code/tables retain
  their semantics and gain a keyboard entry point.

**Open questions**

- When will VoiceOver/Safari, NVDA/Firefox, manual zoom/text resize and remaining
  criterion checks in the acceptance report be completed?
