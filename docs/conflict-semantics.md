# Conflict semantics

## Causal comparison

For two field registers `A` and `B`:

- `A > B` in vector-clock order: `A` wins because it observed `B`.
- `A < B`: `B` wins.
- equal clocks and identical operation ID: duplicate delivery.
- concurrent clocks: neither write observed the other; use the deterministic tie-breaker.

## Concurrent tie-breaker

The resolver compares, in order:

1. hybrid timestamp physical milliseconds;
2. hybrid timestamp logical counter;
3. actor ID;
4. content-addressed operation ID.

The final two components make the order total even when devices report identical time. This rule guarantees convergence; it does not claim that the selected value matches human intent. Every concurrent comparison is recorded in the conflict log so a product can offer manual resolution for sensitive fields.

## Clock skew

Vector clocks, not wall clocks, decide causal precedence. A device with a far-future physical clock can still dominate concurrent resolution, so actor provisioning should enforce a skew budget. Hybrid logical clocks prevent local time moving backward from reversing the replica's own ordering.

## Field granularity

Concurrent edits to `name` and `plan` merge without conflict. Concurrent replacements of an entire nested object are one field conflict; SyncMesh does not recursively synthesize a schema. Applications that need nested independent editing should model those paths as separate fields or add a schema-aware patch layer.
