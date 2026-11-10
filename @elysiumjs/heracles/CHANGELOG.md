# @elysiumjs/heracles

## 0.11.1

### Patch Changes

- Updated dependencies [[`791048c`](https://github.com/na2axl/elysiumjs/commit/791048ca9eca4c69a8cb199482541fe95327c786)]:
  - @elysiumjs/core@0.22.0
  - @elysiumjs/redis@0.1.11

## 0.11.0

### Minor Changes

- [#76](https://github.com/na2axl/elysiumjs/pull/76) [`31f5d30`](https://github.com/na2axl/elysiumjs/commit/31f5d30c3e5a9a72cc3f104415a64d7f19d33672) Thanks [@na2axl](https://github.com/na2axl)! - `Scheduler` fan-outs run in the background scopes, with `kind: 'schedule'` and the name of the scheduler. The new `heracles:crons` command prints the cron triggers the scheduled jobs need, reading them from the module graph without booting the application, and `--check <wrangler.jsonc>` checks the cron triggers of the top level and of each environment (`--env <name>` for one); it replaces the `--list` and `--check` options of `heracles:schedule`. `JobRegistry.collect()` reads the jobs of the modules without initialising them.

### Patch Changes

- Updated dependencies [[`5b79d5a`](https://github.com/na2axl/elysiumjs/commit/5b79d5a4b634347ce18766ef08aec12916328ff6), [`9bd29cb`](https://github.com/na2axl/elysiumjs/commit/9bd29cbd10131e4465505de91c78e7f39d242e71)]:
  - @elysiumjs/core@0.21.0
  - @elysiumjs/redis@0.1.10

## 0.10.0

### Minor Changes

- [#73](https://github.com/na2axl/elysiumjs/pull/73) [`920b941`](https://github.com/na2axl/elysiumjs/commit/920b941a9c070c9006fe277abc7a187b9d140af7) Thanks [@na2axl](https://github.com/na2axl)! - `@Background.scope()` registers a service that wraps every unit of background work, the way interceptors wrap requests: heracles jobs (`kind: 'job'`), moirai event handlers (`'event'`) and outbox handlers (`'outbox'`) run inside the scopes, which nest in registration order. `Service.invoke(target, method, args)` calls a method whose parameters take services. Heracles types the constructor arguments of every job class in `Heracles.dispatch()`, scheduler cases and `JobClass<any, any>`, and the parameters of `execute()` take services with `@Service.inject()`. `heracles:schedule --list` prints the scheduled jobs and their cron triggers, and `--check <wrangler.jsonc>` fails when the `triggers.crons` of the file differ from them.

- [#67](https://github.com/na2axl/elysiumjs/pull/67) [`9901020`](https://github.com/na2axl/elysiumjs/commit/99010200522c56bb37cbc44c7ffa311d69972599) Thanks [@na2axl](https://github.com/na2axl)! - `Clock` in core: `Clock.now()` and `Clock.epochMs()` give the application time, which `Clock.freeze()` and `Clock.travel()` stop or move in development and test, and `Clock.use()` takes from another source. Moirai (event, stream, projection and outbox instants, idempotency records), the projection store of moirai-drizzle, Heracles scheduler ticks and Themis (JWT issue and expiry checks, sessions, signed URLs, TOTP) read the time from it.

### Patch Changes

- Updated dependencies [[`920b941`](https://github.com/na2axl/elysiumjs/commit/920b941a9c070c9006fe277abc7a187b9d140af7), [`9901020`](https://github.com/na2axl/elysiumjs/commit/99010200522c56bb37cbc44c7ffa311d69972599), [`7dc7c59`](https://github.com/na2axl/elysiumjs/commit/7dc7c59f67b9f62159064f7958f529f4e6e27e65)]:
  - @elysiumjs/core@0.20.0
  - @elysiumjs/redis@0.1.9

## 0.9.2

### Patch Changes

- [#64](https://github.com/na2axl/elysiumjs/pull/64) [`fb56b18`](https://github.com/na2axl/elysiumjs/commit/fb56b1836cc89d6975e390a45fc46f251db78eb6) Thanks [@na2axl](https://github.com/na2axl)! - A `Scheduler` is made and fans out in the module that declares its job, so it can inject that module's services whoever dispatches the tick, such as `HeraclesWorkersModule` on a cron trigger.

## 0.9.1

### Patch Changes

- Updated dependencies [[`af05b49`](https://github.com/na2axl/elysiumjs/commit/af05b498a2c4d4dafda44f361fe68c490f49a8c7), [`7ffe5eb`](https://github.com/na2axl/elysiumjs/commit/7ffe5eb3926d8a428c6cb14fdc9437758d4c99b5)]:
  - @elysiumjs/core@0.19.0
  - @elysiumjs/redis@0.1.8

## 0.9.0

### Minor Changes

- [#57](https://github.com/na2axl/elysiumjs/pull/57) [`d471a6e`](https://github.com/na2axl/elysiumjs/commit/d471a6e69736e016eb972a0715987df1d7b62438) Thanks [@na2axl](https://github.com/na2axl)! - Services, factory definitions, HTTP controllers, commands and jobs take an `env` option, as modules do: the `NODE_ENV` values in which they are active. In any other environment they are left out when their module loads: an inactive service is not registered (nor returned by `injectAll`), an inactive controller mounts no routes, an inactive command is not listed and an inactive job is neither dispatched nor scheduled. `Environments` reads and records them, and `ModuleGraph.own()` lists the active controllers, commands or jobs of a module. Commands no longer have a static `dev` flag: `@Command.register({ env })` (or the module's `env`) says where a command is available.

  Elysium knows three environments: `development`, `test` and `production`. `Environment` types every `env` option and `currentEnvironment()`, still accepting an app's own names such as `staging`. `Environments.isDevelopment()`, `isTest()` and `isProduction()` tell which one is current, and `Environments.local` (`['development', 'test']`) lists the environments that run on a developer's machine. The detail and stack of server errors are shown in `test` as well as in `development`.

### Patch Changes

- Updated dependencies [[`d471a6e`](https://github.com/na2axl/elysiumjs/commit/d471a6e69736e016eb972a0715987df1d7b62438)]:
  - @elysiumjs/core@0.18.0
  - @elysiumjs/redis@0.1.7

## 0.8.6

### Patch Changes

- Updated dependencies [[`762661e`](https://github.com/na2axl/elysiumjs/commit/762661e362444f431ea84576494322a9a7a81539)]:
  - @elysiumjs/core@0.17.0
  - @elysiumjs/redis@0.1.6

## 0.8.5

### Patch Changes

- Updated dependencies [[`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9)]:
  - @elysiumjs/core@0.16.0
  - @elysiumjs/redis@0.1.5

## 0.8.4

### Patch Changes

- Updated dependencies [[`d663d2e`](https://github.com/na2axl/elysiumjs/commit/d663d2ed95778079f71e53fcaf60a7f8ef570f6d)]:
  - @elysiumjs/core@0.15.0
  - @elysiumjs/redis@0.1.4

## 0.8.3

### Patch Changes

- Updated dependencies [[`359f157`](https://github.com/na2axl/elysiumjs/commit/359f1579b9ad69643da5360d9ca9e80104fbe2f1)]:
  - @elysiumjs/core@0.14.0
  - @elysiumjs/redis@0.1.3

## 0.8.2

### Patch Changes

- Updated dependencies [[`c8d9f53`](https://github.com/na2axl/elysiumjs/commit/c8d9f534eef32621eae121f7008f97dc24808141)]:
  - @elysiumjs/core@0.13.0
  - @elysiumjs/redis@0.1.2

## 0.8.1

### Patch Changes

- Updated dependencies [[`651a755`](https://github.com/na2axl/elysiumjs/commit/651a7557173ce2c6155bcfa8d90cf388ac419821)]:
  - @elysiumjs/core@0.12.0
  - @elysiumjs/redis@0.1.1

## 0.8.0

### Minor Changes

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

- [#5](https://github.com/na2axl/elysiumjs/pull/5) [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82) Thanks [@na2axl](https://github.com/na2axl)! - Core runs outside Bun. Environment variables, timers, the HTTP server, process exit and shutdown signals now come from a `Runtime` set with the new `runtime` option of `@Application.register()` or with `Runtime.use()`. Runtimes ship as packages, each exporting `runtime`: `@elysiumjs/runtime-bun`, `@elysiumjs/runtime-node` and `@elysiumjs/runtime-workers` (which also exports `createRuntime({ env })`).

  Breaking: an application needs a runtime (add `runtime` from `@elysiumjs/runtime-bun`), and `Redis` and `RedisModule` moved from core to the new `@elysiumjs/redis` package, which also accepts a `client` factory for runtimes without `Bun.RedisClient`.

  Console colours are plain ANSI codes instead of `Bun.color`, `node:readline` is loaded only when a prompt runs, and core's dist is built for the `node` target so `node:` imports keep their prefix. `check:runtime` scripts in core and runtime-workers fail when their bundles touch the `Bun` global.

  `create-elysium` gets a runtime step: it installs the chosen runtime package and sets it in the generated app. Bun is selectable today; Node.js and Cloudflare Workers are listed as coming later.

- [#20](https://github.com/na2axl/elysiumjs/pull/20) [`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5) Thanks [@na2axl](https://github.com/na2axl)! - The framework event bus is `Lifecycle`: `Lifecycle.on`, `Lifecycle.once`, `Lifecycle.emit`, `Lifecycle.off`, `@Lifecycle.on()` and `@Lifecycle.once()`, with the `LifecycleEvent` and `LifecycleHandler` types. It carries the framework's own signals (`elysium:error`, app and server lifecycle, heracles queue events) and in-process listeners.

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

- Updated dependencies [[`6bc48fe`](https://github.com/na2axl/elysiumjs/commit/6bc48febd51f7090c582e73f349eaeff7261241c), [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148), [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82), [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4), [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562), [`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5), [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64), [`0057b67`](https://github.com/na2axl/elysiumjs/commit/0057b67df0e3abecab8a9accff6b55a6a64c21df), [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4), [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d), [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4), [`fbcc7da`](https://github.com/na2axl/elysiumjs/commit/fbcc7dad127db29da42e7a4a5c2124966731cd88), [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576), [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b)]:
  - @elysiumjs/core@0.11.0
  - @elysiumjs/redis@0.1.0

## 0.7.2

### Patch Changes

- [`d563113`](https://github.com/na2axl/elysiumjs/commit/d563113316a54c2c52292910c0ee623c670e0009) Thanks [@na2axl](https://github.com/na2axl)! - A queue started while it is being stopped now starts its transport again once the stop finishes, instead of ending up stopped.
- Updated dependencies [[`68a0cdd`](https://github.com/na2axl/elysiumjs/commit/68a0cdd8b2e4a003d6e0af2d78985623cae40428), [`2c49acd`](https://github.com/na2axl/elysiumjs/commit/2c49acd3b552aa43765d70339fa216961499e1b5), [`76ba0ff`](https://github.com/na2axl/elysiumjs/commit/76ba0ff18f3c196cebc2189426328f67cb699f46), [`4ebf029`](https://github.com/na2axl/elysiumjs/commit/4ebf029611e6d753a4f1bfdbe247a75d954d9ded), [`bacce71`](https://github.com/na2axl/elysiumjs/commit/bacce7146f667a1a46bf474dc0344fb0111ae12a)]:
  - @elysiumjs/core@0.10.0

## 0.7.1

### Patch Changes

- Updated dependencies [[`5fef4a7`](https://github.com/na2axl/elysiumjs/commit/5fef4a7199f502fc4fe035299e7670739459a108)]:
  - @elysiumjs/core@0.9.0

## 0.7.0

### Minor Changes

- [`8ac91ab`](https://github.com/na2axl/elysiumjs/commit/8ac91ab676b1119b4eecf0ddb3fd0a3e84017cac) Thanks [@na2axl](https://github.com/na2axl)! - Upgrade dependencies to their latest major versions: wampy 8, zod 4, commander 15, @casl/ability 7, OpenTelemetry SDK 2 (sdk-node 0.300, resources 3), @sentry/bun 11. Generated projects now use TypeScript 7.

  Breaking in `@elysiumjs/mnemosyne-drizzle`: it now requires drizzle-orm 1.0 (release candidate) and generated projects use drizzle-kit 1.0. `ColumnsWithTable` is no longer re-exported. `migration:generate` writes 1.0 migration folders (`<timestamp>_<name>/migration.sql`), and `migration:run` tracks those by folder name while still running flat `*.sql` files. Existing projects can upgrade their migrations folder with `drizzle-kit up`: `migration:run` recognises the moved migrations as already applied and renames their records. The `make:model` stub now generates a `pgTable` and a `DrizzleModel` built from it.

  Breaking in `@elysiumjs/core`: the deprecated `@elysiajs/swagger` plugin is replaced by `@elysiajs/openapi`, and the app option `swagger` is renamed `openapi` (typed `ElysiaOpenAPIConfig | false`). Without a `path`, the docs now live at `/openapi` instead of `/swagger`. The UI options `scalarConfig` and `swaggerOptions` are now `scalar` and `swagger`. Elysia stays on 1.4 (now `^1.4.30`) until Elysia 2 and its OpenAPI plugin are stable.

  Also in `@elysiumjs/core`: the WAMP `onChallenge` callback must return a string (or a promise of one); `null` is no longer accepted. `onError` now receives the error and `onReconnectSuccess` receives wampy's details object. `WampClient` is now wampy's own `Wampy` type. `onOpen` is called by Elysium once the connection is established, since wampy 8 no longer has that callback.

- [`3625883`](https://github.com/na2axl/elysiumjs/commit/3625883dba92f1596e7444ee52f9399d8e9b049f) Thanks [@na2axl](https://github.com/na2axl)! - Drop the `reflect-metadata` dependency. Decorator metadata now lives in a small store in `@elysiumjs/core`, exported as `Metadata` (`define`, `get`, `getOwn`, `has`). Use it instead of `Reflect.defineMetadata` and `Reflect.getMetadata` to read or write Elysium metadata.

  Apps no longer need `import 'reflect-metadata'` in their entrypoint, and generated projects leave it out. Keep `emitDecoratorMetadata` enabled: `@Service.inject()` and `@Command.arg()` still infer types from it. An app that loads `reflect-metadata` for another library keeps working; Elysium also reads the types stored there.

- [`07236b3`](https://github.com/na2axl/elysiumjs/commit/07236b386c2506590d74e8753ce847c1e184b3ee) Thanks [@na2axl](https://github.com/na2axl)! - Introduce the module system. Modules are now the only way to register anything in an Elysium.js app. This is a breaking change with no compatibility layer.

  Breaking changes:

  - `@Module.register()` takes `imports`, `services`, `exports`, `controllers`, `commands`, `jobs`, `prefix` and `env`. Services are private to their module unless exported (or global). The `beforeRegister` and `afterRegister` hooks are replaced by `onInit`, `onServe` and `onDestroy`.
  - Configurable modules are bound with `with()`, for example `HermesModule.with({ level: 'debug' })`. `with()` accepts an object or a function.
  - Decorators only record metadata. Importing a file no longer registers commands, services or event wiring, and the side-effect imports of the packages are removed. List commands, jobs and services in the module that owns them.
  - `@Application.register()` no longer takes `database`, `redis`, `wamp` or `'elysium:hermes'`/`'elysium:cerberus'` keys. Use `DrizzleModule`, `RedisModule`, `WampModule`, `HermesModule` and `CerberusModule`. Package plugins are replaced by modules: add `SentryModule` instead of the `plugin()` function. `plugins` still accepts plain Elysia plugin factories.
  - Constructing an `Application` no longer runs it. Use `await App.start()`; `Application.testing()` boots a module graph for tests. The `styx` binary loads `src/app.ts` (or `index.ts`) and starts the exported application, so a project entry no longer needs to import commands.
  - The job system of core (`Job`, `Worker`, `WorkerPool`, `commandWork`) is removed. `@elysiumjs/heracles` is the only job system: extend its `Job`, list jobs in a module's `jobs`, declare queues with `HeraclesModule.with({ queues })`, and dispatch with `Heracles.dispatch()`.
  - `@elysiumjs/styx` ships `StyxModule`, active in development only. The `migration:generate` and `migration:run` commands move to `DrizzleModule` and are available in production.
  - `@elysiumjs/mnemosyne` ships `MnemosyneModule` for its caches (`redis: false` or `memory: false` opts out). `DrizzleModule` imports it.
  - New modules: `HephaestusModule`, `ArgusModule` (`serviceName` is required), `SentryModule` (needs a `dsn` or `SENTRY_DSN`) and `CerberusModule` (`getSubject` is required).
  - Module and service code throws typed errors (for example `InvalidModuleConfigError`) instead of exiting the process. `Application.run()` prints them and exits; command `run()` methods may still exit, and package plugin factories are unchanged.
  - `Application.register` merges subclass props over the parent's (own props, then own metadata, then parent, then defaults), and concatenates `modules` parent first. Previously defaults and parent values won, so `openapi` could not be enabled.
  - `Heracles.dispatch` starts a stopped queue on first use, so producers no longer start queues. `Queue.start()` is idempotent.
  - `create-elysium` generates apps that use modules, and adds Sentry and Hephaestus to the `modules` list.
  - `@Event.on`/`@Event.once` method listeners on classes in a loaded module's `services` or `controllers` are wired by the kernel and run in their module's context. Jobs, commands and middlewares are not wired, and an instance listener on a class that is not a service throws `EventListenerNotSupportedError`. Listeners on classes not listed in a loaded module no longer fire.
  - New typed errors: `CircularDependencyError` (services that depend on each other, in sync and async resolution), `DuplicateModuleNameError` (two different module classes sharing a name; module scopes and config tokens are name based) and `EventListenerNotSupportedError`.
  - Lazy boot contract: a CLI command initialises only its own module and that module's imports. Sync helpers such as `Database.getConnection()` work when the owning module's `onInit` is synchronous; otherwise they throw `ServiceNotReadyError` naming the module. Use `await Service.resolve()` or set `static boot = true` on the command.

### Patch Changes

- Updated dependencies [[`8ac91ab`](https://github.com/na2axl/elysiumjs/commit/8ac91ab676b1119b4eecf0ddb3fd0a3e84017cac), [`3625883`](https://github.com/na2axl/elysiumjs/commit/3625883dba92f1596e7444ee52f9399d8e9b049f), [`07236b3`](https://github.com/na2axl/elysiumjs/commit/07236b386c2506590d74e8753ce847c1e184b3ee)]:
  - @elysiumjs/core@0.8.0

## 0.6.0

### Minor Changes

- Improve Redis transport with better reliability and performance.
- Add performance monitoring utilities.
- Decouple queue commands (clean, list, work) into their own modules.
- Enhance base and Redis workers.
