---
'@elysiumjs/moirai': minor
'@elysiumjs/moirai-drizzle': minor
---

`Moirai.lock(key)` serializes work from inside a handler, for a key known after a read, until the unit of work ends. `Moirai.execute()` and `Moirai.ask()` return an `Outcome` whose `orThrow()` gives the result alone and throws the refusal, and `Moirai.ErrorsOf<C>` names the DomainErrors of a handler without moirai's own. `errors` is now required by `@Action.register()` and `@Query.register()` (`[]` when `handle()` gives none). Outbox handlers get a context whose `replacePayload()` replaces the payload of their row once they succeed; `OutboxStore.replacePayload()` is implemented by the memory and Drizzle stores.
