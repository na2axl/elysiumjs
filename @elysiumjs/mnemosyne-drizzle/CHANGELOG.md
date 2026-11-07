# @elysiumjs/mnemosyne-drizzle

## 0.4.2

### Patch Changes

- Updated dependencies [[`651a755`](https://github.com/na2axl/elysiumjs/commit/651a7557173ce2c6155bcfa8d90cf388ac419821)]:
  - @elysiumjs/core@0.12.0
  - @elysiumjs/mnemosyne@0.5.1
  - @elysiumjs/runtime-workers@0.1.1

## 0.4.1

### Patch Changes

- Updated dependencies [[`4cd1ef2`](https://github.com/na2axl/elysiumjs/commit/4cd1ef217826164e69cd641ca99f74c6f5a7ebe7)]:
  - @elysiumjs/mnemosyne@0.5.0
  - @elysiumjs/core@0.11.1
  - @elysiumjs/runtime-workers@0.1.0

## 0.4.0

### Minor Changes

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

### Patch Changes

- [#11](https://github.com/na2axl/elysiumjs/pull/11) [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4) Thanks [@na2axl](https://github.com/na2axl)! - Services are identified by their class, or by the name given to `@Service.register({ name })`. Class names are never used as identifiers, so services resolve the same way in minified builds; `bun run check:minified` in core bundles a minified app and checks that every service resolves. `@Service.inject()` without an argument injects the class of the parameter type, and throws when the type is unknown. Factory services in a module's `services` take a class or a name in `name`.

  `ServiceScope.REQUEST` gives one instance per HTTP request, shared by the request's middlewares, controller and handler. `Service.runInRequestScope(fn)` opens a request scope outside a route. Resolving a request-scoped service outside a request throws `OutsideRequestScopeError`, and a singleton (or a server-scoped controller) depending on one throws `ScopeMismatchError`.

  `HermesModule` registers the logger by the `HermesLogger` class and as `logger`.

- Updated dependencies [[`6bc48fe`](https://github.com/na2axl/elysiumjs/commit/6bc48febd51f7090c582e73f349eaeff7261241c), [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148), [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82), [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4), [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562), [`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5), [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64), [`0057b67`](https://github.com/na2axl/elysiumjs/commit/0057b67df0e3abecab8a9accff6b55a6a64c21df), [`1738567`](https://github.com/na2axl/elysiumjs/commit/17385674c14991f0ddb27eb6ee967afbcebcc307), [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4), [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d), [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4), [`fbcc7da`](https://github.com/na2axl/elysiumjs/commit/fbcc7dad127db29da42e7a4a5c2124966731cd88), [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576), [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b)]:
  - @elysiumjs/core@0.11.0
  - @elysiumjs/runtime-workers@0.1.0
  - @elysiumjs/mnemosyne@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`68a0cdd`](https://github.com/na2axl/elysiumjs/commit/68a0cdd8b2e4a003d6e0af2d78985623cae40428), [`2c49acd`](https://github.com/na2axl/elysiumjs/commit/2c49acd3b552aa43765d70339fa216961499e1b5), [`76ba0ff`](https://github.com/na2axl/elysiumjs/commit/76ba0ff18f3c196cebc2189426328f67cb699f46), [`4ebf029`](https://github.com/na2axl/elysiumjs/commit/4ebf029611e6d753a4f1bfdbe247a75d954d9ded), [`bacce71`](https://github.com/na2axl/elysiumjs/commit/bacce7146f667a1a46bf474dc0344fb0111ae12a)]:
  - @elysiumjs/core@0.10.0
  - @elysiumjs/mnemosyne@0.3.1

## 0.3.0

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

### Patch Changes

- [`ea419db`](https://github.com/na2axl/elysiumjs/commit/ea419db) Thanks [@na2axl](https://github.com/na2axl)! - `DrizzleModel()` accepts tables made with `pgTable()` again. Under TypeScript 7 it rejected every concrete table, so models and repositories over them did not typecheck.
- [`3987671`](https://github.com/na2axl/elysiumjs/commit/3987671) Thanks [@na2axl](https://github.com/na2axl)! - The package only contains its build output, README and changelog. It no longer ships sources, tests or local tool state.
- Updated dependencies [[`5fef4a7`](https://github.com/na2axl/elysiumjs/commit/5fef4a7199f502fc4fe035299e7670739459a108)]:
  - @elysiumjs/core@0.9.0
  - @elysiumjs/mnemosyne@0.3.0

## 0.2.0

### Minor Changes

- [`8ac91ab`](https://github.com/na2axl/elysiumjs/commit/8ac91ab676b1119b4eecf0ddb3fd0a3e84017cac) Thanks [@na2axl](https://github.com/na2axl)! - Upgrade dependencies to their latest major versions: wampy 8, zod 4, commander 15, @casl/ability 7, OpenTelemetry SDK 2 (sdk-node 0.300, resources 3), @sentry/bun 11. Generated projects now use TypeScript 7.

  Breaking in `@elysiumjs/mnemosyne-drizzle`: it now requires drizzle-orm 1.0 (release candidate) and generated projects use drizzle-kit 1.0. `ColumnsWithTable` is no longer re-exported. `migration:generate` writes 1.0 migration folders (`<timestamp>_<name>/migration.sql`), and `migration:run` tracks those by folder name while still running flat `*.sql` files. Existing projects can upgrade their migrations folder with `drizzle-kit up`: `migration:run` recognises the moved migrations as already applied and renames their records. The `make:model` stub now generates a `pgTable` and a `DrizzleModel` built from it.

  Breaking in `@elysiumjs/core`: the deprecated `@elysiajs/swagger` plugin is replaced by `@elysiajs/openapi`, and the app option `swagger` is renamed `openapi` (typed `ElysiaOpenAPIConfig | false`). Without a `path`, the docs now live at `/openapi` instead of `/swagger`. The UI options `scalarConfig` and `swaggerOptions` are now `scalar` and `swagger`. Elysia stays on 1.4 (now `^1.4.30`) until Elysia 2 and its OpenAPI plugin are stable.

  Also in `@elysiumjs/core`: the WAMP `onChallenge` callback must return a string (or a promise of one); `null` is no longer accepted. `onError` now receives the error and `onReconnectSuccess` receives wampy's details object. `WampClient` is now wampy's own `Wampy` type. `onOpen` is called by Elysium once the connection is established, since wampy 8 no longer has that callback.

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
  - @elysiumjs/mnemosyne@0.2.0
