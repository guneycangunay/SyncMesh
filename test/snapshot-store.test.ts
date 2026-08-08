import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { Replica } from "../src/replica.js";
import { SnapshotStore } from "../src/snapshot-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("SnapshotStore", () => {
  it("round-trips a checksummed replica snapshot", async () => {
    const filename = await snapshotFile();
    const replica = new Replica("replica", () => 100);
    replica.change("document", { enabled: true });
    const store = new SnapshotStore(filename);

    await store.save(replica.snapshot());
    const restored = await store.load();

    assert.deepEqual(restored, replica.snapshot());
  });

  it("fails closed when the stored payload is modified", async () => {
    const filename = await snapshotFile();
    const replica = new Replica("replica", () => 100);
    replica.change("document", { enabled: true });
    const store = new SnapshotStore(filename);
    await store.save(replica.snapshot());
    const source = await readFile(filename, "utf8");
    await writeFile(filename, source.replace('"enabled"', '"disabled"'), "utf8");

    await assert.rejects(store.load(), /checksum mismatch/);
  });
});

async function snapshotFile(): Promise<string> {
  const directory = path.join(tmpdir(), `syncmesh-${crypto.randomUUID()}`);
  directories.push(directory);
  await mkdir(directory, { recursive: true });
  return path.join(directory, "replica.json");
}
