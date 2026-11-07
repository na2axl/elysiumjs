# @elysiumjs/heracles-workers

## 0.1.1

### Patch Changes

- Updated dependencies [[`651a755`](https://github.com/na2axl/elysiumjs/commit/651a7557173ce2c6155bcfa8d90cf388ac419821)]:
  - @elysiumjs/core@0.12.0
  - @elysiumjs/heracles@0.8.1
  - @elysiumjs/runtime-workers@0.1.1

## 0.1.0

### Minor Changes

- [#20](https://github.com/na2axl/elysiumjs/pull/20) [`1738567`](https://github.com/na2axl/elysiumjs/commit/17385674c14991f0ddb27eb6ee967afbcebcc307) Thanks [@na2axl](https://github.com/na2axl)! - Scheduled fan-out, dead letters and one consumer per queue.

  - `@Scheduler.job(cron, { args })` dispatches a job on a cron with fixed arguments.
  - A class that extends `Scheduler` and is marked with `@Scheduler.register({ cron, job })` dispatches one job per case its `fanOut(tick)` returns, with arguments typed against the job and a dispatch id made of the scheduler, the case key and the tick. Schedulers are services, so they inject what they read.
  - `ScheduleRunner` runs the schedules on Bun and Node.js (the `heracles:schedule` command), and `Scheduler.jobsFor()` / `Scheduler.dispatch()` serve the cron triggers of Workers.
  - `@Once()` of `@elysiumjs/moirai/heracles` runs a job once per dispatch id, in a unit of work with an inbox record.
  - `HeraclesWorkersModule.with({ deadLetterQueue, onDead })` keeps the jobs that failed their last retry: sent to a dead letter queue with their failure, and handed to a hook.
  - Cron triggers dispatch at the trigger's time.
  - A named queue of a Worker has one consumer: two throw `DuplicateQueueConsumerError` when the Worker is created.

- [#16](https://github.com/na2axl/elysiumjs/pull/16) [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576) Thanks [@na2axl](https://github.com/na2axl)! - Redis, databases, logs, jobs and builds on Bun, Node.js and Cloudflare Workers.

  Breaking:

  - The level shortcuts of `InteractsWithConsole` (`info`, `success`, `warning`, `error` and `debug`) write a tag (`[I]`, `[S]`, `[W]`, `[E]` and `[D]`, in color) before the message, which `InteractsWithConsole.useTags()` changes. `trace()` writes to stderr.
  - Outside Bun, a Drizzle connection needs a `driver`. Without one, the `connection` and `client` props are a Bun SQL connection, which is only available on Bun; elsewhere the connection throws `MissingDriverError`, which names the drivers.

  Added:

  - Redis adapters (`@elysiumjs/redis`): `ioredis(create)` plugs an ioredis client into the Redis port on Node.js, and `upstash({ token, url?, fetch? })` talks to Upstash over its REST API, for Workers (no pub/sub). `bunRedis` explains which adapter to use when it runs outside Bun.
  - Drizzle drivers (`@elysiumjs/mnemosyne-drizzle`): a `DrizzleDriver` port set with the `driver` prop of a connection, and drivers on subpaths so that only the chosen database client is imported: `/bun-sql` (`bunSql()`), `/postgres-js` (`postgresJs()`), `/node-postgres` (`nodePostgres()`) and `/hyperdrive` (`hyperdrive({ binding, driver })`, a client per Worker invocation over a Cloudflare Hyperdrive binding). `DrizzleModule` closes connections through their driver, and `migration:run` runs on any driver.
  - `InteractsWithConsole.write()` and `Runtime.write()` take the level of the line (`OutputLevel`), which the level shortcuts pass. On Cloudflare Workers, a line is written with the console method of its level, so Workers Logs keep it.
  - `JsonConsoleLogger` (`@elysiumjs/hermes`): JSON lines through the console of the runtime (warnings and errors on stderr), with levels, error serialization and `child()`. `HermesModule.with({ transport: 'console' | 'pino' })` picks it, and it is the default on Workers. `RequestLogInterceptor` writes one structured line per request: method, route, status, duration, client address and request id.
  - Scheduled jobs (`@elysiumjs/heracles`): `@Schedule(cron, { timezone, args })` on a job class, a five-field cron parser (`Cron`, with lists, ranges, steps and names), and a `Scheduler` that dispatches the jobs on time on Bun and Node.js, taking a Redis lock per tick when a Redis connection is set. The `heracles:schedule` command runs it.
  - `@elysiumjs/heracles-workers`: `CloudflareQueueTransport` sends jobs to a Cloudflare Queue (dispatch delays become `delaySeconds`), and `HeraclesWorkersModule` consumes them in the Worker's `queue` handler (ack on success, retry with a delay up to the job's retries) and dispatches the `@Schedule()` jobs whose expression is the cron of a trigger.
  - Queue handlers (`@elysiumjs/runtime-workers`) can settle a message themselves with `ack()` or `retry({ delaySeconds })`; the messages they leave are acked when no handler failed on them.
  - `styx build --target node` (`@elysiumjs/hephaestus`) bundles the app into one ES module for Node.js, with decorator metadata emitted at build time, run with `node dist/server.js serve`. `styx build --target workers` runs from the CLI, resolves packages to their browser entry, and leaves Node.js modules imported by bare names to workerd (`nodejs_compat`).
  - `styx create` (`@elysiumjs/styx`) takes `--runtime bun|node|workers`, `--database`, `--cache` and `--package-manager bun|npm|pnpm`. Each runtime gets its entry, tsconfig types, scripts and drivers: postgres.js and ioredis on Node.js; Hyperdrive, Upstash, console logs and a `wrangler.jsonc` on Workers.

### Patch Changes

- Updated dependencies [[`6bc48fe`](https://github.com/na2axl/elysiumjs/commit/6bc48febd51f7090c582e73f349eaeff7261241c), [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148), [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82), [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4), [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562), [`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5), [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64), [`0057b67`](https://github.com/na2axl/elysiumjs/commit/0057b67df0e3abecab8a9accff6b55a6a64c21df), [`1738567`](https://github.com/na2axl/elysiumjs/commit/17385674c14991f0ddb27eb6ee967afbcebcc307), [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4), [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d), [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4), [`fbcc7da`](https://github.com/na2axl/elysiumjs/commit/fbcc7dad127db29da42e7a4a5c2124966731cd88), [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576), [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b)]:
  - @elysiumjs/core@0.11.0
  - @elysiumjs/runtime-workers@0.1.0
  - @elysiumjs/heracles@0.8.0
