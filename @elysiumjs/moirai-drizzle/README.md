# @elysiumjs/moirai-drizzle

Postgres stores for [`@elysiumjs/moirai`](../moirai), through Drizzle ORM and the connections of [`@elysiumjs/mnemosyne-drizzle`](../mnemosyne-drizzle). They write in the transaction of the command, so an idempotency record and the outbox rows commit with the data.

## Installation

```bash
bun add @elysiumjs/moirai @elysiumjs/moirai-drizzle @elysiumjs/mnemosyne-drizzle
```

## Tables

```ts
import { moiraiTables } from '@elysiumjs/moirai-drizzle';

// In the Drizzle schema, so that migration:generate creates them.
export const billing = moiraiTables('billing');
```

`moiraiTables(schema?)` builds the `idempotency_keys`, `outbox` and `inbox` tables, in a Postgres schema when one is given (one set of tables per domain schema, for example).

## Stores

```ts
import { MoiraiModule } from '@elysiumjs/moirai';
import {
	DrizzleIdempotencyStore,
	DrizzleInboxStore,
	DrizzleOutboxStore,
	PgAdvisoryLock
} from '@elysiumjs/moirai-drizzle';

MoiraiModule.with({
	idempotency: () => new DrizzleIdempotencyStore({ table: billing.idempotencyKeys }),
	outbox: () => new DrizzleOutboxStore({ table: billing.outbox }),
	inbox: () => new DrizzleInboxStore({ table: billing.inbox }),
	lock: () => new PgAdvisoryLock()
});
```

- `DrizzleIdempotencyStore` keeps the response of an idempotent command per key.
- `DrizzleOutboxStore` claims due rows with `FOR UPDATE SKIP LOCKED`, so that several relays never take the same row.
- `DrizzleInboxStore` records the messages a consumer has processed.
- `PgAdvisoryLock` serializes the commands that share a `serializeBy` key with a transaction advisory lock.

Each store takes `connection`, the name of a mnemosyne-drizzle connection, which defaults to `default`.
