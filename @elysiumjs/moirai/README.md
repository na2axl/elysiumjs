# @elysiumjs/moirai

Actions and queries for [Elysium.js](../core) apps. An action is validated, runs in a unit of work, retries transient failures and can be idempotent. Its side effects go to an outbox that commits with it, and consumers use an inbox to process each message once. Aggregates can be event-sourced: their state is the fold of the events of their stream, and projections and reactors follow those events.

## Installation

```bash
bun add @elysiumjs/moirai @elysiumjs/mnemosyne
```

## Actions and queries

An action is a write: a class that extends `Action`, marked with `@Action.register()`. A query is a read: a class that extends `Query`, marked with `@Query.register()`. `Moirai.execute()` runs an action and `Moirai.ask()` runs a query.

```ts
import type { Static } from '@elysiumjs/core';

import { DomainError, Service, t } from '@elysiumjs/core';
import { Action, Moirai, Outbox, Query } from '@elysiumjs/moirai';

const TopUpInput = t.Object({ walletId: t.String(), amount: t.Integer({ minimum: 1 }) });
export type TopUpInput = Static<typeof TopUpInput>;
export type TopUpResult = { balance: number };

class WalletClosed extends DomainError.for('CONFLICT', 409) {}

@Action.register({
	input: TopUpInput,
	idempotent: true,
	serializeBy: (input) => `wallet:${input.walletId}`
})
class TopUp extends Action<TopUpInput, TopUpResult, WalletClosed> {
	constructor(@Service.inject() private readonly wallets: WalletRepository) {
		super();
	}

	public override async handle(input: TopUpInput): Promise<TopUpResult | WalletClosed> {
		const wallet = await this.wallets.find(input.walletId);
		if (wallet.closed) return new WalletClosed(`wallet ${input.walletId} is closed`);
		const credited = await this.wallets.credit(input.walletId, input.amount);
		await Outbox.enqueue({ kind: 'wallet.credited', payload: { walletId: credited.id } });
		return { balance: credited.balance };
	}
}

const WalletBalanceInput = t.Object({ walletId: t.String() });
export type WalletBalanceInput = Static<typeof WalletBalanceInput>;

@Query.register({ input: WalletBalanceInput })
class WalletBalance extends Query<WalletBalanceInput, { balance: number }> {
	constructor(@Service.inject() private readonly wallets: WalletRepository) {
		super();
	}

	public override async handle(input: WalletBalanceInput) {
		return { balance: await this.wallets.balance(input.walletId) };
	}
}

// `Moirai` runs them. In a controller, which returns the outcome: a result, or the DomainError that refused the call.
return Moirai.execute(TopUp, body, { idempotencyKey: headers['idempotency-key'] });
return Moirai.ask(WalletBalance, { walletId });
```

- `Action<TInput, TResult, TErrors>` and `Query<TInput, TResult, TErrors>` type `handle()`: it takes `TInput` and gives `TResult` or one of `TErrors`, the DomainErrors it returns (any DomainError by default). `Moirai.execute()` and `Moirai.ask()` take their input type and return types from `handle()`.
- A refusal is a value. `Moirai.execute()` and `Moirai.ask()` return the DomainError that refused the call, and their return type lists it next to the result. A controller that returns it sends it as the problem of its route, and typed clients see it under its status. Check one with `isDomainError(outcome)`.
- An input that does not match the schema is refused with a 422 `VALIDATION_FAILED` problem, with one entry per mistake.
- When `authorize(input)` returns `false`, the call is refused with a 403 `FORBIDDEN` problem.
- An action runs in a unit of work, or joins the one already open. A transient failure retries in a new unit of work, up to 3 attempts. Transient failures are errors with `transient: true`, and Postgres serialization failures and deadlocks. `retry: { attempts, isTransient }` sets them per action, such as to retry a returned optimistic-concurrency error; `retry: false` never retries. A transient DomainError that outlasts the attempts is returned.
- A handler refuses a call by returning a `DomainError`, or throwing one. The unit of work then rolls back, nothing is stored for idempotency, and the error is returned to the caller. An action that joined an open unit of work hands it up: the unit rolls back when its opener returns it too.
- An idempotent action needs a key, or it is refused with a 400 `IDEMPOTENCY_KEY_REQUIRED` problem. A repeat with the same key and input replays the stored response, as JSON; with another input, it is refused with a 422 `IDEMPOTENCY_KEY_REUSED` problem.
- A key belongs to its owner: the current user by default (`currentUserId()` of core, else `anonymous`), or what `scope(input)` of the action or `Moirai.execute(..., { scope })` returns, such as a tenant and a user. Another owner presenting the same key runs the action on its own.
- `serializeBy` makes calls that share a key run one after the other, so a double tap waits for the first call and replays its response.

