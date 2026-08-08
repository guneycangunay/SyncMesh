# SyncMesh

[![CI](https://github.com/guneycangunay/SyncMesh/actions/workflows/ci.yml/badge.svg)](https://github.com/guneycangunay/SyncMesh/actions/workflows/ci.yml)
[![CodeQL](https://github.com/guneycangunay/SyncMesh/actions/workflows/codeql.yml/badge.svg)](https://github.com/guneycangunay/SyncMesh/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

SyncMesh is an offline-first synchronization engine for JSON documents. Replicas accept writes without a coordinator, exchange only missing mutations, preserve causally newer values, and resolve truly concurrent field edits with a deterministic rule that converges regardless of delivery order.

## Why this repository exists

“Last write wins” is often presented without defining whose clock wins, how deletes interact with edits, or how replicas know what to exchange. SyncMesh makes those choices executable and testable:

- vector clocks distinguish causal updates from concurrent updates
- field-level registers preserve disjoint offline edits
- hybrid logical timestamps provide deterministic concurrent resolution
- content-addressed mutation IDs detect accidental or malicious mutation changes
- frontier-based delta sync avoids sending operations the peer has already observed
- convergence tests apply the same mutations in different orders

## Quick start

```bash
npm ci
npm test
npm run build
SYNCMESH_ACTOR=laptop-a SYNCMESH_DATA=.syncmesh node dist/server.js
```

```bash
curl -sS -X PATCH http://localhost:8080/v1/documents/customer-42 \
  -H 'content-type: application/json' \
  -d '{"name":"Ada","plan":"pro"}'

curl -sS http://localhost:8080/v1/documents/customer-42
```

Read [the architecture](docs/architecture.md), [conflict semantics](docs/conflict-semantics.md), and [sync protocol](docs/sync-protocol.md).

## Honest boundaries

SyncMesh is a reference engine, not a globally replicated database. It assumes stable unique actor IDs and eventual mutation exchange. The HTTP server is a single-tenant demo control plane without authentication. Production use needs actor provisioning, schema validation, encrypted transport, peer authorization, compaction based on a trusted stability frontier, and operational limits.

## License

[MIT](LICENSE)
