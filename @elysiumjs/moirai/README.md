# @elysiumjs/moirai

Actions and queries for [Elysium.js](../core) apps. An action is validated, runs in a unit of work, retries transient failures and can be idempotent. Its side effects go to an outbox that commits with it, and consumers use an inbox to process each message once.

## Installation

```bash
bun add @elysiumjs/moirai @elysiumjs/mnemosyne
```

## Actions and queries

An action is a write: a class that extends `Action`, marked with `@Action.register()`. A query is a read: a class that extends `Query`, marked with `@Query.register()`. `Moirai.execute()` runs an action and `Moirai.ask()` runs a query.

```ts
import { Service, t } from '@elysiumjs/core';
import { Action, Moirai, Outbox, Query } from '@elysiumjs/moirai';

@Action.register({
	input: t.Object({ walletId: t.String(), amount: t.Integer({ minimum: 1 }) }),
	idempotent: true,
	serializeBy: (input) => `wallet:${input.walletId}`
})
class TopUp extends Action {
	constructor(@Service.inject() private readonly wallets: WalletRepository) {
		super();
	}

	public async handle(input: { walletId: string; amount: number }) {
		const wallet = await this.wallets.credit(input.walletId, input.amount);
		await Outbox.enqueue({ kind: 'wallet.credited', payload: { walletId: wallet.id } });
		return { balance: wallet.balance };
	}
}

@Query.register({ input: t.Object({ walletId: t.String() }) })
class WalletBalance extends Query {
	public handle(input: { walletId: string }) {
		/* ... */
	}
}

// `Moirai` runs them. In a controller, which returns the outcome: a result, or the DomainError that refused the call.
return Moirai.execute(TopUp, body, { idempotencyKey: headers['idempotency-key'] });
return Moirai.ask(WalletBalance, { walletId });
```

- A refusal is a value. `Moirai.execute()` and `Moirai.ask()` return the DomainError that refused the call, and their return type lists it next to the result. A controller that returns it sends it as the problem of its route, and typed clients see it under its status. Check one with `isDomainError(outcome)`.
- An input that does not match the schema is refused with a 422 `VALIDATION_FAILED` problem, with one entry per mistake.
- When `authorize(input)` returns `false`, the call is refused with a 403 `FORBIDDEN` problem.
- An action runs in a unit of work, or joins the one already open. A transient failure retries in a new unit of work, up to 3 attempts. Transient failures are errors with `transient: true`, and Postgres serialization failures and deadlocks. `retry: { attempts, isTransient }` sets them per action, such as to retry a returned optimistic-concurrency error; `retry: false` never retries. A transient DomainError that outlasts the attempts is returned.
- A handler refuses a call by returning a `DomainError`, or throwing one. The unit of work then rolls back, nothing is stored for idempotency, and the error is returned to the caller. An action that joined an open unit of work hands it up: the unit rolls back when its opener returns it too.
- An idempotent action needs a key, or it is refused with a 400 `IDEMPOTENCY_KEY_REQUIRED` problem. A repeat with the same key and input replays the stored response, as JSON; with another input, it is refused with a 422 `IDEMPOTENCY_KEY_REUSED` problem.
- A key belongs to its owner: the current user by default (`currentUserId()` of core, else `anonymous`), or what `scope(input)` of the action or `Moirai.execute(..., { scope })` returns, such as a tenant and a user. Another owner presenting the same key runs the action on its own.
- `serializeBy` makes calls that share a key run one after the other, so a double tap waits for the first call and replays its response.

## Outbox and inbox

```ts
class Mailer {
	@Outbox.handle('wallet.credited')
	public async notify(payload: { walletId: string }) {
		/* send the email */
	}
}

// From a cron trigger, for rows that failed or were delayed:
await Outbox.sweep();

// In a consumer, inside its unit of work:
await Inbox.once({ messageId: message.id, consumer: 'billing' }, () => apply(message));
```

Effects relay once the unit of work commits. A row that fails is retried with a backoff from 5 s up to 1 h, and marked dead after 8 attempts (`onDead` is called then). Delivery is at least once, so a handler must tolerate a repeat.

`@elysiumjs/moirai/heracles` adds `job(JobClass, args)`, an effect that dispatches a Heracles job once the action commits:

```ts
import { job } from '@elysiumjs/moirai/heracles';

await Outbox.enqueue(job(SendReceiptJob, [order.id]));
```

`@Once()` runs a Heracles job once per dispatch id: its `execute()` runs in a unit of work with an inbox record of the id. It fits the jobs of a `Scheduler`, whose dispatch id names the scheduler, the case and the tick, so a repeated delivery or a tick handled twice does nothing.

