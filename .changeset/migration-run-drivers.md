---
'@elysiumjs/mnemosyne-drizzle': minor
---

`migration:run` works on any connection whose driver runs migrations: `bun-sql`, `postgres-js`, `node-postgres`, and `hyperdrive` through the driver it wraps. Drivers implement `migrations(connection)`, with `templateClientMigrations()` and `nodePostgresMigrations()` for those clients; a connection whose driver has none fails with a clear error.

Breaking: migration hooks receive `db` (a `MigrationDatabase`, with `execute(sql\`...\`)`and`script(text)`) instead of the Bun SQL client `sql`.
