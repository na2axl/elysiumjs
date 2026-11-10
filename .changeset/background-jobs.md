---
'@elysiumjs/core': minor
'@elysiumjs/heracles': minor
'@elysiumjs/moirai': minor
---

`@Background.scope()` registers a service that wraps every unit of background work, the way interceptors wrap requests: heracles jobs (`kind: 'job'`), moirai event handlers (`'event'`) and outbox handlers (`'outbox'`) run inside the scopes, which nest in registration order. `Service.invoke(target, method, args)` calls a method whose parameters take services. Heracles types the constructor arguments of every job class in `Heracles.dispatch()`, scheduler cases and `JobClass<any, any>`, and the parameters of `execute()` take services with `@Service.inject()`. `heracles:schedule --list` prints the scheduled jobs and their cron triggers, and `--check <wrangler.jsonc>` fails when the `triggers.crons` of the file differ from them.
