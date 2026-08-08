import type { JsonValue } from "./canonical.js";
import { assertJsonValue, contentHash } from "./canonical.js";
import { compareTimestamps, HybridLogicalClock, validateTimestamp } from "./hlc.js";
import type {
  ConflictRecord,
  FieldPatch,
  MaterializedDocument,
  Mutation,
  MutationPayload,
  Register,
  ReplicaSnapshot,
} from "./model.js";
import type { VectorClock } from "./vector-clock.js";
import {
  clockCovers,
  compareClocks,
  incrementClock,
  mergeClocks,
  validateClock,
} from "./vector-clock.js";

interface DocumentState {
  readonly fields: Map<string, Register>;
}

export type PhysicalClock = () => number;

export class Replica {
  private frontier: VectorClock = {};
  private readonly operations = new Map<string, Mutation>();
  private readonly documents = new Map<string, DocumentState>();
  private readonly conflictLog = new Map<string, ConflictRecord>();
  private readonly logicalClock: HybridLogicalClock;

  public constructor(
    public readonly actor: string,
    private readonly physicalClock: PhysicalClock = Date.now,
  ) {
    validateActor(actor);
    this.logicalClock = new HybridLogicalClock(actor);
  }

  public change(
    documentId: string,
    values: Readonly<Record<string, JsonValue>>,
    remove: readonly string[] = [],
  ): Mutation {
    validateDocumentId(documentId);
    const changes: Record<string, FieldPatch> = {
      $deleted: { kind: "set", value: false },
    };
    for (const [field, value] of Object.entries(values)) {
      validateField(field);
      assertJsonValue(value, field);
      changes[field] = { kind: "set", value: structuredClone(value) };
    }
    for (const field of remove) {
      validateField(field);
      if (field in values) throw new TypeError(`field ${field} cannot be set and removed together`);
      changes[field] = { kind: "remove" };
    }
    if (Object.keys(changes).length === 1 && remove.length === 0) {
      throw new TypeError("change must set or remove at least one user field");
    }
    return this.createMutation(documentId, changes);
  }

  public delete(documentId: string): Mutation {
    validateDocumentId(documentId);
    return this.createMutation(documentId, { $deleted: { kind: "set", value: true } });
  }

  public apply(mutation: Mutation): boolean {
    validateMutation(mutation);
    if (this.operations.has(mutation.id)) return false;

    this.logicalClock.observe(mutation.timestamp, this.physicalClock());
    const document = this.documents.get(mutation.documentId) ?? { fields: new Map() };
    this.documents.set(mutation.documentId, document);

    for (const [field, patch] of Object.entries(mutation.changes)) {
      const candidate: Register = {
        operationId: mutation.id,
        clock: structuredClone(mutation.clock),
        timestamp: structuredClone(mutation.timestamp),
        removed: patch.kind === "remove",
        value: patch.kind === "set" ? structuredClone(patch.value) : undefined,
      };
      const current = document.fields.get(field);
      if (!current) {
        document.fields.set(field, candidate);
        continue;
      }

      const relation = compareClocks(candidate.clock, current.clock);
      if (relation === "after") {
        document.fields.set(field, candidate);
      } else if (relation === "concurrent" || relation === "equal") {
        const winner = compareRegisters(candidate, current) > 0 ? candidate : current;
        const loser = winner === candidate ? current : candidate;
        document.fields.set(field, winner);
        if (relation === "concurrent") this.recordConflict(mutation.documentId, field, winner, loser);
      }
    }

    this.operations.set(mutation.id, structuredClone(mutation));
    this.frontier = mergeClocks(this.frontier, mutation.clock);
    return true;
  }

  public applyAll(mutations: readonly Mutation[]): number {
    let applied = 0;
    for (const mutation of mutations) if (this.apply(mutation)) applied += 1;
    return applied;
  }

