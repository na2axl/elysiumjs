# @elysiumjs/runtime-workers

## 0.1.10

### Patch Changes

- Updated dependencies [[`5b79d5a`](https://github.com/na2axl/elysiumjs/commit/5b79d5a4b634347ce18766ef08aec12916328ff6), [`9bd29cb`](https://github.com/na2axl/elysiumjs/commit/9bd29cbd10131e4465505de91c78e7f39d242e71)]:
  - @elysiumjs/core@0.21.0

## 0.1.9

### Patch Changes

- Updated dependencies [[`920b941`](https://github.com/na2axl/elysiumjs/commit/920b941a9c070c9006fe277abc7a187b9d140af7), [`9901020`](https://github.com/na2axl/elysiumjs/commit/99010200522c56bb37cbc44c7ffa311d69972599), [`7dc7c59`](https://github.com/na2axl/elysiumjs/commit/7dc7c59f67b9f62159064f7958f529f4e6e27e65)]:
  - @elysiumjs/core@0.20.0

## 0.1.8

### Patch Changes

- Updated dependencies [[`af05b49`](https://github.com/na2axl/elysiumjs/commit/af05b498a2c4d4dafda44f361fe68c490f49a8c7), [`7ffe5eb`](https://github.com/na2axl/elysiumjs/commit/7ffe5eb3926d8a428c6cb14fdc9437758d4c99b5)]:
  - @elysiumjs/core@0.19.0

## 0.1.7

### Patch Changes

- Updated dependencies [[`d471a6e`](https://github.com/na2axl/elysiumjs/commit/d471a6e69736e016eb972a0715987df1d7b62438)]:
  - @elysiumjs/core@0.18.0

## 0.1.6

### Patch Changes

- Updated dependencies [[`762661e`](https://github.com/na2axl/elysiumjs/commit/762661e362444f431ea84576494322a9a7a81539)]:
  - @elysiumjs/core@0.17.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9)]:
  - @elysiumjs/core@0.16.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`d663d2e`](https://github.com/na2axl/elysiumjs/commit/d663d2ed95778079f71e53fcaf60a7f8ef570f6d)]:
  - @elysiumjs/core@0.15.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`359f157`](https://github.com/na2axl/elysiumjs/commit/359f1579b9ad69643da5360d9ca9e80104fbe2f1)]:
  - @elysiumjs/core@0.14.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`c8d9f53`](https://github.com/na2axl/elysiumjs/commit/c8d9f534eef32621eae121f7008f97dc24808141)]:
  - @elysiumjs/core@0.13.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`651a755`](https://github.com/na2axl/elysiumjs/commit/651a7557173ce2c6155bcfa8d90cf388ac419821)]:
  - @elysiumjs/core@0.12.0

## 0.1.0

### Minor Changes

- [#8](https://github.com/na2axl/elysiumjs/pull/8) [`6bc48fe`](https://github.com/na2axl/elysiumjs/commit/6bc48febd51f7090c582e73f349eaeff7261241c) Thanks [@na2axl](https://github.com/na2axl)! - `Application.build()` builds the root Elysia app without listening, for hosts that own the server (Cloudflare Workers) and for ahead-of-time compilation with `elysia/plugin/aot`. Modules are registered but boot on the first request (once, shared by concurrent requests), so building runs no `onInit` work. A boot failure fails the requests.

  HTTP and websocket controllers in the server scope, and middlewares, are now built on their first request instead of when the app is built. `serve` still boots every module before listening.

  `@elysiumjs/runtime-workers` gets a `check:aot` script, run in CI: it compiles a sample app with the AOT plugin for workerd, checks that the bundle holds no `new Function` or `eval`, and serves a validated route and the OpenAPI document under Node.js with code generation from strings disallowed.

- [#5](https://github.com/na2axl/elysiumjs/pull/5) [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82) Thanks [@na2axl](https://github.com/na2axl)! - Core runs outside Bun. Environment variables, timers, the HTTP server, process exit and shutdown signals now come from a `Runtime` set with the new `runtime` option of `@Application.register()` or with `Runtime.use()`. Runtimes ship as packages, each exporting `runtime`: `@elysiumjs/runtime-bun`, `@elysiumjs/runtime-node` and `@elysiumjs/runtime-workers` (which also exports `createRuntime({ env })`).

  Breaking: an application needs a runtime (add `runtime` from `@elysiumjs/runtime-bun`), and `Redis` and `RedisModule` moved from core to the new `@elysiumjs/redis` package, which also accepts a `client` factory for runtimes without `Bun.RedisClient`.

  Console colours are plain ANSI codes instead of `Bun.color`, `node:readline` is loaded only when a prompt runs, and core's dist is built for the `node` target so `node:` imports keep their prefix. `check:runtime` scripts in core and runtime-workers fail when their bundles touch the `Bun` global.

  `create-elysium` gets a runtime step: it installs the chosen runtime package and sets it in the generated app. Bun is selectable today; Node.js and Cloudflare Workers are listed as coming later.

- [#20](https://github.com/na2axl/elysiumjs/pull/20) [`1738567`](https://github.com/na2axl/elysiumjs/commit/17385674c14991f0ddb27eb6ee967afbcebcc307) Thanks [@na2axl](https://github.com/na2axl)! - Scheduled fan-out, dead letters and one consumer per queue.

  - `@Scheduler.job(cron, { args })` dispatches a job on a cron with fixed arguments.
  - A class that extends `Scheduler` and is marked with `@Scheduler.register({ cron, job })` dispatches one job per case its `fanOut(tick)` returns, with arguments typed against the job and a dispatch id made of the scheduler, the case key and the tick. Schedulers are services, so they inject what they read.
  - `ScheduleRunner` runs the schedules on Bun and Node.js (the `heracles:schedule` command), and `Scheduler.jobsFor()` / `Scheduler.dispatch()` serve the cron triggers of Workers.
  - `@Once()` of `@elysiumjs/moirai/heracles` runs a job once per dispatch id, in a unit of work with an inbox record.
  - `HeraclesWorkersModule.with({ deadLetterQueue, onDead })` keeps the jobs that failed their last retry: sent to a dead letter queue with their failure, and handed to a hook.
  - Cron triggers dispatch at the trigger's time.
  - A named queue of a Worker has one consumer: two throw `DuplicateQueueConsumerError` when the Worker is created.

- [#13](https://github.com/na2axl/elysiumjs/pull/13) [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d) Thanks [@na2axl](https://github.com/na2axl)! - Hardening of the runtimes, the container and the CLI, checked by a conformance suite that runs on Bun, Node.js and workerd.

  Breaking changes:

  - `Runtime` gains the required `argv()`, `write(stream, text)` and `terminal()` members: core reaches the host's arguments, output streams and terminal only through the runtime. Custom runtimes must implement them.
  - The third parameter of `InteractsWithConsole.write` is now `'stdout' | 'stderr'`.
  - The WebSocket options are narrowed to `idleTimeout`, `maxPayloadLength` and `perMessageDeflate`, and the `bun` WebSocket types are replaced by `ElysiumWebSocket`.
  - Redis connections are `RedisConnection`s, a port any Redis client can implement, instead of `Bun.RedisClient`.
  - `styx create @scope/name` creates the project in `name/`, and refuses project and module names with upper-case letters.
  - Queue handlers no longer reject the batch: after the handlers ran, each message is acked or retried on its own. `@Workers.queue(name, { each: true })` receives one message at a time, so a failure retries only that message.

  Fixes:

  - Request-scoped services are destroyed when the request ends, also on failure, and an async `onInit` is awaited. A second dispose of a request scope waits for the one in progress, so a Worker's `waitUntil` covers an async `onDestroy`.
  - A failed module or service `onInit` no longer breaks later requests: the boot is retried, and the module's event listeners are unwired.
  - `@elysiumjs/runtime-node` serves through `node:http`, keeping the Host header authoritative.
  - `styx create` validates names before creating files, ships `.gitignore`, declares the dependencies of created projects and imports their default controllers.

- [#14](https://github.com/na2axl/elysiumjs/pull/14) [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4) Thanks [@na2axl](https://github.com/na2axl)! - The request pipeline: problem details, exception filters, interceptors, typed configuration, HTTP security options and an HTTP test client, checked on Bun, Node.js, workerd and AOT-compiled Workers.

  Breaking changes:

  - Error responses are RFC 9457 problem details (`application/problem+json`). Request validation errors answer 422 with an `errors` list of JSON pointers (`problems.validationStatus: 400` keeps 400). Server errors only show their message and stack in development. Thrown statuses (`c.status(...)`) are sent as they are.
  - Client errors (4xx) are no longer reported to `onError`, the `elysium:error` event or the trace.
  - `Runtime.serve` may return a handle with `close()`, which the application calls on shutdown.
  - Request bodies are limited to 1 MiB by default (`http.bodyLimit`), also when chunked.
  - The environment schema is validated when the app is built or run, with every error reported at once, instead of in the constructor.

  Features:

  - `DomainError`, with `status`, `type`, `title`, `detail` and extensions, and shortcuts such as `DomainError.notFound()`.
  - Exception filters (`@Catch()`, `filters` on routes, controllers, modules and the app) and interceptors (`interceptors` on the same levels), with `TimingInterceptor`, `TransformInterceptor` and mnemosyne's `CacheInterceptor`.
  - Typed configuration: `Secret` values, module `envSchema`s merged into the app's, `InvalidEnvironmentError`.
  - `http` options: CORS, security headers, body limits and trusted proxies (`ctx.ip`). Runtimes report the client address through `clientAddress`.
  - `createTestingHttpApp` and `createHttpClient` send requests to an app in memory, with `expectStatus()`.

  Fixes:

  - App-level `onRequest` middlewares run in the request scope.
  - On Workers, the request scope of a streamed response is disposed when the body ends, not when `fetch` returns.
  - `KeyvWorkersKV.clear()` stays within an operation budget (`maxOperations`).
  - The Node.js bridge treats a destroyed socket as a client abort.
  - Heracles performance metrics report through the Redis port (`connection` or `client`), not a Bun client.
  - `styx routes:generate` names anonymous default controllers after their file; `styx create` pins `@elysiumjs/*` packages to the versions it was released with; invalid names are reported as Elysium errors.

- [#15](https://github.com/na2axl/elysiumjs/pull/15) [`fbcc7da`](https://github.com/na2axl/elysiumjs/commit/fbcc7dad127db29da42e7a4a5c2124966731cd88) Thanks [@na2axl](https://github.com/na2axl)! - Resources, queries, units of work and rate limits.

  Breaking:

  - A route with a `response` schema serializes its handler result through it: fields the schema does not declare are dropped, a `Date` becomes an ISO string (`YYYY-MM-DD` for `format: 'date'`), and an object with `toJSON()` becomes what it returns. Set `serialize: false` on a route to send the result as it is.

  Added:

  - `Resource.hidden(schema)` marks a field that never reaches responses nor the OpenAPI document. `Resource.serialize()` and `Resource.project()` are exported for use outside routes.
  - Sparse fieldsets: `?fields=id,title` keeps only those fields of an object, of each item of an array, or of each item of a `data` array. An unknown or hidden field answers a 400 problem.
  - Rate limits with `@RateLimit({ window, max, key?, store?, name? })` on routes and controllers (`@RateLimit(false)` turns one off), and a default limit and store in the app's `rateLimit` option, with fixed windows. Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and `RateLimit-Policy`; a client over the limit gets a 429 problem with `Retry-After`. Counts are kept by a `RateLimitStore`: `MemoryRateLimitStore` (core), `RedisRateLimitStore` (`@elysiumjs/redis`) or `WorkersRateLimitStore` over a Cloudflare rate limiting binding (`@elysiumjs/runtime-workers`), which only decides whether a hit is over the limit, so its responses carry no `RateLimit-Reset`.
  - `ModelResource(model, { hidden, pick, omit, extend })` (`@elysiumjs/mnemosyne`) builds a response schema from a model.
  - `Query.define(model, spec)` declares the filters (`filter[field][op]=value`), sorts, page size and cursor a list accepts; `Query.schema()` gives its query schema, `Query.parse()` turns a request query into a `ParsedQuery` and answers a 400 problem with a pointer per mistake, and `Query.page()` / `Query.pageSchema()` build cursor pages (`{ data, nextCursor }`).
  - `DrizzleRepository.list(query)` and `count(query)` run a `ParsedQuery` with keyset pagination (`@elysiumjs/mnemosyne-drizzle`), and `compileQuery()` gives its `where` and `orderBy`.
  - Units of work: `UnitOfWork.run()` and the `@Transactional()` method decorator run work in one transaction, and `UnitOfWork.afterCommit()` / `afterRollback()` defer work, such as sending a message, until the outermost transaction has ended. `transactional` routes open a unit of work too.

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

- [#12](https://github.com/na2axl/elysiumjs/pull/12) [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b) Thanks [@na2axl](https://github.com/na2axl)! - `createWorker(app)` from `@elysiumjs/runtime-workers` builds an application and returns the handlers a Cloudflare Worker exports: `fetch` serves the routes, `queue` hands each batch to the service methods marked `@Workers.queue(name)`, and `scheduled` calls the methods marked `@Workers.cron(expression)`. Each invocation runs with its own env and execution context: `Workers.env()`, `Workers.context()` and `Workers.binding(name)` read them, and `WorkersModule` provides them, and the bindings it lists, as request-scoped services injected with `@Workers.inject(name)`. `KeyvWorkersKV` stores mnemosyne caches in a KV namespace. `bun run check:wrangler` runs a sample Worker in `wrangler dev`.

  `MnemosyneModule` takes other Keyv stores in `cache.stores`, read with `Cache.store(name)`.

  `styx build --target workers` (Hephaestus `hephaestus:build --target workers`, `WorkersBuilder`) bundles a Worker with its routes compiled ahead of time and refuses a bundle that generates code at runtime.

  In core, `Application.boot()` initialises the modules once, for hosts that handle more than requests; `Kernel.serviceClasses(node)` lists the service classes of a module; console output falls back to `console` where the host has no output streams; and a singleton depending on a request-scoped service throws `ScopeMismatchError` even when it is built outside a request.

### Patch Changes

- [#7](https://github.com/na2axl/elysiumjs/pull/7) [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148) Thanks [@na2axl](https://github.com/na2axl)! - Elysium runs on Elysia 2 (`elysia@^2.0.0-rc.1`), with TypeBox 1 (`typebox`), `@elysia/openapi` and `@elysia/opentelemetry`.

  Breaking:

  - `TSchema` and `Static` are re-exported from `typebox` instead of `@sinclair/typebox`; `Value` comes from `typebox/value` and `Value.Errors()` returns an array.
  - `Application.onError()` receives a `ServerError` (exported from core). Elysia now names its errors in kebab case; the default error response keeps the upper snake case names (`VALIDATION`, `NOT_FOUND`, `UNKNOWN` for other errors).
  - `AppHttpContext` is a plain interface with `decorator`, `store` and `derive` records (Elysia 2 renamed `resolve` to `derive`).
  - Websocket controllers install Elysia's `websocket()` capability themselves.

  A module or controller `onRequest` middleware that answers now stops the request: Elysia 2 ignores values returned from a transform hook, so the response is thrown as a status and sent as is, without going through `onError`.

  `mnemosyne` builds date columns with `t.Codec` (TypeBox 1 dropped `Transform`). `argus` traces every route of the app it is installed on and ends each span once, keeping the error status when the request failed.

- Updated dependencies [[`6bc48fe`](https://github.com/na2axl/elysiumjs/commit/6bc48febd51f7090c582e73f349eaeff7261241c), [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148), [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82), [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4), [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562), [`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5), [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64), [`0057b67`](https://github.com/na2axl/elysiumjs/commit/0057b67df0e3abecab8a9accff6b55a6a64c21df), [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4), [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d), [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4), [`fbcc7da`](https://github.com/na2axl/elysiumjs/commit/fbcc7dad127db29da42e7a4a5c2124966731cd88), [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576), [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b)]:
  - @elysiumjs/core@0.11.0
