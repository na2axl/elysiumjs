---
'@elysiumjs/olympus': minor
'@elysiumjs/drizzle': minor
---

Repositories can read through a cache. `MnemosyneModule.with({ repositories: { cache: { store, ttl } } })` sets the cache of every repository, and a repository merges its own `static cache` over it or sets it to `false`. `find()` and `findBy()` read through the cache; entries are kept per model, digest of the table's columns, tenant and connection, and stamped with the version of their row and the generation of the tenant's rows, so writes, right away and once the unit of work or the transaction commits, never leave a stale row. Reads skip the cache inside a transaction, and a failing store costs a read of the database, never the call. `AbstractDatabase` runs `afterCommit` hooks, which the Drizzle repository adapter passes through.
