---
'@elysiumjs/moirai': minor
'@elysiumjs/moirai-drizzle': minor
---

Writes are actions and reads are queries. An action extends `Action` and is marked with `@Action.register()`; a query extends `Query` and is marked with `@Query.register()`. `Moirai.execute()` runs an action and `Moirai.ask()` runs a query, and their outcomes are `ActionOutcome` and `QueryOutcome`. Outbox handlers are marked with `@Outbox.handle(kind)`.

The options, retry policy and lock are `ActionOptions`, `ActionRetry`, `ActionLock` (`MemoryActionLock`, `MOIRAI_ACTION_LOCK`), and a refused `authorize` is a `CallForbiddenError`. Idempotency records name their `action`, and the `idempotency_keys` table of `moiraiTables()` has an `action` column.
