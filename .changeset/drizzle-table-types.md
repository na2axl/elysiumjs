---
'@elysiumjs/drizzle': patch
---

`notificationsTable()`, `filesTable()`, `moiraiTables()` and `pgTable()` now declare their return types with Drizzle's own types (`PgTableWithColumns`, `PgBuildColumns`), through the new `BuiltPgTable` type. Their declarations no longer carry a copy of Drizzle's table shape, so the tables they build type-check against the Drizzle the app installs. `DrizzleConnectionProps` and `DrizzleDriverConfig` now take Drizzle relations (`defineRelations()`) as their type parameter, as `DrizzleConfig` does.
