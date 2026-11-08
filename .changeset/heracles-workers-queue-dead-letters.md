---
'@elysiumjs/heracles-workers': minor
---

Each queue sets its own dead letter queue: `deadLetterQueue` moves from `HeraclesWorkersModule.with()` to the `transportOptions` of a `CloudflareQueueTransport` queue, next to its `binding`. A job that fails its last retry goes to the dead letter queue of its own queue. `onDead` stays on the module and is called for every queue.
