import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clockCovers,
  compareClocks,
  incrementClock,
  mergeClocks,
  validateClock,
} from "../src/vector-clock.js";

describe("vector clocks", () => {
  it("distinguishes causal, equal, and concurrent histories", () => {
    assert.equal(compareClocks({ a: 1 }, { a: 1 }), "equal");
    assert.equal(compareClocks({ a: 1 }, { a: 2 }), "before");
    assert.equal(compareClocks({ a: 2, b: 1 }, { a: 1 }), "after");
    assert.equal(compareClocks({ a: 2 }, { a: 1, b: 1 }), "concurrent");
  });

  it("merges frontiers and checks coverage", () => {
    const merged = mergeClocks({ a: 2 }, { a: 1, b: 3 });
    assert.deepEqual(merged, { a: 2, b: 3 });
    assert.deepEqual(incrementClock(merged, "a"), { a: 3, b: 3 });
    assert.equal(clockCovers(merged, { a: 1, b: 3 }), true);
    assert.equal(clockCovers(merged, { a: 3 }), false);
  });

  it("rejects invalid actor counters", () => {
    assert.throws(() => validateClock({ a: 0 }), /positive safe integer/);
    assert.throws(() => validateClock({ "bad actor": 1 }), /invalid actor/);
  });
});
