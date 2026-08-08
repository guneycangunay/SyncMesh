# ADR 0001: Deterministic field registers over silent object replacement

- Status: Accepted
- Date: 2026-08-08

## Context

Whole-document last-write-wins loses unrelated offline edits. Multi-value registers preserve every concurrent value but push complexity into all readers. A reference engine needs a convergent default while still exposing conflict evidence.

## Decision

Use one register per top-level field. Causal order takes precedence. Concurrent values are resolved by a total order over hybrid timestamp, actor, and mutation ID; the losing operation is recorded in a conflict log.

## Consequences

- Disjoint offline edits merge naturally.
- Every replica materializes the same document independent of delivery order.
- Automatic resolution may not match business intent for sensitive fields.
- Nested objects remain atomic unless a schema layer maps their paths to fields.
- Products can build review flows from the conflict log without blocking ordinary reads.
