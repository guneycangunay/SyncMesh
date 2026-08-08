# Threat model

| Threat | Reference control | Production control |
|---|---|---|
| Mutation altered in transit/storage | Canonical SHA-256 ID is verified before apply | Authenticated TLS and signed peer identity |
| Mutation replay | Operation IDs make duplicate apply a no-op | Retain deduplication state through safe compaction |
| Actor impersonation | Actor syntax is validated | Provision actor credentials and authorize namespace |
| Far-future timestamp | Causal order remains correct | Enforce skew budget before accepting remote mutation |
| Vector-clock or log growth | Per-request/batch limits | Actor lifecycle, pagination, quotas, stable-frontier compaction |
| Snapshot corruption | Envelope checksum; restore fails closed | Versioned backups and authenticated storage |
| Unauthorized document read/write | Not implemented in demo server | Authenticate principals and enforce tenant/document policy |
| Conflict log data disclosure | Log contains operation metadata | Apply retention/redaction policy and access control |

A content hash detects modification but does not prove who authored a mutation. It must not be treated as a digital signature.