Effect handlers register when their module is imported, `@elysiumjs/moirai/heracles` included. A process that relays the outbox, such as a cron sweeper, imports the modules of the effects it relays.

## Events

An event says what happened. It is published in the unit of work that made it happen, and each handler gets it once that unit commits, never when it rolls back:

```ts
import type { EventMeta } from '@elysiumjs/moirai';

import { Event } from '@elysiumjs/moirai';

declare module '@elysiumjs/moirai' {
	interface EventCatalogue {
		'wallet.credited': { walletId: string; amount: number };
	}
}

// In an action:
await Event.publish('wallet.credited', { walletId: wallet.id, amount: input.amount });

class Receipts {
	@Event.on('wallet.credited', { consumer: 'billing.send-receipt', retry: { attempts: 5 } })
	public async send(payload: { walletId: string; amount: number }, meta: EventMeta) {
		/* ... */
	}
}
```

- `EventCatalogue` types the names and the payloads of `Event.publish()` and `@Event.on()`. While it is empty, any name and payload are accepted.
- Each handler gets its own delivery through the outbox, so it retries and dies on its own (`retry: { attempts }`, `retry: false` for one attempt, else `maxRelayAttempts`). Delivery is at least once.
- Each handler records the events it handled in the inbox, in the unit of work of its own writes, so a repeated delivery does nothing. `consumer` names that record and defaults to `Class.method`: keep it when the method is renamed. Two handlers with one consumer throw `DuplicateEventConsumerError`.
- `meta` gives the id of the event, its name, when it was published and the attempt.
- Events need the `outbox` and `inbox` stores. Handlers register when their module is imported, so the process that relays imports them.

## Stores

```ts
import { MoiraiModule } from '@elysiumjs/moirai';
import {
	DrizzleIdempotencyStore,
	DrizzleInboxStore,
	DrizzleOutboxStore,
	moiraiTables,
	PgAdvisoryLock
} from '@elysiumjs/moirai-drizzle';

export const billing = moiraiTables('billing');

MoiraiModule.with({
	idempotency: () => new DrizzleIdempotencyStore({ table: billing.idempotencyKeys }),
	outbox: () => new DrizzleOutboxStore({ table: billing.outbox }),
	inbox: () => new DrizzleInboxStore({ table: billing.inbox }),
	lock: () => new PgAdvisoryLock(),
	// On Cloudflare Workers, answer before the relay that follows a commit:
	defer: (work) => Workers.context().waitUntil(work)
});
```

The memory stores (`MemoryIdempotencyStore`, `MemoryOutboxStore`, `MemoryInboxStore` and `MemoryActionLock`) are meant for tests and single-process apps. The memory outbox and inbox drop what a unit of work that rolls back wrote, like a database table.

### Store sets

Named store sets give each part of an app its own stores, such as the outbox and inbox tables of each domain. The stores outside `stores` are the `default` set, and a named set that leaves a store out shares the one of the default set. A named set takes the options of the default set, and may override them.

```ts
const billing = moiraiTables('billing');
const ledger = moiraiTables('ledger');

MoiraiModule.with({
	idempotency: () => new DrizzleIdempotencyStore({ table: tables.idempotencyKeys }),
	lock: () => new PgAdvisoryLock(),
	stores: {
		billing: {
			outbox: () => new DrizzleOutboxStore({ table: billing.outbox }),
			inbox: () => new DrizzleInboxStore({ table: billing.inbox })
		},
		ledger: {
			outbox: () => new DrizzleOutboxStore({ table: ledger.outbox }),
			inbox: () => new DrizzleInboxStore({ table: ledger.inbox }),
			relayBatch: 20
		}
	}
});

@Action.register({ input: ChargeInput, stores: 'billing' })
class Charge extends Action { ... }

class Ledger {
	@Event.on('invoice.issued', { consumer: 'ledger.record', stores: 'ledger' })
	public record(payload: { invoiceId: string }) { ... }
}
```

- An action with `stores` runs with its set current: its idempotency store, its lock and its options come from the set, and `Outbox.enqueue()`, `Event.publish()` and the actions it runs without `stores` use the set too.
- An event is delivered through the outbox of its publisher's set. A handler with `stores` records the events it handled in the inbox of its set, and writes its own effects and events to the outbox of its set; without `stores`, it runs in the set of the delivery.
- `Outbox.relay({ stores })` and `Outbox.sweep({ stores })` relay the outbox of one set, such as one cron trigger per domain. The relay that follows a commit relays the set the rows went to.
- `@Once({ stores })` records the dispatch ids of a job in the inbox of a set.
- `Moirai.using(stores, work)` runs other code with a set current, such as a webhook handler that writes to the outbox of its domain.