### Routes

`result` and `errors` of the registration describe what a call gives, for the routes that run it. `errors` must list every DomainError that `handle()` gives, or the registration does not compile:

```ts
@Action.register({ input: TopUpInput, idempotent: true, result: Receipt, errors: [WalletClosed] })
class TopUp extends Action<TopUpInput, TopUpResult, WalletClosed> {}

@Http.post('/top-ups', { response: TopUp.result, errors: TopUp.errors })
public topUp(@Http.body(TopUpInput) body: TopUpInput, @Http.header('idempotency-key') key: string) {
	return Moirai.execute(TopUp, body, { idempotencyKey: key });
}
```

The static `result` gives the schema back. The static `errors` lists the declared classes, then the problems of moirai that apply: invalid input when there is an input schema, a refused call with `authorize`, and the idempotency key problems of an idempotent action.

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

## Event sourcing

### Stored events

A stored event is a fact recorded in the stream of an aggregate: a class extending `StoredEvent` with its data, marked with `@StoredEvent.register()`.

```ts
import type { Static } from 'typebox';

import { StoredEvent } from '@elysiumjs/moirai';
import { Type as t } from 'typebox';

const Klaps = t
	.Codec(t.String({ pattern: '^[0-9]+$' }))
	.Decode((value) => BigInt(value))
	.Encode((value: bigint) => value.toString());

const KlapsSpentData = t.Object({ spendId: t.String(), sellerId: t.String(), klaps: Klaps });

@StoredEvent.register({ name: 'KlapsSpent', version: 2, schema: KlapsSpentData })
export class KlapsSpent extends StoredEvent<Static<typeof KlapsSpentData>> {
	// Version 1 kept the seller in `ref`.
	@StoredEvent.upcast(1)
	static fromV1({ ref, ...data }: { spendId: string; klaps: string; ref: { sellerId: string } }) {
		return { ...data, sellerId: ref.sellerId };
	}
}
```

- `name` is the type kept with each event, and defaults to the class name: keep it when the class is renamed. Two classes with one name throw `DuplicateStreamNameError`.
- `schema` encodes the data when it is appended (codecs run then, such as a bigint kept as a string) and decodes it when it loads; data that does not match it is refused. Without a schema, the data is kept as it is and must be JSON-safe.
- `version` is the version of the data, 1 by default. A static method marked with `@StoredEvent.upcast(n)` takes the stored data of version `n` and gives the data of version `n + 1`; upcasters chain from the stored version to the current one. A stored event that no class reads throws `UnknownStoredEventError`.
- In `development` and `test`, the data is frozen.

### Aggregates

An aggregate is a class extending `Aggregate`, marked with `@Aggregate.register()`. Its public methods are the commands: they check the rules against the current state, then record events with `record()`, or return the DomainError that refuses the command. Methods marked with `@Aggregate.evolve()` give the next state from the state and an event; they may be protected or private.

