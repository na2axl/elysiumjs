---
'@elysiumjs/core': minor
'@elysiumjs/mnemosyne': minor
'@elysiumjs/mnemosyne-drizzle': minor
---

Fix tenant isolation, transactions and query caching in the database layer.

Breaking changes:

- `TenantMiddleware.validateTenant()` now rejects every tenant unless you override it, and tenant identifiers must match `TENANT_ID_PATTERN` (1 to 63 ASCII letters, digits, `_` or `-`) before it is called. Requests that send any other tenant now fail with `Invalid tenant`. Requests without a tenant still resolve to `public` on `SimpleTenantMiddleware`. To migrate, check the tenant against your own data:

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
- `@transactional` handlers run through the `db.transaction` service that `DrizzleModule` provides. A transactional handler without a database module now fails with an error naming the service.
- `DrizzleDatabaseCache` keys and values changed: entries written by earlier versions are ignored. The default TTL of cached queries (including with `cache: true`) is now 60 seconds instead of 1 second, and is set with `cache: { ttl }` in seconds.
- `Cache.memory` keeps a separate LRU per tag namespace, so `lruSize` applies to each namespace.

Fixes and additions:

- In RLS mode, repository operations outside a transaction run in one scoped to the current tenant, through the strategy's `withIsolation()`. Transactions opened with `Database.transaction()` or by `@transactional` handlers set the tenant variable when they open. `withIsolation()` and `withRLS()` expose their transaction to repositories and `Database.getConnection()`, and switch the tenant of an already open transaction for the callback only.
- `Database.transaction(callback, connection?)` opens a transaction and registers it for the callback. Transactions are tracked by connection, so every name of a connection (`default` and the name it aliases) sees them, and named connections take part in transactions. `Database.getBaseConnection()`, `Database.inTransaction()` and `Database.runInTransaction()` are added. The `db:tx` context entry is still set for the default connection.
- `@transactional` generator handlers keep their transaction open until the stream ends, then commit (or roll back if the handler throws). They previously committed before running and failed with `generator.next is not a function`. Generator handlers also see the request context (`tenant`, `http:context`).
- The query cache is scoped to the current tenant, is shared correctly by several app instances (table versions stored in the cache), is not read or written inside transactions, and invalidates the tables a transaction changed once it commits. Cached queries honour Drizzle's `ex`, `px`, `exat`, `pxat` and `keepTtl` options.
- Cache namespaces (`Cache.redis.tags(...)`, `Cache.memory.tags(...)`) no longer overwrite each other: reads, deletes and `clear()` stay within their namespace.
- `getSessionTenant()` reads the Bun SQL result correctly, and `getCurrentTenant()` works without an application instance (for example under `Application.testing`).
- `migration:run` takes an advisory lock per tenant, adds a unique index on `elysium_migrations.name` (also to existing tables), finds the migrations from the project root (`.elysiumrc`), sets the `search_path` for the transaction only, and asks before opening the transaction whether to create a missing schema (without a terminal, it creates it). Existing duplicate migration names must be removed before the unique index can be created.
- `migration:generate` only removes `"public".` qualifiers from the migration it generates, and leaves string literals, comments and dollar-quoted bodies (`DO` blocks, functions) untouched.
- `KeyvRedis` deletes with a single `UNLINK` (or `DEL`) per call or batch and reports failed deletes in `clear()` as `error` events.
