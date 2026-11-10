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

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
