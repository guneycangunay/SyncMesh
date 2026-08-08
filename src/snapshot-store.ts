import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { assertJsonValue, contentHash, type JsonValue } from "./canonical.js";
import type { ReplicaSnapshot } from "./model.js";

interface SnapshotEnvelope {
  readonly checksum: string;
  readonly payload: ReplicaSnapshot;
}

export class SnapshotStore {
  private operationTail: Promise<void> = Promise.resolve();

  public constructor(private readonly filePath: string) {}

  public async load(): Promise<ReplicaSnapshot | undefined> {
    return this.exclusive(async () => {
      let source: string;
      try {
        source = await readFile(this.filePath, "utf8");
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return undefined;
        throw error;
      }
      const envelope = JSON.parse(source) as SnapshotEnvelope;
      assertJsonValue(envelope.payload);
      if (!/^[0-9a-f]{64}$/.test(envelope.checksum)) throw new Error("snapshot checksum is invalid");
      if (contentHash(envelope.payload as unknown as JsonValue) !== envelope.checksum) {
        throw new Error("snapshot checksum mismatch");
      }
      return structuredClone(envelope.payload);
    });
  }

  public async save(snapshot: ReplicaSnapshot): Promise<void> {
    await this.exclusive(async () => {
      const directory = path.dirname(this.filePath);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const payload = structuredClone(snapshot);
      const envelope: SnapshotEnvelope = {
        checksum: contentHash(payload as unknown as JsonValue),
        payload,
      };
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      let handle;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify(envelope, null, 2)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporary, this.filePath);
      } finally {
        await handle?.close();
        await unlink(temporary).catch(() => undefined);
      }
    });
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail;
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
