# @elysiumjs/mnemosyne-drizzle

Drizzle ORM driver for `@elysiumjs/mnemosyne`.

## Installation

```bash
bun add @elysiumjs/mnemosyne-drizzle
```

## Usage

Add `DrizzleModule` to your application. It declares the connections as global services, registers the tenancy strategy and provides the `migration:generate` and `migration:run` commands.

```ts
import { Application } from '@elysiumjs/core';
import { DrizzleModule } from '@elysiumjs/mnemosyne-drizzle';

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
import { DrizzleModel, DrizzleRepository, pgTable } from '@elysiumjs/mnemosyne-drizzle';
import { uuid, varchar } from 'drizzle-orm/pg-core';

const users = pgTable('users', {
	id: uuid().primaryKey().defaultRandom(),
	name: varchar({ length: 255 }).notNull()
});

export class UserModel extends DrizzleModel(users, { supportTenancy: true }) {}
export class UserRepository extends DrizzleRepository(UserModel) {}
```

The repository finds rows by the table's primary key. A table without an `id` column, or with a composite primary key, takes the key as an object; `key` names other columns to use instead:

```ts
export class MembershipRepository extends DrizzleRepository(MembershipModel) {}
await memberships.find({ teamId, userId });

export class SessionRepository extends DrizzleRepository(SessionModel, { key: ['token'] }) {}
await sessions.find('abc123');
```

`list(query, scope)` and `count(query, scope)` take a condition the rows must also meet, on top of the filters of the query:

```ts
public listFor(userId: string, query: ParsedQuery<'cursor'>) {
	return this.list(query, eq(posts.authorId, userId));
}
```

### Migration hooks

`migration:run --tenant <name>` applies the pending migrations of a tenant in one transaction, under a lock per tenant. A migration hook runs SQL around them, in the same transaction: when a hook fails, the whole run is rolled back. Register it with `@Migration.hook()` and list it in the `services` of a module. Every method is optional:

```ts
import type { MigrationHook, MigrationRun, MigrationStep } from '@elysiumjs/mnemosyne-drizzle';

import { Migration } from '@elysiumjs/mnemosyne-drizzle';

@Migration.hook()
export class DatabaseHook implements MigrationHook {
	public async before({ sql }: MigrationRun) {
		await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
	}

	public async beforeEach({ name }: MigrationStep) {}

	public async afterEach({ sql, name }: MigrationStep) {
		const [{ count }] = await sql`SELECT count(*)::int AS count FROM pg_constraint WHERE ...`;
		if (count > 0) throw new Error(`${name} adds a foreign key across schemas`);
	}

	public async after({ sql, tenant }: MigrationRun) {
		await sql`GRANT USAGE ON SCHEMA ${sql(tenant)} TO app`;
	}
}
```

- `before` runs once the tenant schema and the migrations table exist, and `after` at the end. Both also run when no migration is pending, so `after` fits what must stay in place, such as grants or partitions.
- `beforeEach` runs before each migration, and `afterEach` once it is recorded.
- A `MigrationRun` holds the transaction (`sql`), the `tenant`, the `connection`, the `batch`, the `pending` migrations and the ones `applied` so far. A `MigrationStep` holds the transaction, the `name` and `path` of the migration, and its `run`.

Hooks run for every tenant, in the order the modules register them: read `tenant` to act on some tenants only.

### Table markers

`DrizzleTable.define()` marks a table with what `migration:generate` adds to the migration that creates it. Later migrations are left as they are.

```ts
import { DrizzleTable } from '@elysiumjs/mnemosyne-drizzle';
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

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
