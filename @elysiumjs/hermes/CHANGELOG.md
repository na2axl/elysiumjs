# @elysiumjs/hermes

## 0.5.12

### Patch Changes

- Updated dependencies [[`8235094`](https://github.com/na2axl/elysiumjs/commit/823509464b9f71a80fdac117418b7e3e1213103c)]:
  - @elysiumjs/core@0.23.0

## 0.5.11

### Patch Changes

- Updated dependencies [[`791048c`](https://github.com/na2axl/elysiumjs/commit/791048ca9eca4c69a8cb199482541fe95327c786)]:
  - @elysiumjs/core@0.22.0

## 0.5.10

### Patch Changes

- Updated dependencies [[`5b79d5a`](https://github.com/na2axl/elysiumjs/commit/5b79d5a4b634347ce18766ef08aec12916328ff6), [`9bd29cb`](https://github.com/na2axl/elysiumjs/commit/9bd29cbd10131e4465505de91c78e7f39d242e71)]:
  - @elysiumjs/core@0.21.0

## 0.5.9

### Patch Changes

- Updated dependencies [[`920b941`](https://github.com/na2axl/elysiumjs/commit/920b941a9c070c9006fe277abc7a187b9d140af7), [`9901020`](https://github.com/na2axl/elysiumjs/commit/99010200522c56bb37cbc44c7ffa311d69972599), [`7dc7c59`](https://github.com/na2axl/elysiumjs/commit/7dc7c59f67b9f62159064f7958f529f4e6e27e65)]:
  - @elysiumjs/core@0.20.0

## 0.5.8

### Patch Changes

- Updated dependencies [[`af05b49`](https://github.com/na2axl/elysiumjs/commit/af05b498a2c4d4dafda44f361fe68c490f49a8c7), [`7ffe5eb`](https://github.com/na2axl/elysiumjs/commit/7ffe5eb3926d8a428c6cb14fdc9437758d4c99b5)]:
  - @elysiumjs/core@0.19.0

## 0.5.7

### Patch Changes

- Updated dependencies [[`d471a6e`](https://github.com/na2axl/elysiumjs/commit/d471a6e69736e016eb972a0715987df1d7b62438)]:
  - @elysiumjs/core@0.18.0

## 0.5.6

### Patch Changes

- Updated dependencies [[`762661e`](https://github.com/na2axl/elysiumjs/commit/762661e362444f431ea84576494322a9a7a81539)]:
  - @elysiumjs/core@0.17.0

## 0.5.5

### Patch Changes

- Updated dependencies [[`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9)]:
  - @elysiumjs/core@0.16.0

## 0.5.4

### Patch Changes

- Updated dependencies [[`d663d2e`](https://github.com/na2axl/elysiumjs/commit/d663d2ed95778079f71e53fcaf60a7f8ef570f6d)]:
  - @elysiumjs/core@0.15.0

## 0.5.3

### Patch Changes

- Updated dependencies [[`359f157`](https://github.com/na2axl/elysiumjs/commit/359f1579b9ad69643da5360d9ca9e80104fbe2f1)]:
  - @elysiumjs/core@0.14.0

## 0.5.2

### Patch Changes

- Updated dependencies [[`c8d9f53`](https://github.com/na2axl/elysiumjs/commit/c8d9f534eef32621eae121f7008f97dc24808141)]:
  - @elysiumjs/core@0.13.0

## 0.5.1

### Patch Changes

- Updated dependencies [[`651a755`](https://github.com/na2axl/elysiumjs/commit/651a7557173ce2c6155bcfa8d90cf388ac419821)]:
  - @elysiumjs/core@0.12.0

## 0.5.0

### Minor Changes

- [#11](https://github.com/na2axl/elysiumjs/pull/11) [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4) Thanks [@na2axl](https://github.com/na2axl)! - Services are identified by their class, or by the name given to `@Service.register({ name })`. Class names are never used as identifiers, so services resolve the same way in minified builds; `bun run check:minified` in core bundles a minified app and checks that every service resolves. `@Service.inject()` without an argument injects the class of the parameter type, and throws when the type is unknown. Factory services in a module's `services` take a class or a name in `name`.

  `ServiceScope.REQUEST` gives one instance per HTTP request, shared by the request's middlewares, controller and handler. `Service.runInRequestScope(fn)` opens a request scope outside a route. Resolving a request-scoped service outside a request throws `OutsideRequestScopeError`, and a singleton (or a server-scoped controller) depending on one throws `ScopeMismatchError`.

  `HermesModule` registers the logger by the `HermesLogger` class and as `logger`.

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

- Updated dependencies [[`6bc48fe`](https://github.com/na2axl/elysiumjs/commit/6bc48febd51f7090c582e73f349eaeff7261241c), [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148), [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82), [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4), [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562), [`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5), [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64), [`0057b67`](https://github.com/na2axl/elysiumjs/commit/0057b67df0e3abecab8a9accff6b55a6a64c21df), [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4), [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d), [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4), [`fbcc7da`](https://github.com/na2axl/elysiumjs/commit/fbcc7dad127db29da42e7a4a5c2124966731cd88), [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576), [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b)]:
  - @elysiumjs/core@0.11.0

## 0.4.3

### Patch Changes

- [`04773f2`](https://github.com/na2axl/elysiumjs/commit/04773f2acd4ab1c762a80ee903715d90f1c08e21) Thanks [@na2axl](https://github.com/na2axl)! - Ship the type declarations. The packages pointed `types` at `dist/index.d.ts` but their build never wrote it, so TypeScript projects got no types for them.

## 0.4.2

### Patch Changes

- [`68a0cdd`](https://github.com/na2axl/elysiumjs/commit/68a0cdd8b2e4a003d6e0af2d78985623cae40428) Thanks [@na2axl](https://github.com/na2axl)! - Route the framework's own diagnostics through the logger service.

  Breaking changes:

  - `@Event.listen()` with a mode other than `on` or `once` now throws an `ElysiumError` when the class is defined, instead of logging to the console and ignoring the listener.

  Fixes and additions:

  - `getLogger(context?)` and `LOGGER_SERVICE` (`'logger'`) are exported by `@elysiumjs/core`. `getLogger()` returns the `logger` service when one is registered (such as the one `HermesModule` provides), and a `ConsoleLogger` otherwise or when the service cannot be built or fails to create a child logger. It is resolved at call time from the global scope only, so a module's own `logger` service does not replace it, and returns a child logger bound to `context` when one is given.
  - `Middleware.logger` (used by `RequestLoggerMiddleware`) falls back to a `ConsoleLogger` when no `logger` service is registered. It threw before.
  - Core diagnostics go through the logger with structured context instead of `console.*`: the debug-mode request log (`debug`, with `method` and `url`), `onDestroy` failures on shutdown (`error`, with `target` and `error`), WAMP connection attempts (`warn` while retrying, `error` when giving up, with `connection`, `attempt`/`attempts`, `maxRetries` and `error`), and WAMP registrations and subscriptions (`info`, with `connection`, `topic` and the registration or subscription id).
  - In debug mode, incoming requests are logged through the logger at `debug` level instead of printed with `console.log`. With `HermesModule`, they show only when its `level` is `debug` or `trace`.
  - A failed WAMP registration or subscription is logged at `error` level and emitted as `elysium:error` with an error naming the topic and the connection, instead of becoming an unhandled rejection.
  - The `elysium:error` emitted for a WAMP client error names the connection and its URL and includes the client's message (or the value it reported, when it is not an `Error`), with that value as `cause` when there is one.
  - `HermesLogger` serialises an `error` field of the log context like pino's `err` (type, message and stack), so logged errors keep their stack trace. Elysium logs errors under `error`.
  - `@Logged` resolves its fallback logger with `getLogger()`, and logs a thrown error whole under `error` (it logged only its message), so its stack trace is kept.
  - The `elysium:error` emitted when a WAMP connection gives up states the number of attempts actually made (the first one plus the retries), as the logged `attempts` does. It stated `maxRetries` before.

- Updated dependencies [[`68a0cdd`](https://github.com/na2axl/elysiumjs/commit/68a0cdd8b2e4a003d6e0af2d78985623cae40428), [`2c49acd`](https://github.com/na2axl/elysiumjs/commit/2c49acd3b552aa43765d70339fa216961499e1b5), [`76ba0ff`](https://github.com/na2axl/elysiumjs/commit/76ba0ff18f3c196cebc2189426328f67cb699f46), [`4ebf029`](https://github.com/na2axl/elysiumjs/commit/4ebf029611e6d753a4f1bfdbe247a75d954d9ded), [`bacce71`](https://github.com/na2axl/elysiumjs/commit/bacce7146f667a1a46bf474dc0344fb0111ae12a)]:
  - @elysiumjs/core@0.10.0

## 0.4.1

### Patch Changes

- Updated dependencies [[`5fef4a7`](https://github.com/na2axl/elysiumjs/commit/5fef4a7199f502fc4fe035299e7670739459a108)]:
  - @elysiumjs/core@0.9.0

## 0.4.0

### Minor Changes

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

## 0.3.0

### Minor Changes

- Add HTTP transport for remote log shipping.
- Add `@Logged` decorator for automatic method-level logging.
- Implement lazy DI registration and logger factory pattern.
- Export new types and improve overall logging API.