  public get(documentId: string): MaterializedDocument | undefined {
    const state = this.documents.get(documentId);
    if (!state) return undefined;
    const deletion = state.fields.get("$deleted");
    if (deletion?.value === true && !deletion.removed) return undefined;

    const fields: Record<string, JsonValue> = {};
    let clock: VectorClock = {};
    for (const [field, register] of [...state.fields.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      clock = mergeClocks(clock, register.clock);
      if (!field.startsWith("$") && !register.removed) fields[field] = structuredClone(register.value!);
    }
    return { id: documentId, fields, clock };
  }

  public summary(): VectorClock {
    return structuredClone(this.frontier);
  }

  public changesSince(peerFrontier: VectorClock): Mutation[] {
    validateClock(peerFrontier);
    return [...this.operations.values()]
      .filter((mutation) => !clockCovers(peerFrontier, mutation.clock))
      .sort(compareMutations)
      .map((mutation) => structuredClone(mutation));
  }

  public conflicts(): ConflictRecord[] {
    return [...this.conflictLog.values()]
      .sort((left, right) => conflictKey(left).localeCompare(conflictKey(right)))
      .map((conflict) => structuredClone(conflict));
  }

  public snapshot(): ReplicaSnapshot {
    return {
      format: 1,
      actor: this.actor,
      frontier: this.summary(),
      mutations: this.changesSince({}),
    };
  }

  public static restore(snapshot: ReplicaSnapshot, physicalClock: PhysicalClock = Date.now): Replica {
    if (snapshot.format !== 1) throw new TypeError("unsupported snapshot format");
    const replica = new Replica(snapshot.actor, physicalClock);
    replica.applyAll(snapshot.mutations);
    if (compareClocks(replica.summary(), snapshot.frontier) !== "equal") {
      throw new TypeError("snapshot frontier does not match its mutation set");
    }
    return replica;
  }

  private createMutation(documentId: string, changes: Readonly<Record<string, FieldPatch>>): Mutation {
    this.frontier = incrementClock(this.frontier, this.actor);
    const timestamp = this.logicalClock.tick(this.physicalClock());
    const payload: MutationPayload = {
      documentId,
      actor: this.actor,
      clock: structuredClone(this.frontier),
      timestamp,
      changes: structuredClone(changes),
    };
    const mutation: Mutation = { ...payload, id: mutationId(payload) };
    this.apply(mutation);
    return structuredClone(mutation);
  }

  private recordConflict(
    documentId: string,
    field: string,
    winner: Register,
    loser: Register,
  ): void {
    const record: ConflictRecord = {
      documentId,
      field,
      winnerOperationId: winner.operationId,
      loserOperationId: loser.operationId,
      detectedBy: this.actor,
    };
    this.conflictLog.set(conflictKey(record), record);
  }
}

export function mutationId(payload: MutationPayload): string {
  return contentHash(payload as unknown as JsonValue);
}

function validateMutation(mutation: Mutation): void {
  validateActor(mutation.actor);
  validateDocumentId(mutation.documentId);
  validateClock(mutation.clock);
  validateTimestamp(mutation.timestamp);
  if (mutation.timestamp.actor !== mutation.actor) {
    throw new TypeError("mutation actor and timestamp actor must match");
  }
  if ((mutation.clock[mutation.actor] ?? 0) < 1) {
    throw new TypeError("mutation clock must include its actor");
  }
  const fields = Object.entries(mutation.changes);
  if (fields.length === 0 || fields.length > 256) throw new TypeError("mutation change set is empty or too large");
  for (const [field, patch] of fields) {
    if (field !== "$deleted") validateField(field);
    if (patch.kind === "set") assertJsonValue(patch.value, field);
    else if (patch.kind !== "remove") throw new TypeError(`invalid patch for ${field}`);
  }
  const { id: _id, ...payload } = mutation;
  if (!/^[0-9a-f]{64}$/.test(mutation.id) || mutationId(payload) !== mutation.id) {
    throw new TypeError("mutation content hash is invalid");
  }
}

function compareRegisters(left: Register, right: Register): number {
  return compareTimestamps(left.timestamp, right.timestamp) ||
    left.operationId.localeCompare(right.operationId);
}

function compareMutations(left: Mutation, right: Mutation): number {
  return compareTimestamps(left.timestamp, right.timestamp) || left.id.localeCompare(right.id);
}

function conflictKey(conflict: ConflictRecord): string {
  const operations = [conflict.winnerOperationId, conflict.loserOperationId].sort();
  return `${conflict.documentId}\0${conflict.field}\0${operations.join("\0")}`;
}

function validateActor(actor: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(actor)) {
    throw new TypeError("actor must be a stable identifier of at most 64 characters");
  }
}

function validateDocumentId(documentId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(documentId)) {
    throw new TypeError("document id must contain between 1 and 128 safe characters");
  }
}

function validateField(field: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(field)) {
    throw new TypeError(`invalid or reserved field: ${field}`);
  }
}