```ts
import { Aggregate } from '@elysiumjs/moirai';

type WalletState = { klaps: bigint };

@Aggregate.register({ name: 'wallet' })
export class Wallet extends Aggregate<WalletState> {
	static override initialState: WalletState = { klaps: 0n };

	get balance(): bigint {
		return this.state.klaps;
	}

	spend(spendId: string, sellerId: string, klaps: bigint) {
		if (klaps > this.state.klaps) return new InsufficientKlaps(klaps - this.state.klaps);
		this.record(new KlapsSpent({ spendId, sellerId, klaps }));
	}

	@Aggregate.evolve(KlapsSpent)
	protected spent(state: WalletState, event: KlapsSpent): WalletState {
		return { klaps: state.klaps - event.data.klaps };
	}
}
```

- A recorded event is applied at once, so a command that records two events checks the second against the state after the first.
- The state is a value: an evolve handler gives a new one. In `development` and `test`, it is frozen, so a mutation throws. An event without an evolve handler leaves the state as it is.
- `name` is the aggregate type kept with each event, and defaults to the class name.

`Streams.act()` runs a command in the open unit of work, or a new one: it loads the stream, runs the command, appends the events it recorded at the next versions, then runs the inline projections and the reactors of each event.

```ts
import { isDomainError } from '@elysiumjs/core';
import { Streams } from '@elysiumjs/moirai';

// In an action:
const spent = await Streams.act(Wallet, userId, (wallet) => wallet.spend(spendId, sellerId, 120n));
if (isDomainError(spent)) return spent;
return { balance: spent.aggregate.balance, spends: spent.of(KlapsSpent).length };
```

- A command that returns a DomainError appends nothing, and `act()` returns the error.
- When another writer appended to the stream since it was loaded, the append rejects with `ConcurrencyConflictError`, which is transient: an action retries it in a new unit of work, which loads the stream again.
- Each event keeps metadata: the `eventMetadata` option of the module (such as the actor and the correlation id), then the `metadata` given to `act()`.
- `Streams.retrieve(Wallet, id)` loads an aggregate to read its state.

`Aggregate.given()` runs a command on an aggregate built from past events, without a store:

```ts
Wallet.given([new KlapsToppedUp({ topUpId: 't-1', klaps: 100n })])
	.when((wallet) => wallet.spend('s-1', 'seller-1', 30n))
	.assertRecorded(new KlapsSpent({ spendId: 's-1', sellerId: 'seller-1', klaps: 30n }));

Wallet.given()
	.when((wallet) => wallet.spend('s-1', 'seller-1', 30n))
	.assertRefused(InsufficientKlaps);
```

`assertRecorded()` takes events, matched on their class and data, or classes; `assertNothingRecorded()` and `assertRefused()` complete it, and `recorded` and `outcome` give the rest.

### Projections

A projection writes a read model from stored events. An inline projection runs in the unit of work that appends the events, so a read right after a command sees what it did, and its failure rolls the command back.

```ts
import type { StoredEventMeta } from '@elysiumjs/moirai';

import { Service } from '@elysiumjs/core';
import { Projection } from '@elysiumjs/moirai';

@Projection.inline({ name: 'wallet-movements', version: 1, models: [WalletMovementModel] })
export class WalletMovements {
	constructor(@Service.inject() private readonly movements: WalletMovementRepository) {}

	@Projection.on(KlapsSpent)
	protected async spent(event: KlapsSpent, meta: StoredEventMeta) {
		await this.movements.insert({
			id: event.data.spendId,
			userId: meta.aggregateId,
			klaps: -event.data.klaps
		});
	}
}
```

- Handlers run in the module that registers the class, with its dependencies, and may be protected or private. `meta` gives the stream, the version, when the event happened, its metadata, and whether it is replayed.
- `Projection.rebuild(WalletMovements)` rebuilds a projection in one unit of work: it resets its `models` with the `projections` storage, replays every event it handles in the order of the log, and records its `version`. On a transactional storage, readers see the previous read model until the rebuild commits.
- `Projection.stale()` lists the projections whose `version` differs from the one they were last built with. The `projection:rebuild` command of `MoiraiModule` rebuilds them, or the one given with `--name`, whatever its version.
- `Projection.project(WalletMovements, [[event, meta]])` runs the handlers for given events, such as in a test.

