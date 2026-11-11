---
'@elysiumjs/mnemosyne-drizzle': minor
---

Add migration hooks: services registered with `@Migration.hook()` run SQL in the transaction of `migration:run`, with `before` and `after` (a `MigrationRun`) and `beforeEach` and `afterEach` (a `MigrationStep`). `before` and `after` also run when no migration is pending.
