# @elysiumjs/moirai

Commands and queries for [Elysium.js](../core) apps. A command is validated, runs in a unit of work, retries transient failures and can be idempotent. Its side effects go to an outbox that commits with it, and consumers use an inbox to process each message once.

## Installation

```bash
bun add @elysiumjs/moirai @elysiumjs/mnemosyne
```

## Commands and queries

```ts
import { Service, t } from '@elysiumjs/core';
import { Commands, Moirai, Outbox, Queries } from '@elysiumjs/moirai';

@Moirai.command({
	input: t.Object({ walletId: t.String(), amount: t.Integer({ minimum: 1 }) }),
	idempotent: true,
	serializeBy: (input) => `wallet:${input.walletId}`
})
class TopUpCommand {
	constructor(@Service.inject() private readonly wallets: WalletRepository) {}

	public async handle(input: { walletId: string; amount: number }) {
		const wallet = await this.wallets.credit(input.walletId, input.amount);
		await Outbox.enqueue({ kind: 'wallet.credited', payload: { walletId: wallet.id } });
		return { balance: wallet.balance };
	}
}

@Moirai.query({ input: t.Object({ walletId: t.String() }) })
class WalletBalanceQuery {
	public handle(input: { walletId: string }) {
		/* ... */
	}
}

// In a controller:
await Commands.execute(TopUpCommand, body, { idempotencyKey: headers['idempotency-key'] });
await Queries.ask(WalletBalanceQuery, { walletId });
```

- An input that does not match the schema answers a 400 problem, with one entry per mistake.
- When `authorize(input)` returns `false`, the call answers a 403 problem.
- A command runs in a unit of work, or joins the one already open. A transient failure retries in a new unit of work, up to 3 attempts. Transient failures are errors with `transient: true`, and Postgres serialization failures and deadlocks.
- A handler refuses a call by returning or throwing a `DomainError`. The unit of work then rolls back, and the error reaches the caller.
- An idempotent command needs a key, or it answers a 428 problem. A repeat with the same key and input replays the stored response, as JSON; with another input, it answers a 422 problem.
- A key belongs to its owner: the current user by default (`currentUserId()` of core, else `anonymous`), or what `scope(input)` of the command or `Commands.execute(..., { scope })` returns, such as a tenant and a user. Another owner presenting the same key runs the command on its own.
- `serializeBy` makes calls that share a key run one after the other, so a double tap waits for the first call and replays its response.

## Outbox and inbox

```ts
class Mailer {
	@Moirai.effect('wallet.credited')
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

`@elysiumjs/moirai/heracles` adds `job(JobClass, args)`, an effect that dispatches a Heracles job once the command commits:

```ts
import { job } from '@elysiumjs/moirai/heracles';

await Outbox.enqueue(job(SendReceiptJob, [order.id]));
```

Effect handlers register when their module is imported, `@elysiumjs/moirai/heracles` included. A process that relays the outbox, such as a cron sweeper, imports the modules of the effects it relays.

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

The memory stores (`MemoryIdempotencyStore`, `MemoryOutboxStore`, `MemoryInboxStore` and `MemoryCommandLock`) are meant for tests and single-process apps.
