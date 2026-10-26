# @elysiumjs/hermes

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
