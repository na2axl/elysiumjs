---
'@elysiumjs/olympus': minor
---

`@elysiumjs/olympus` is the framework in one package. The root export holds the application, modules, dependency injection, controllers, middleware, problem details, configuration, lifecycle events, logging (`LoggerModule`), JSON with serializers, ports and locks. Subpaths hold the domains:

- `/mnemosyne`: database and caching, a `Repository(Model)` over a `RepositoryAdapter` port, repository events and pruners.
- `/moirai`: actions, queries, outbox, inbox and domain events; `Moirai.enqueue()` runs actions as jobs, with `ActionJob` from `/moirai/heracles`.
- `/heracles`: background jobs.
- `/ariadne`: multi-step flows.
- `/harpocrates`: password hashing (scrypt by default), encryption, JWT and signed URLs.
- `/themis`: authentication.
- `/cerberus`: permission rules per domain, composed over the facts of an actor and cached per version; route guards and the `authorize` hook of calls.
- `/hermes`: notifications over channels with fallbacks, an inbox and mail; queued sends with `NotificationJob` from `/hermes/heracles`.
- `/pithos`: storage disks, file records and uploads sent straight to a disk through signed URLs; `FilesPruner` from `/pithos/heracles`.

Backends are drivers of ports (`Port('name')`, `@X.driver()`, `X.for()`), provided by `@elysiumjs/bun`, `@elysiumjs/node`, `@elysiumjs/workers`, `@elysiumjs/redis`, `@elysiumjs/drizzle` and `@elysiumjs/pino`.
