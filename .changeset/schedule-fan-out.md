---
'@elysiumjs/heracles': minor
'@elysiumjs/heracles-workers': minor
'@elysiumjs/runtime-workers': minor
'@elysiumjs/moirai': minor
---

Scheduled fan-out, dead letters and one consumer per queue.

- `@Scheduler.job(cron, { args })` dispatches a job on a cron with fixed arguments.
- A class that extends `Scheduler` and is marked with `@Scheduler.register({ cron, job })` dispatches one job per case its `fanOut(tick)` returns, with arguments typed against the job and a dispatch id made of the scheduler, the case key and the tick. Schedulers are services, so they inject what they read.
- `ScheduleRunner` runs the schedules on Bun and Node.js (the `heracles:schedule` command), and `Scheduler.jobsFor()` / `Scheduler.dispatch()` serve the cron triggers of Workers.
- `@Once()` of `@elysiumjs/moirai/heracles` runs a job once per dispatch id, in a unit of work with an inbox record.
- `HeraclesWorkersModule.with({ deadLetterQueue, onDead })` keeps the jobs that failed their last retry: sent to a dead letter queue with their failure, and handed to a hook.
- Cron triggers dispatch at the trigger's time.
- A named queue of a Worker has one consumer: two throw `DuplicateQueueConsumerError` when the Worker is created.
