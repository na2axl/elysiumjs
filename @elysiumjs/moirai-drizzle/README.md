# @elysiumjs/moirai-drizzle

Postgres stores for [`@elysiumjs/olympus/moirai`](../olympus), through Drizzle ORM and the connections of [`@elysiumjs/mnemosyne-drizzle`](../mnemosyne-drizzle). They write in the transaction of the action, so an idempotency record, the outbox rows and the stored events commit with the data.

## Installation

```bash
bun add @elysiumjs/olympus @elysiumjs/moirai-drizzle @elysiumjs/mnemosyne-drizzle
```

## Tables

```ts
import { moiraiTables } from '@elysiumjs/moirai-drizzle';

// In the Drizzle schema, so that migration:generate creates them.
export const billing = moiraiTables('billing');
```

`moiraiTables(schema?, options?)` builds the `idempotency_keys`, `outbox`, `inbox`, `events` and `projections` tables, in a Postgres schema when one is given (one set of tables per domain schema, for example).

With `{ partitioned: true }`, `events` is partitioned by range of `occurred_at` and `outbox` by range of `created_at`. Their primary and unique keys then include that column, and `migration:generate` creates them with `PARTITION BY RANGE`. The partitions are up to the app: create them in a migration hook, or add them to the migration that creates the table with `DrizzleTable.afterCreate()` from `@elysiumjs/mnemosyne-drizzle`:

```ts
import { DrizzleTable } from '@elysiumjs/mnemosyne-drizzle';

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

## Stores

```ts
import { MoiraiModule } from '@elysiumjs/olympus/moirai';
import {
	DrizzleEventStore,
	DrizzleIdempotencyStore,
	DrizzleInboxStore,
	DrizzleOutboxStore,
	DrizzleProjectionStorage,
	PgAdvisoryLock
} from '@elysiumjs/moirai-drizzle';

MoiraiModule.with({
	idempotency: () => new DrizzleIdempotencyStore({ table: billing.idempotencyKeys }),
	outbox: () => new DrizzleOutboxStore({ table: billing.outbox }),
	inbox: () => new DrizzleInboxStore({ table: billing.inbox }),
	lock: () => new PgAdvisoryLock(),
	events: () => new DrizzleEventStore({ table: billing.events }),
	projections: () => new DrizzleProjectionStorage({ table: billing.projections })
});
```

- `DrizzleIdempotencyStore` keeps the response of an idempotent action per key.
- `DrizzleOutboxStore` claims due rows with `FOR UPDATE SKIP LOCKED`, so that several relays never take the same row.
- `DrizzleInboxStore` records the messages a consumer has processed.
- `DrizzleEventStore` keeps the event streams of aggregates. An append locks each stream it writes with a transaction advisory lock and checks that the stream ends right before the first appended version, so a stale writer gets a `ConcurrencyConflictError` even when the unique key of the table spans more columns, such as a partition key. Postgres gives each event its `position` and the id of the transaction that wrote it (`transaction_id`).
- `DrizzleProjectionStorage` resets the tables of the `models` of a projection (`DrizzleModel`s or Drizzle tables) with `DELETE` in the rebuild's transaction, so readers see the rows until it commits, and keeps the version each projection was built with.
- `PgAdvisoryLock` serializes the actions that share a `serializeBy` key with a transaction advisory lock.

Each store takes `connection`, the name of a mnemosyne-drizzle connection, which defaults to `default`. A store's `table` needs the columns of the matching table in `moiraiTables`, and may add others: it can live in a domain's own `pgSchema` and have another primary key, such as a composite one. `StoreTable<T>` is the type it accepts.
