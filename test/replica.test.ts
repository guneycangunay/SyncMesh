import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Replica } from "../src/replica.js";

const fixedTime = () => 1_700_000_000_000;

describe("Replica", () => {
  it("preserves a causally newer value", () => {
    const laptop = new Replica("laptop", fixedTime);
    const phone = new Replica("phone", fixedTime);
    phone.apply(laptop.change("customer-1", { plan: "basic" }));
    const upgrade = phone.change("customer-1", { plan: "pro" });

    laptop.apply(upgrade);

    assert.equal(laptop.get("customer-1")?.fields["plan"], "pro");
    assert.deepEqual(laptop.get("customer-1"), phone.get("customer-1"));
  });

  it("merges disjoint concurrent field edits", () => {
    const left = new Replica("left", fixedTime);
    const right = new Replica("right", fixedTime);
    const name = left.change("customer-2", { name: "Ada" });
    const plan = right.change("customer-2", { plan: "pro" });

    left.apply(plan);
    right.apply(name);

    assert.deepEqual(left.get("customer-2")?.fields, { name: "Ada", plan: "pro" });
    assert.deepEqual(left.get("customer-2"), right.get("customer-2"));
  });

  it("converges same-field concurrent edits independent of delivery order", () => {
    const sourceA = new Replica("actor-a", fixedTime);
    const sourceB = new Replica("actor-b", fixedTime);
    const operationA = sourceA.change("customer-3", { city: "Ankara" });
    const operationB = sourceB.change("customer-3", { city: "Istanbul" });

    const forward = new Replica("forward", fixedTime);
    forward.applyAll([operationA, operationB]);
    const reverse = new Replica("reverse", fixedTime);
    reverse.applyAll([operationB, operationA]);

    assert.deepEqual(forward.get("customer-3"), reverse.get("customer-3"));
    assert.equal(forward.get("customer-3")?.fields["city"], "Istanbul");
    assert.equal(forward.conflicts()[0]?.winnerOperationId, operationB.id);
    assert.equal(reverse.conflicts()[0]?.winnerOperationId, operationB.id);
  });

  it("resolves a concurrent delete and edit deterministically", () => {
    const left = new Replica("actor-a", fixedTime);
    const right = new Replica("actor-b", fixedTime);
    const base = left.change("customer-4", { name: "Lin", plan: "basic" });
    right.apply(base);

    const deletion = left.delete("customer-4");
    const edit = right.change("customer-4", { plan: "pro" });
    left.apply(edit);
    right.apply(deletion);

    assert.deepEqual(left.get("customer-4"), right.get("customer-4"));
    assert.equal(left.get("customer-4")?.fields["plan"], "pro");
  });

  it("treats duplicate mutation delivery as a no-op", () => {
    const source = new Replica("source", fixedTime);
    const target = new Replica("target", fixedTime);
    const mutation = source.change("document-1", { count: 1 });

    assert.equal(target.apply(mutation), true);
    assert.equal(target.apply(mutation), false);
    assert.equal(target.changesSince({}).length, 1);
  });

  it("detects mutation tampering through its content address", () => {
    const source = new Replica("source", fixedTime);
    const mutation = source.change("document-2", { amount: 100 });
    const tampered = structuredClone(mutation);
    const patch = tampered.changes["amount"];
    if (patch?.kind === "set") (patch as { value: number }).value = 1_000;

    assert.throws(() => new Replica("target", fixedTime).apply(tampered), /content hash/);
  });

  it("sends only operations missing from a peer frontier", () => {
    const source = new Replica("source", fixedTime);
    const target = new Replica("target", fixedTime);
    target.apply(source.change("document-3", { version: 1 }));
    source.change("document-3", { version: 2 });

    const delta = source.changesSince(target.summary());

    assert.equal(delta.length, 1);
    assert.equal(delta[0]?.clock["source"], 2);
    target.applyAll(delta);
    assert.deepEqual(source.get("document-3"), target.get("document-3"));
  });

  it("restores a replica from its mutation snapshot", () => {
    const source = new Replica("tablet", fixedTime);
    source.change("document-4", { title: "Draft", owner: "Ada" });
    source.change("document-4", { title: "Final" }, ["owner"]);

    const restored = Replica.restore(source.snapshot(), fixedTime);

    assert.deepEqual(restored.summary(), source.summary());
    assert.deepEqual(restored.get("document-4"), source.get("document-4"));
    assert.equal(restored.get("document-4")?.fields["owner"], undefined);
  });
});
