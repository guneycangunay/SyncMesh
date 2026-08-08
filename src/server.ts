import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { assertJsonValue, type JsonValue } from "./canonical.js";
import type { Mutation } from "./model.js";
import { Replica } from "./replica.js";
import { SnapshotStore } from "./snapshot-store.js";
import type { VectorClock } from "./vector-clock.js";
import { validateClock } from "./vector-clock.js";

const actor = process.env["SYNCMESH_ACTOR"] ?? "replica-a";
const dataDirectory = process.env["SYNCMESH_DATA"] ?? ".syncmesh";
const port = parsePort(process.env["PORT"] ?? "8080");
const store = new SnapshotStore(path.join(dataDirectory, "replica.json"));
const restored = await store.load();
if (restored && restored.actor !== actor) {
  throw new Error(`snapshot belongs to actor ${restored.actor}, not configured actor ${actor}`);
}
const replica = restored ? Replica.restore(restored) : new Replica(actor);

const server = createServer(async (request, response) => {
  const requestId = safeRequestId(request.headers["x-request-id"]);
  const startedAt = performance.now();
  response.setHeader("x-request-id", requestId);
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("cache-control", "no-store");
  try {
    await route(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    writeJson(response, error instanceof TypeError ? 400 : 500, {
      error: {
        code: error instanceof TypeError ? "invalid_request" : "internal_error",
        message: error instanceof TypeError ? message : "an unexpected error occurred",
      },
    });
  } finally {
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        requestId,
        method: request.method,
        path: request.url,
        status: response.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      })}\n`,
    );
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`${JSON.stringify({ level: "info", message: "syncmesh ready", actor, port })}\n`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close());
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://syncmesh.local");

  if (method === "GET" && url.pathname === "/health/live") {
    writeJson(response, 200, { status: "ok" });
    return;
  }
  if (method === "GET" && url.pathname === "/health/ready") {
    writeJson(response, 200, { status: "ready", actor });
    return;
  }
  if (method === "GET" && url.pathname === "/v1/sync/summary") {
    writeJson(response, 200, { actor, frontier: replica.summary() });
    return;
  }
  if (method === "GET" && url.pathname === "/v1/conflicts") {
    writeJson(response, 200, { conflicts: replica.conflicts() });
    return;
  }
  if (method === "POST" && url.pathname === "/v1/sync/pull") {
    const body = await readJson(request);
    const frontier = requiredObject(body, "frontier") as VectorClock;
    validateClock(frontier);
    writeJson(response, 200, { mutations: replica.changesSince(frontier), frontier: replica.summary() });
    return;
  }
  if (method === "POST" && url.pathname === "/v1/sync/push") {
    const body = await readJson(request);
    const mutations = body["mutations"];
    if (!Array.isArray(mutations) || mutations.length > 1_000) {
      throw new TypeError("mutations must be an array with at most 1000 entries");
    }
    const applied = replica.applyAll(mutations as Mutation[]);
    if (applied > 0) await store.save(replica.snapshot());
    writeJson(response, 200, { applied, frontier: replica.summary() });
    return;
  }

  const documentMatch = url.pathname.match(/^\/v1\/documents\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})$/);
  if (documentMatch?.[1] && method === "GET") {
    const document = replica.get(documentMatch[1]);
    if (!document) {
      writeJson(response, 404, { error: { code: "not_found", message: "document was not found" } });
      return;
    }
    writeJson(response, 200, document);
    return;
  }
  if (documentMatch?.[1] && method === "PATCH") {
    const body = await readJson(request);
    const values = requiredObject(body, "set") as Record<string, JsonValue>;
    assertJsonValue(values);
    const remove = body["remove"] ?? [];
    if (!Array.isArray(remove) || !remove.every((field) => typeof field === "string")) {
      throw new TypeError("remove must be an array of field names");
    }
    const mutation = replica.change(documentMatch[1], values, remove as string[]);
    await store.save(replica.snapshot());
    writeJson(response, 200, { mutation, document: replica.get(documentMatch[1]) });
    return;
  }
  if (documentMatch?.[1] && method === "DELETE") {
    const mutation = replica.delete(documentMatch[1]);
    await store.save(replica.snapshot());
    writeJson(response, 200, { mutation });
    return;
  }

  writeJson(response, 404, { error: { code: "not_found", message: "route was not found" } });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"];
  if (!contentType?.toLowerCase().startsWith("application/json")) {
    throw new TypeError("content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.length;
    if (bytes > 2_097_152) throw new TypeError("request body exceeds 2 MiB");
    chunks.push(buffer);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new TypeError("request body must be a valid JSON object");
  }
}

function requiredObject(body: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = body[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}

function parsePort(source: string): number {
  const value = Number(source);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error("PORT is invalid");
  return value;
}

function safeRequestId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[a-zA-Z0-9._-]{1,100}$/.test(candidate) ? candidate : crypto.randomUUID();
}
