# @elysiumjs/drizzle

The Drizzle ORM backend of [Elysium.js](https://github.com/na2axl/elysiumjs): database connections and drivers for `@elysiumjs/olympus/mnemosyne` (`/bun-sql`, `/postgres-js`, `/node-postgres` and `/hyperdrive` subpaths), models, repositories, queries, migrations and tenancy, the Postgres stores of `@elysiumjs/olympus/moirai`, and the `postgres` driver of the `Lock` port.

## Installation

```bash
bun add @elysiumjs/olympus @elysiumjs/drizzle
```

## Usage

Add `DrizzleModule` to your application. It declares the connections as global services, registers the tenancy strategy and provides the `migration:generate` and `migration:run` commands.

```ts
import { DrizzleModule } from '@elysiumjs/drizzle';
import { Application } from '@elysiumjs/olympus';

@Application.register({
	modules: [
		DrizzleModule.with({
			default: 'main',
			connections: {
				main: { connection: process.env.DATABASE_URL! }
			}
		})
	]
})
export class App extends Application {}
```

`with()` also accepts a function, which is called when the module is booted: `DrizzleModule.with(() => ({ ... }))`. Set `tenancy` to switch between schema (default) and RLS tenancy.

Define models with the enhanced `pgTable`:

```ts
import { DrizzleModel, pgTable } from '@elysiumjs/drizzle';
import { Repository } from '@elysiumjs/olympus/mnemosyne';
import { uuid, varchar } from 'drizzle-orm/pg-core';

const users = pgTable('users', {
	id: uuid().primaryKey().defaultRandom(),
	name: varchar({ length: 255 }).notNull()
});

export class UserModel extends DrizzleModel(users, { supportTenancy: true }) {}
export class UserRepository extends Repository(UserModel) {}
```

`Repository(Model)` comes from `@elysiumjs/olympus/mnemosyne` and runs on the Drizzle repository adapter for the models of `DrizzleModel()`: `this.db` is the Drizzle connection (or the transaction open on it), and the scope of `list()`, `count()`, `deleteWhere()` and `Pruner` is an SQL condition. Statements honour the tenant isolation of row-level security; a custom query that must too goes through `this.withConnection((db) => ...)`.

Repositories answer instances of the model, typed by the table's select type: add getters and methods to the model class, and turn the rows of a custom query into instances with `this.hydrate(rows)`. The model name of a `DrizzleModel` is its table name with its schema (`public.users`).

The repository finds rows by the table's primary key. A table without an `id` column, or with a composite primary key, takes the key as an object; `key` names other columns to use instead:

```ts
export class MembershipRepository extends Repository(MembershipModel) {}
await memberships.find({ teamId, userId });

export class SessionRepository extends Repository(SessionModel, { key: ['token'] }) {}
await sessions.find('abc123');
```

`list(query, scope)` and `count(query, scope)` take a condition the rows must also meet, on top of the filters of the query:

```ts
public listFor(userId: string, query: ParsedQuery<'cursor'>) {
	return this.list(query, eq(posts.authorId, userId));
}
```

`deleteWhere(scope, limit)` deletes at most `limit` rows of a scope in one statement, partitioned tables included, which is how `Pruner(Model)` jobs delete stale rows chunk by chunk.

### Migration hooks

`migration:run --tenant <name>` applies the pending migrations of a tenant in one transaction, under a lock per tenant. It works on the connection given by `--connection` (`default` when omitted), whose driver runs the migrations: `bun-sql`, `postgres-js` and `node-postgres` do, and `hyperdrive` hands them to the driver it wraps, which needs its binding. A custom driver runs them by implementing `migrations(connection)`, with `templateClientMigrations()` or `nodePostgresMigrations()` for clients like those.

A migration hook runs SQL around the migrations, in the same transaction: when a hook fails, the whole run is rolled back. Register it with `@Migration.hook()` and list it in the `services` of a module. Every method is optional:

```ts
import type { MigrationHook, MigrationRun, MigrationStep } from '@elysiumjs/drizzle';

import { Migration, sql } from '@elysiumjs/drizzle';

@Migration.hook()
export class DatabaseHook implements MigrationHook {
	public async before({ db }: MigrationRun) {
		await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
	}

	public async beforeEach({ name }: MigrationStep) {}

	public async afterEach({ db, name }: MigrationStep) {
		const [{ count }] = await db.execute<{ count: number }>(
			sql`SELECT count(*)::int AS count FROM pg_constraint WHERE ...`
		);
		if (count > 0) throw new Error(`${name} adds a foreign key across schemas`);
	}

	public async after({ db, tenant }: MigrationRun) {
		await db.execute(sql`GRANT USAGE ON SCHEMA ${sql.identifier(tenant)} TO app`);
	}
}
```

- `before` runs once the tenant schema and the migrations table exist, and `after` at the end. Both also run when no migration is pending, so `after` fits what must stay in place, such as grants or partitions.
- `beforeEach` runs before each migration, and `afterEach` once it is recorded.
- A `MigrationRun` holds the transaction (`db`), the `tenant`, the `connection`, the `batch`, the `pending` migrations and the ones `applied` so far. A `MigrationStep` holds the transaction, the `name` and `path` of the migration, and its `run`.
- `db.execute(query)` runs one statement written with the `sql` template of Drizzle and returns its rows. `db.script(text)` runs several statements without parameters.

Hooks run for every tenant, in the order the modules register them: read `tenant` to act on some tenants only.

### Table markers

`DrizzleTable.define()` marks a table with what `migration:generate` adds to the migration that creates it. Later migrations are left as they are.

```ts
import { DrizzleTable } from '@elysiumjs/drizzle';
import { pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const kernel = pgSchema('kernel');

export const audit = DrizzleTable.define(
	DrizzleTable.partitioned({ range: 'recorded_at' }),
	DrizzleTable.afterCreate(
		({ qualified }) =>
			`CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON ${qualified} FOR EACH ROW EXECUTE FUNCTION forbid_change()`
	)
)(
	kernel.table(
		'audit',
		{
			id: uuid('id').notNull().defaultRandom(),
			action: text('action').notNull(),
			recordedAt: timestamp('recorded_at').notNull().defaultNow()
		},
		(t) => [primaryKey({ columns: [t.id, t.recordedAt] })]
	)
);
```

- `DrizzleTable.partitioned({ range })` adds `PARTITION BY RANGE (...)` to the `CREATE TABLE`. `range` is a column name in the database, a function returning the column (`(t) => t.recordedAt`), or several of them. The primary key and unique constraints must include those columns.
- `DrizzleTable.afterCreate(build)` adds SQL right after the table is created, as its own statement. `build` receives the `schema` (`undefined` for `public`), the `name` and the quoted, schema-qualified `qualified` name, and returns a string or a `sql` template.
- `DrizzleTable.define()` returns the table it marks, so its type is unchanged. Marking a table again adds to its markers.

## Moirai tables

```ts
import { moiraiTables } from '@elysiumjs/drizzle';

// In the Drizzle schema, so that migration:generate creates them.
export const billing = moiraiTables('billing');
```

`moiraiTables(schema?, options?)` builds the `idempotency_keys`, `outbox`, `inbox`, `events` and `projections` tables, in a Postgres schema when one is given (one set of tables per domain schema, for example).

With `{ partitioned: true }`, `events` is partitioned by range of `occurred_at` and `outbox` by range of `created_at`. Their primary and unique keys then include that column, and `migration:generate` creates them with `PARTITION BY RANGE`. The partitions are up to the app: create them in a migration hook, or add them to the migration that creates the table with `DrizzleTable.afterCreate()` from `@elysiumjs/drizzle`:

```ts
import { DrizzleTable } from '@elysiumjs/drizzle';

const tables = moiraiTables('billing', { partitioned: true });

export const billing = {
	...tables,
	events: DrizzleTable.define(
		DrizzleTable.afterCreate(
			({ qualified }) => `CREATE TABLE "billing"."events_default" PARTITION OF ${qualified} DEFAULT`
		)
	)(tables.events)
};
```

## Moirai stores

```ts
import {
	DrizzleEventStore,
	DrizzleIdempotencyStore,
	DrizzleInboxStore,
	DrizzleOutboxStore,
	DrizzleProjectionStorage
} from '@elysiumjs/drizzle';
import { Lock } from '@elysiumjs/olympus';
import { MoiraiModule } from '@elysiumjs/olympus/moirai';

MoiraiModule.with({
	idempotency: () => new DrizzleIdempotencyStore({ table: billing.idempotencyKeys }),
	outbox: () => new DrizzleOutboxStore({ table: billing.outbox }),
	inbox: () => new DrizzleInboxStore({ table: billing.inbox }),
	lock: () => Lock.for('postgres'),
	events: () => new DrizzleEventStore({ table: billing.events }),
	projections: () => new DrizzleProjectionStorage({ table: billing.projections })
});
```

- `DrizzleIdempotencyStore` keeps the response of an idempotent action per key.
- `DrizzleOutboxStore` claims due rows with `FOR UPDATE SKIP LOCKED`, so that several relays never take the same row.
- `DrizzleInboxStore` records the messages a consumer has processed.
- `DrizzleEventStore` keeps the event streams of aggregates. An append locks each stream it writes with a transaction advisory lock and checks that the stream ends right before the first appended version, so a stale writer gets a `ConcurrencyConflictError` even when the unique key of the table spans more columns, such as a partition key. Postgres gives each event its `position` and the id of the transaction that wrote it (`transaction_id`).
- `DrizzleProjectionStorage` resets the tables of the `models` of a projection (`DrizzleModel`s or Drizzle tables) with `DELETE` in the rebuild's transaction, so readers see the rows until it commits, and keeps the version each projection was built with.
- `PgAdvisoryLock` is the `postgres` driver of the `Lock` port. It serializes the actions that share a `serializeBy` key with a transaction advisory lock, which ends with the transaction. Use it inside a unit of work only: outside a transaction the lock ends with its own statement, so it does not suit the scheduler of `HeraclesModule`.

Each store takes `connection`, the name of a database connection, which defaults to `default`. A store's `table` needs the columns of the matching table in `moiraiTables`, and may add others: it can live in a domain's own `pgSchema` and have another primary key, such as a composite one. `StoreTable<T>` is the type it accepts.

## Notification store

`notificationsTable()` builds the table of the notification store of `@elysiumjs/olympus/hermes`, and `DrizzleNotificationStore` (the `drizzle` driver of `NotificationStore`) keeps the notifications of the `inbox` channel in it:

```ts
import { notificationsTable } from '@elysiumjs/drizzle';
import { HermesModule, NotificationStore } from '@elysiumjs/olympus/hermes';

export const notifications = notificationsTable(); // or notificationsTable('notifications', 'social')

HermesModule.with({ store: () => NotificationStore.for('drizzle', { table: notifications }) });
```

The table keeps one row per delivery id, and has an index on the notifiable and the id, which pages use, and a partial index on unread notifications. Any table with the same columns works, given as `table`, with an optional `connection`.

## File store

`filesTable()` builds the table of the file store of `@elysiumjs/olympus/pithos`, and `DrizzleFileStore` (the `drizzle` driver of `FileStore`) keeps the file records in it:

```ts
import { filesTable } from '@elysiumjs/drizzle';
import { FileStore, PithosModule } from '@elysiumjs/olympus/pithos';

export const files = filesTable(); // or filesTable('files', 'media')

PithosModule.with({ disks, files: { store: () => FileStore.for('drizzle', { table: files }) } });
```

Each change of a record is one conditional `UPDATE`, so only one of two racing requests wins. The table has an index on the owner, a partial index on pending uploads by uploader, which the cap on uploads in progress reads, and a partial index on the files whose time runs out (`pending`, `finishing` and `ready`), which pruning reads. Any table with the same columns works, given as `table`, with an optional `connection`.

## Abilities as SQL

`rulesToDrizzle(ability, action, subject, table)` turns the rules of an ability from `@elysiumjs/olympus/cerberus` into a condition over a table, so a list answers only the rows the same rules let the actor act on:

```ts
import { rulesToDrizzle } from '@elysiumjs/drizzle';
import { Cerberus } from '@elysiumjs/olympus/cerberus';

const ability = await Cerberus.ability();
const editable = await db
	.select()
	.from(posts)
	.where(rulesToDrizzle(ability, 'update', 'Post', posts)); // false without an ability
```

Rule fields are the properties of the table's columns. A `cannot` bounds every `can` before it. `$eq`, `$ne`, `$in` and `$nin` treat `NULL` as CASL does, and a `cannot` never refuses a row whose condition is unknown because of a `NULL`; `$lt`, `$lte`, `$gt`, `$gte` and `$exists` follow SQL, where `NULL` compares to nothing, so keep the columns they read `NOT NULL` or add an explicit condition. No ability, or no rule that allows the action: `false`; a rule without conditions: `true`. The operators are `$eq`, `$ne`, `$in`, `$nin`, `$lt`, `$lte`, `$gt`, `$gte`, `$exists`, `$and`, `$or` and `$not`; any other operator, or a field the table does not have, throws `UntranslatableRuleError`.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
