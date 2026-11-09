---
'@elysiumjs/heracles': patch
---

A `Scheduler` is made and fans out in the module that declares its job, so it can inject that module's services whoever dispatches the tick, such as `HeraclesWorkersModule` on a cron trigger.
