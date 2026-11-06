---
'@elysiumjs/moirai': minor
---

Named store sets: `MoiraiModule.with({ stores: { billing: { outbox, inbox, ... } } })` gives each part of an app its own stores, such as the outbox and inbox tables of each domain. The stores outside `stores` are the `default` set; a named set shares the stores it leaves out and takes the options of the default set, with its own overrides. `@Action.register({ stores })`, `@Event.on(name, { stores })` and `@Once({ stores })` pick a set, `Outbox.relay({ stores })` and `Outbox.sweep({ stores })` relay one, and `Moirai.using(stores, work)` runs code with a set current.

Breaking: an invalid action or query input is a 422 `VALIDATION_FAILED` problem (was 400), and a missing idempotency key is a 400 `IDEMPOTENCY_KEY_REQUIRED` problem (was 428).
