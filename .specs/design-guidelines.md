# Design guidelines

**Status:** Active · **Date:** 2026-09-05 · **Owner:** Ant Stanley · **Scope:** Repo-wide

These guidelines govern changes to human-facing visual interfaces. They do not
impose a shared brand on the documentation site and the operational dashboard.
Read [development guidelines](../DEVELOPMENT.md) for toolchain and code rules.

## Context and authority

A requested UI change should preserve established visual foundations unless its
brief calls for a new direction. Local styles own exact values; package design
pages record surface-specific conventions. Observed implementation is evidence,
not proof of brand intent or accessible rendered behavior.

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
reduced-motion alternative. No formal accessibility conformance level has been
adopted or certified by this document.

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
| Code health | UI change passes repository checks | Commands in development guidelines | Existing build/typecheck/test/lint/format/knip scripts |

Automated code checks do not establish visual usability. Missing browser evidence
must be reported as a limitation, not recorded as a passing design check.

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

**Open questions**

- No repository-wide accessibility conformance target or permanent visual test
  suite has been adopted. Those remain separate decisions.
