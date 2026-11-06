---
'@elysiumjs/heracles': minor
'@elysiumjs/heracles-workers': minor
'@elysiumjs/runtime-workers': minor
'@elysiumjs/moirai': minor
---

Scheduled fan-out, dead letters and one consumer per queue.

- `@Schedule(cron, { fanOut, key })` selects the cases due at a tick with a static method of the job, and dispatches one job per case, with a dispatch id made of the job, the case key and the tick.
- `@Once()` of `@elysiumjs/moirai/heracles` runs a job once per dispatch id, in a unit of work with an inbox record.
- `HeraclesWorkersModule.with({ deadLetterQueue, onDead })` keeps the jobs that failed their last retry: sent to a dead letter queue with their failure, and handed to a hook.
- Cron triggers dispatch at the trigger's time.
- A named queue of a Worker has one consumer: two throw `DuplicateQueueConsumerError` when the Worker is created.
