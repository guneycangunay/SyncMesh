# Contributing

Changes to ordering, mutation hashing, delete semantics, or compaction require an architecture decision record. Every merge rule must be tested with mutations delivered in at least two different orders.

Before opening a pull request, run:

```bash
npm run check
npm run test:coverage
npm run build
```

Keep protocol changes backward-compatible or introduce a new snapshot/protocol format version.
