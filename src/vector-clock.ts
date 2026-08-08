export type VectorClock = Readonly<Record<string, number>>;
export type ClockRelation = "before" | "after" | "equal" | "concurrent";

export function compareClocks(left: VectorClock, right: VectorClock): ClockRelation {
  let leftGreater = false;
  let rightGreater = false;
  const actors = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const actor of actors) {
    const leftValue = left[actor] ?? 0;
    const rightValue = right[actor] ?? 0;
    if (leftValue > rightValue) leftGreater = true;
    if (rightValue > leftValue) rightGreater = true;
  }
  if (leftGreater && rightGreater) return "concurrent";
  if (leftGreater) return "after";
  if (rightGreater) return "before";
  return "equal";
}

export function mergeClocks(...clocks: readonly VectorClock[]): VectorClock {
  const result: Record<string, number> = {};
  for (const clock of clocks) {
    for (const [actor, value] of Object.entries(clock)) {
      result[actor] = Math.max(result[actor] ?? 0, value);
    }
  }
  return result;
}

export function incrementClock(clock: VectorClock, actor: string): VectorClock {
  return { ...clock, [actor]: (clock[actor] ?? 0) + 1 };
}

export function clockCovers(frontier: VectorClock, candidate: VectorClock): boolean {
  return Object.entries(candidate).every(([actor, value]) => (frontier[actor] ?? 0) >= value);
}

export function validateClock(clock: VectorClock): void {
  for (const [actor, value] of Object.entries(clock)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(actor)) {
      throw new TypeError(`invalid actor in vector clock: ${actor}`);
    }
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`clock value for ${actor} must be a positive safe integer`);
    }
  }
}
