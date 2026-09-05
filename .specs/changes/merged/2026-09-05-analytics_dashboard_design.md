# Refine analytics dashboard presentation

**Status:** Merged · **Date:** 2026-09-05 · **Owner:** Ant Stanley · **Scope:** Analytics dashboard

## Request and boundaries

The user requested installation of the design-guidelines skill and styling of the
existing dashboard. Preserve its existing blue light/dark palette and system
fonts while refining hierarchy, spacing, narrow-screen behavior, and feedback.
The optional question about a different identity remains unconfirmed; no new
brand is adopted. The skill was installed locally, outside the repository.

## Changes

- Give the traffic report a full-width primary position and group UTC date and
  bot filters in a reporting toolbar.
- Replace the fixed minimum grid width with responsive columns and controls.
- Increase ranked-chart spacing according to plotted row count and reduce tick
  density so narrow charts remain readable.
- Add keyboard focus, semantic error colors, state announcements, and expandable
  tables exposing unshortened labels and exact plotted values.
- Record shared design discipline and local observed foundations in canonical
  pages, preserving server-owned metric descriptions and all seven queries.

## Acceptance and evidence

Use the [dashboard design definition](../../blogwright/specs/05-design.md#design-definition-of-done)
and the existing six repository gates. Synthetic browser fixtures exercise
success, loading, empty, isolated failure, date validation, bot parameters,
keyboard disclosure, and responsive light/dark layouts. They do not establish
live AWS behavior or formal accessibility conformance.

## Canonical merge

The implementation contract is folded into [dashboard design](../../blogwright/specs/05-design.md)
and [global design guidelines](../../design-guidelines.md), indexed from the root and
product specifications. No persisted entity, query API, or JSON schema changes.

## Assumptions and open questions

**Assumptions**

- This is a refinement of the existing UI, not authorization to rebrand other surfaces.

**Decisions**

- *Framework.* **Keep SvelteKit and LayerChart.** No runtime dependency is added.

**Open questions**

- A different visual identity remains optional and unconfirmed.
