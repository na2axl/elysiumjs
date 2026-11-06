---
'@elysiumjs/moirai': minor
---

Module stores: `Moirai.stores({ outbox, inbox, ... })` lists stores and options as private services of a module, such as the outbox and inbox tables of a domain. The actions and event handlers of the module, and the code that runs in it, use them instead of the ones of `MoiraiModule`; what a module leaves out comes from `MoiraiModule`. An action runs in the module that registers it, an `@Event.on` handler records its events in the inbox of its module, a `@Once()` job in the inbox of the module that registers the job, and the relay after a commit relays the outbox the rows went to. `Outbox.relay({ module })` and `Outbox.sweep({ module })` relay the outbox of one module; `Outbox.sweep()` relays the outbox of `MoiraiModule` and of every module with its own.

Breaking: an invalid action or query input is a 422 `VALIDATION_FAILED` problem (was 400), and a missing idempotency key is a 400 `IDEMPOTENCY_KEY_REQUIRED` problem (was 428).
