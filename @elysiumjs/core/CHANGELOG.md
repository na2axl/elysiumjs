# @elysiumjs/core

## 0.10.0

### Minor Changes

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

- [`76ba0ff`](https://github.com/na2axl/elysiumjs/commit/76ba0ff18f3c196cebc2189426328f67cb699f46) Thanks [@na2axl](https://github.com/na2axl)! - `onRequest` middlewares registered on a module or a controller now run only for its routes. Elysia runs `onRequest` hooks on every request of the app, so such a middleware could reject requests meant for other modules.

  They now run in the transform step of their own routes, so after routing and body parsing, and each one runs right before its own `onTransform`: module `onRequest`, module `onTransform`, then controller `onRequest`, controller `onTransform`. Any value they return still stops the request and is sent as the response. Application middlewares still run `onRequest` before routing, for every request.

- [`bacce71`](https://github.com/na2axl/elysiumjs/commit/bacce7146f667a1a46bf474dc0344fb0111ae12a) Thanks [@na2axl](https://github.com/na2axl)! - WebSocket controllers now run the middlewares registered on them with `@Middleware.register()`, on the upgrade request. `onRequest`, `onTransform` and `onBeforeHandle` can refuse the connection by returning a response. `onAfterHandle` and `onAfterResponse` run after the upgrade, with no response to read.

### Patch Changes

- [`2c49acd`](https://github.com/na2axl/elysiumjs/commit/2c49acd3b552aa43765d70339fa216961499e1b5) Thanks [@na2axl](https://github.com/na2axl)! - The tenant set by a middleware, such as a `TenantMiddleware` reading its own header, is no longer replaced by the `x-tenant-id` header (or `public`) before the handler runs.

- [`4ebf029`](https://github.com/na2axl/elysiumjs/commit/4ebf029611e6d753a4f1bfdbe247a75d954d9ded) Thanks [@na2axl](https://github.com/na2axl)! - WAMP clients use Bun's own `WebSocket` again. The subclass that faked the `protocol` field is gone, since Bun now fills it (oven-sh/bun#18744).

## 0.9.0

### Minor Changes

- [`5fef4a7`](https://github.com/na2axl/elysiumjs/commit/5fef4a7199f502fc4fe035299e7670739459a108) Thanks [@na2axl](https://github.com/na2axl)! - Fix tenant isolation, transactions and query caching in the database layer.

  Breaking changes:

  - `TenantMiddleware.validateTenant()` now rejects every tenant unless you override it, and tenant identifiers must match `TENANT_ID_PATTERN` (1 to 63 ASCII letters, digits, `_` or `-`, not starting with `pg_` and other than `information_schema`, in any case) before it is called. Requests that send any other tenant now fail with `Invalid tenant`. Requests without a tenant still resolve to `public` on `SimpleTenantMiddleware`. To migrate, check the tenant against your own data:

    ```ts
    class OrganizationMiddleware extends SimpleTenantMiddleware {
    	protected async validateTenant(tenant: string): Promise<boolean> {
    		return Organization.exists(tenant);
    	}
    }
    ```

  - `getTenantSchema()`, `registerTenantSchema()` and `wrapTenantSchema()` throw on tenant identifiers that do not match `TENANT_ID_PATTERN`.
  - `setConnectionTenant()` is removed. It set the tenant on a pooled connection for the whole session, so the tenant leaked to other requests. Use `withRLS()`, or `Database.transaction()` in RLS mode, which scope the tenant to a transaction.
  - `RepositoryInterface.update()` and `delete()`, and the `DrizzleRepository` implementations, return `null` when no row has the id. They returned `undefined` while typed as a row. `DrizzleRepository` also requires a model whose table has an `id` column.
  - `@transactional` handlers run through the `db.transaction` service that `DrizzleModule` provides (its name is exported by `@elysiumjs/core` as `DATABASE_TRANSACTION_SERVICE`, and still re-exported by `@elysiumjs/mnemosyne`). A transactional handler without a database module now fails with an error naming the service.
  - `@transactional` generator handlers commit only when the whole stream was sent. A stream closed early, or whose client disconnects (even while the handler is waiting), rolls back.
  - In RLS mode, a transaction is bound to one tenant for its whole life: the tenant set (with a transaction-local `set_config`) when `Database.transaction()`, a `@transactional` handler, `withRLS()` or `withIsolation()` opens it, from the explicit tenant or the current one (`public` when there is none). Work that finds a transaction open on its connection (`withRLS()`, `withIsolation()`, `Database.transaction()`, repository calls) joins it only when its tenant is the transaction's tenant, and throws `TenantMismatchError` otherwise, without running anything: the tenant of an open transaction never changes. Inside a transaction, `Database.getConnection()` only returns it to work for its tenant (the current tenant, or `public`), and throws `TenantMismatchError` otherwise, so raw queries never run for another tenant; queries on the `tx` handle a callback received run as the transaction's tenant. Work for several tenants, such as an admin fan-out, must use one `withRLS()` per tenant outside any transaction, not nested in one.
  - In RLS mode, each repository call made outside a transaction runs in its own transaction bound to the current tenant: `BEGIN`, `set_config` of the tenant, the query, `COMMIT`. These calls do not use the query cache, since the cache is bypassed inside transactions. Group calls in `Database.transaction()` or `withRLS()` to share one transaction.
  - In RLS mode, code running without a tenant in context (background jobs, CLI commands, scripts) is scoped to the `public` tenant. Set the tenant with `withTenant(tenant, () => ...)` around the work (repository calls and `Database.transaction()` then use it), or with `withRLS(tenant, (tx) => ...)`.
  - `migration:run` validates `--tenant` against `TENANT_ID_PATTERN`. Without a terminal it no longer creates a missing schema: pass `--create-schema` (which also skips the question in a terminal), or it fails.
  - Query cache keys start with the connection name, and each connection has its own cache transaction scope. When several applications or environments share one cache store and use the same connection names for different databases, set `cache: { prefix }` on each connection: the prefix comes before the connection name in every key (empty by default).
  - `DrizzleDatabaseCache` keys and values changed: entries written by earlier versions are ignored. The default TTL of cached queries (including with `cache: true`) is now 60 seconds instead of 1 second, and is set with `cache: { ttl }` in seconds.
  - `Cache.memory` keeps a separate LRU per tag namespace, so `lruSize` applies to each namespace.

  Fixes and additions:

  - In RLS mode, repository operations outside a transaction run in one bound to the current tenant, through the strategy's `withIsolation()`. Transactions opened with `Database.transaction()` or by `@transactional` handlers set the tenant variable when they open. `withIsolation()` and `withRLS()` expose their transaction to repositories and `Database.getConnection()`. `TenantMismatchError` is exported.
  - `Database.transaction(callback, connection?)` opens a transaction and registers it for the callback. When a transaction is already open on the same connection, the callback joins it (no savepoint: an error rolls back the whole transaction); in RLS mode only if the current tenant is the transaction's tenant (see above). Transactions are tracked by connection, so every name of a connection (`default` and the name it aliases) sees them, and named connections take part in transactions. `Database.getBaseConnection()`, `Database.inTransaction()` and `Database.runInTransaction()` are added. The `db:tx` context entry is still set for the default connection.
  - `@transactional` generator handlers keep their transaction open until the stream ends, then commit (or roll back if the handler throws). They previously committed before running and failed with `generator.next is not a function`. Generator handlers also see the request context (`tenant`, `http:context`).
  - The query cache is scoped to the connection and the current tenant, is shared correctly by several app instances (table versions stored in the cache), is not read or written inside transactions, and invalidates the tables a transaction changed once it commits. A result is only stored when no mutation happened since its query started, including when concurrent queries of the same key finish out of order. Cached queries honour Drizzle's `ex`, `px`, `exat`, `pxat` and `keepTtl` options.
  - Cache namespaces (`Cache.redis.tags(...)`, `Cache.memory.tags(...)`) no longer overwrite each other: reads, deletes and `clear()` stay within their namespace.
  - `getSessionTenant()` reads the Bun SQL result correctly, and `getCurrentTenant()` works without an application instance (for example under `Application.testing`).
  - `migration:run` takes an advisory lock per tenant, adds a unique index on `elysium_migrations.name` (also to existing tables), finds the migrations from the project root (`.elysiumrc`), sets the `search_path` for the transaction only, asks before opening the transaction whether to create a missing schema, and always closes its client. Existing duplicate migration names must be removed before the unique index can be created.
  - `migration:generate` only removes `"public".` qualifiers from the migration it generates, and leaves string literals, comments and dollar-quoted bodies (`DO` blocks, functions) untouched.
  - `DatabaseDriver.createConnection()` receives the connection name as an optional second argument.
  - `KeyvRedis` deletes with a single `UNLINK` (or `DEL`) per call or batch and reports failed deletes in `clear()` as `error` events.

## 0.8.0

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

## 0.6.0

### Minor Changes

- Extract tenancy module with multi-tenant support (strict, simple, and custom modes).
- Enhance dependency injection with lazy registration.
- Add new base abstractions for commands, middlewares, and repositories.
- Add built-in `ConsoleLogger` and `RequestLoggerMiddleware`.
- Remove usage of `ELYSIUM_BUILD` macro.