### Reactors

A reactor turns a stored event into what it causes besides the state: publishing an event for other modules, enqueueing a job, running an action. Reactor methods belong to any service, and are marked with `@Reactor.on()`:

```ts
import type { StoredEventMeta } from '@elysiumjs/moirai';

import { Service } from '@elysiumjs/core';
import { Event, Reactor } from '@elysiumjs/moirai';

@Service.register()
export class GiftReactor {
	@Reactor.on(KlapsSpent, { when: (event) => event.data.sellerId !== 'house' })
	protected async gifted(event: KlapsSpent, meta: StoredEventMeta) {
		await Event.publish('KlapsGifted', {
			buyerId: meta.aggregateId,
			klaps: event.data.klaps.toString()
		});
	}
}
```

- A reactor runs in the unit of work that appends the event, after the inline projections, so its effects commit with the event. It never runs when events are replayed.
- `when` filters the events it reacts to.
- Stored events stay inside their module, and change shape with upcasters. A reactor that publishes an `Event` is how other modules learn what happened, with a payload that is their contract.

## Stores

```ts
import { MoiraiModule } from '@elysiumjs/moirai';
import {
	DrizzleEventStore,
	DrizzleIdempotencyStore,
	DrizzleInboxStore,
	DrizzleOutboxStore,
	DrizzleProjectionStorage,
	moiraiTables,
	PgAdvisoryLock
} from '@elysiumjs/moirai-drizzle';

export const billing = moiraiTables('billing');

MoiraiModule.with({
	idempotency: () => new DrizzleIdempotencyStore({ table: billing.idempotencyKeys }),
	outbox: () => new DrizzleOutboxStore({ table: billing.outbox }),
	inbox: () => new DrizzleInboxStore({ table: billing.inbox }),
	lock: () => new PgAdvisoryLock(),
	events: () => new DrizzleEventStore({ table: billing.events }),
	projections: () => new DrizzleProjectionStorage({ table: billing.projections }),
	// On Cloudflare Workers, answer before the relay that follows a commit:
	defer: (work) => Workers.context().waitUntil(work)
});
```

The memory stores (`MemoryIdempotencyStore`, `MemoryOutboxStore`, `MemoryInboxStore`, `MemoryActionLock`, `MemoryEventStore` and `MemoryProjectionStorage`) are meant for tests and single-process apps. The memory outbox, inbox, event store and projection storage drop what a unit of work that rolls back wrote, like a database table; `MemoryProjectionStorage` resets models with the function it is given.

### Module stores

A module can have stores of its own, such as the outbox and inbox tables of a domain. `Moirai.stores()` lists them as private services of the module; what a module leaves out comes from `MoiraiModule`, stores and options alike.

```ts
const billing = moiraiTables('billing');

@Module.register({
	controllers: [InvoiceController],
	services: [
		Charge,
		Receipts,
		...Moirai.stores({
			outbox: () => new DrizzleOutboxStore({ table: billing.outbox }),
			inbox: () => new DrizzleInboxStore({ table: billing.inbox }),
			relayBatch: 20
		})
	]
})
class BillingModule extends Module {}
```

- An action runs in the module that registers it, whoever calls it: its idempotency store, its lock, its options, and the outbox of its effects and events are the ones of that module.
- An event goes through the outbox of the module that publishes it. An `@Event.on` handler runs in the module that registers its class: the events it handled are recorded in the inbox of that module, and its own effects and events go to the outbox of that module. A handler whose class no module registers runs in the module of the outbox the event came from.
- A `@Once()` job records its dispatch ids in the inbox of the module that registers the job.
- The relay that follows a commit relays the outbox the rows went to. `Outbox.relay({ module })` and `Outbox.sweep({ module })` relay the outbox of one module; `Outbox.sweep()` relays the outbox of `MoiraiModule` and the one of every module that has its own, so one cron trigger covers them all.
- Like any service, module stores are visible to the modules that import the module when it exports them.
