import type { HybridTimestamp } from "./model.js";

export class HybridLogicalClock {
  private wallTime = 0;
  private counter = 0;

  public constructor(private readonly actor: string) {}

  public tick(physicalTime: number): HybridTimestamp {
    assertPhysicalTime(physicalTime);
    if (physicalTime > this.wallTime) {
      this.wallTime = physicalTime;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return { wallTime: this.wallTime, counter: this.counter, actor: this.actor };
  }

  public observe(remote: HybridTimestamp, physicalTime: number): void {
    validateTimestamp(remote);
    assertPhysicalTime(physicalTime);
    const previousWall = this.wallTime;
    const nextWall = Math.max(previousWall, remote.wallTime, physicalTime);
    if (nextWall === previousWall && nextWall === remote.wallTime) {
      this.counter = Math.max(this.counter, remote.counter) + 1;
    } else if (nextWall === previousWall) {
      this.counter += 1;
    } else if (nextWall === remote.wallTime) {
      this.counter = remote.counter + 1;
    } else {
      this.counter = 0;
    }
    this.wallTime = nextWall;
  }
}

export function compareTimestamps(left: HybridTimestamp, right: HybridTimestamp): number {
  return (
    left.wallTime - right.wallTime ||
    left.counter - right.counter ||
    left.actor.localeCompare(right.actor)
  );
}

export function validateTimestamp(timestamp: HybridTimestamp): void {
  assertPhysicalTime(timestamp.wallTime);
  if (!Number.isSafeInteger(timestamp.counter) || timestamp.counter < 0) {
    throw new TypeError("hybrid timestamp counter must be a non-negative safe integer");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(timestamp.actor)) {
    throw new TypeError("hybrid timestamp actor is invalid");
  }
}

function assertPhysicalTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("physical time must be a non-negative safe integer");
  }
}
