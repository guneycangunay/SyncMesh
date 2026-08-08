import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareTimestamps, HybridLogicalClock } from "../src/hlc.js";

describe("HybridLogicalClock", () => {
  it("remains monotonic when physical time moves backward", () => {
    const clock = new HybridLogicalClock("a");
    const first = clock.tick(100);
    const second = clock.tick(90);
    assert.ok(compareTimestamps(second, first) > 0);
    assert.deepEqual(second, { wallTime: 100, counter: 1, actor: "a" });
  });

  it("advances beyond an observed remote timestamp", () => {
    const clock = new HybridLogicalClock("a");
    clock.tick(100);
    clock.observe({ wallTime: 120, counter: 4, actor: "b" }, 110);
    assert.deepEqual(clock.tick(110), { wallTime: 120, counter: 6, actor: "a" });
  });
});
