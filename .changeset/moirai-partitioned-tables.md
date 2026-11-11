---
'@elysiumjs/moirai-drizzle': minor
---

`moiraiTables(schema, { partitioned: true })` partitions `events` by `occurred_at` and `outbox` by `created_at`, with that column in their primary and unique keys.
