import type { JsonValue } from "./canonical.js";
import type { VectorClock } from "./vector-clock.js";

export interface HybridTimestamp {
  readonly wallTime: number;
  readonly counter: number;
  readonly actor: string;
}

export type FieldPatch =
  | { readonly kind: "set"; readonly value: JsonValue }
  | { readonly kind: "remove" };

export interface MutationPayload {
  readonly documentId: string;
  readonly actor: string;
  readonly clock: VectorClock;
  readonly timestamp: HybridTimestamp;
  readonly changes: Readonly<Record<string, FieldPatch>>;
}

export interface Mutation extends MutationPayload {
  readonly id: string;
}

export interface Register {
  readonly operationId: string;
  readonly clock: VectorClock;
  readonly timestamp: HybridTimestamp;
  readonly removed: boolean;
  readonly value: JsonValue | undefined;
}

export interface ConflictRecord {
  readonly documentId: string;
  readonly field: string;
  readonly winnerOperationId: string;
  readonly loserOperationId: string;
  readonly detectedBy: string;
}

export interface MaterializedDocument {
  readonly id: string;
  readonly fields: Readonly<Record<string, JsonValue>>;
  readonly clock: VectorClock;
}

export interface ReplicaSnapshot {
  readonly format: 1;
  readonly actor: string;
  readonly frontier: VectorClock;
  readonly mutations: readonly Mutation[];
}
