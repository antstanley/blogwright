# Task 65 — Validate persisted state shapes at the S3 boundary

**Plan:** [plan.md](../plan.md) · **Certificate:** [65-core_state_shape_validation-certificate.md](65-core_state_shape_validation-certificate.md)

**Implements:** [DEVELOPMENT.md](../../../../DEVELOPMENT.md) §Where validation lives and §Error handling in TypeScript; [scoped state](../../../changes/merged/2026-07-26-cli_plugin_system.md). This closes a pre-existing baseline violation, not a regression introduced by plugin scoping.
**Depends on:** 4, 16
**Produces:** StateStore.load validates parsed OpsState and ResourceOutputs before callers can execute graphs, preserving valid historical serialized states and missing-object behavior.
**Pointers:** packages/core/src/state.ts and state.test.ts; CLI context and plugin lifecycle consumers; OpsState/ResourceOutputs exported types.

## Steps

- [ ] Parse JSON as unknown and validate the existing OpsState envelope and ResourceOutputs shapes at the StateStore boundary. Use contextual Error with bucket/key and the failed field, without logging state values or inventing a new error hierarchy.
- [ ] Validate existing types only: version is a number, env a string, resources a non-array object mapping node IDs to non-array output objects whose values are strings, numbers, booleans or arrays of strings; updatedAt accepts its declared optional/undefined serialized form. Confirm actual type before implementation.
- [ ] Preserve unknown fields and valid legacy states; do not add version-number, timestamp-format, environment-equality, node-identifier or output-name restrictions not present in the contract. A serialized undefined updatedAt is omitted and must remain accepted.
- [ ] Keep missing bucket/key → empty state and existing malformed-JSON context/cause behavior. Invalid shape throws before any graph work, never falls back to empty state. Cover unscoped and scoped keys, round-trip valid outputs and adversarial shapes.
- [ ] Add changeset, meaningful negative controls for bypassed validation, focused state/context/lifecycle evidence, and all six gates. No external validator dependency.

## Definition of done

- [ ] StateStore.load validates unknown parsed data against the existing OpsState/ResourceOutputs field shapes, including omitted updatedAt, and returns only validated state; invalid envelopes or output shapes raise contextual Error before graph execution.
- [ ] Missing buckets/objects retain existing empty-state behavior, malformed JSON retains contextual cause handling, and shape-invalid state is never converted to empty state; both scoped and unscoped keys are covered.
- [ ] Valid historical serialization, all supported output value types, unknown fields and unconstrained typed version/env/timestamp values remain compatible; no unrequested format, identity or version restrictions are introduced.
- [ ] All six repo gates pass: pnpm build, pnpm typecheck, TZ=America/New_York pnpm test, pnpm lint, pnpm exec oxfmt --check ., pnpm knip. A changeset exists and targeted assertions fail when shape validation is bypassed, then pass after exact restoration.
- [ ] Reviewable: run focused core state and CLI context/plugin lifecycle suites; show invalid stored state cannot reach graph effects, inspect round-trip/default behavior and verify the unchecked JSON.parse-as-state boundary has been removed.
