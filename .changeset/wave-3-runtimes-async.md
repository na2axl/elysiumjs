---
'@elysiumjs/redis': minor
'@elysiumjs/mnemosyne-drizzle': minor
'@elysiumjs/hermes': minor
'@elysiumjs/heracles': minor
'@elysiumjs/heracles-workers': minor
'@elysiumjs/hephaestus': minor
'@elysiumjs/styx': minor
'@elysiumjs/runtime-workers': minor
---

Redis, databases, logs, jobs and builds on Bun, Node.js and Cloudflare Workers.

Breaking:

- Outside Bun, a Drizzle connection needs a `driver`. Without one, the `connection` and `client` props are a Bun SQL connection, which is only available on Bun; elsewhere the connection throws `MissingDriverError`, which names the drivers.

Added:

- Redis adapters (`@elysiumjs/redis`): `ioredis(create)` plugs an ioredis client into the Redis port on Node.js, and `upstash({ token, url?, fetch? })` talks to Upstash over its REST API, for Workers (no pub/sub). `bunRedis` explains which adapter to use when it runs outside Bun.
- Drizzle drivers (`@elysiumjs/mnemosyne-drizzle`): a `DrizzleDriver` port set with the `driver` prop of a connection, and drivers on subpaths so that only the chosen database client is imported: `/bun-sql` (`bunSql()`), `/postgres-js` (`postgresJs()`), `/node-postgres` (`nodePostgres()`) and `/hyperdrive` (`hyperdrive({ binding, driver })`, a client per Worker invocation over a Cloudflare Hyperdrive binding). `DrizzleModule` closes connections through their driver, and `migration:run` runs on any driver.
- `JsonConsoleLogger` (`@elysiumjs/hermes`): JSON lines through `console`, with levels, error serialization and `child()`. `HermesModule.with({ transport: 'console' | 'pino' })` picks it, and it is the default on Workers. `RequestLogInterceptor` writes one structured line per request: method, route, status, duration, client address and request id.
- Scheduled jobs (`@elysiumjs/heracles`): `@Schedule(cron, { timezone, args })` on a job class, a five-field cron parser (`Cron`, with lists, ranges, steps and names), and a `Scheduler` that dispatches the jobs on time on Bun and Node.js, taking a Redis lock per tick when a Redis connection is set. The `heracles:schedule` command runs it.
- `@elysiumjs/heracles-workers`: `CloudflareQueueTransport` sends jobs to a Cloudflare Queue (dispatch delays become `delaySeconds`), and `HeraclesWorkersModule` consumes them in the Worker's `queue` handler (ack on success, retry with a delay up to the job's retries) and dispatches the `@Schedule()` jobs whose expression is the cron of a trigger.
- Queue handlers (`@elysiumjs/runtime-workers`) can settle a message themselves with `ack()` or `retry({ delaySeconds })`; the messages they leave are acked when no handler failed on them.
- `styx build --target node` (`@elysiumjs/hephaestus`) bundles the app into one ES module for Node.js, with decorator metadata emitted at build time, run with `node dist/server.js serve`. `styx build --target workers` runs from the CLI, resolves packages to their browser entry, and leaves Node.js modules imported by bare names to workerd (`nodejs_compat`).
- `styx create` (`@elysiumjs/styx`) takes `--runtime bun|node|workers`, `--database`, `--cache` and `--package-manager bun|npm|pnpm`. Each runtime gets its entry, tsconfig types, scripts and drivers: postgres.js and ioredis on Node.js; Hyperdrive, Upstash, console logs and a `wrangler.jsonc` on Workers.
