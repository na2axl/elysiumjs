---
'@elysiumjs/core': minor
'@elysiumjs/mnemosyne': minor
'@elysiumjs/mnemosyne-drizzle': minor
---

Fix tenant isolation, transactions and query caching in the database layer.

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
- In RLS mode, a transaction is bound to one tenant for its whole life: the tenant set (with a transaction-local `set_config`) when `Database.transaction()`, a `@transactional` handler, `withRLS()` or `withIsolation()` opens it, from the explicit tenant or the current one (`public` when there is none). Work that finds a transaction open on its connection (`withRLS()`, `withIsolation()`, `Database.transaction()`, repository calls) joins it only when its tenant is the transaction's tenant, and throws `TenantMismatchError` otherwise, without running anything: the tenant of an open transaction never changes. Raw queries on `Database.getConnection()` (or the `tx` handle) inside a transaction always run as its tenant. Work for several tenants, such as an admin fan-out, must use one `withRLS()` per tenant outside any transaction, not nested in one.
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
