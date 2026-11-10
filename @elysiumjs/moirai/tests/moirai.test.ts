// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { Static, TestingApp } from '@elysiumjs/core';
import type { MoiraiOptions } from '../src';

import {
	Application,
	ConflictError,
	DomainError,
	isDomainError,
	Module,
	NotFoundError,
	Service,
	t
} from '@elysiumjs/core';
import { Job, JobRegistry, WithId } from '@elysiumjs/heracles';
import { UnitOfWork, withUnitOfWork } from '@elysiumjs/mnemosyne';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'bun:test';

import { HERACLES_JOB_EFFECT, InvalidOnceJobError, job, Once } from '../src/heracles';
import {
	Action,
	backoffMs,
	CallForbiddenError,
	DEFAULT_OPTIONS_FOR_TESTS,
	DuplicateEventConsumerError,
	Event,
	IdempotencyConflictError,
	IdempotencyKeyRequiredError,
	IdempotencyKeyReusedError,
	Inbox,
	InvalidInputError,
	isTransientError,
	LockOutsideUnitOfWorkError,
	MemoryActionLock,
	MemoryIdempotencyStore,
	MemoryInboxStore,
	MemoryOutboxStore,
	MissingStoreError,
	Moirai,
	MOIRAI_ACTION_LOCK,
	MOIRAI_EVENT_EFFECT,
	MOIRAI_IDEMPOTENCY_STORE,
	MOIRAI_INBOX_STORE,
	MOIRAI_MODULE_OPTIONS,
	MOIRAI_OPTIONS,
	MOIRAI_OUTBOX_STORE,
	MoiraiModule,
	Outbox,
	PayloadReplacementUnsupportedError,
	Query,
	registerEffect,
	requestHash,
	uuidv7
} from './exports';

const log: string[] = [];
let depth = 0;
let outbox: MemoryOutboxStore;
let idempotency: MemoryIdempotencyStore;

const setOptions = (overrides: Partial<MoiraiOptions> = {}) => {
	Service.remove(MOIRAI_OPTIONS);
	Service.instance(MOIRAI_OPTIONS, { ...DEFAULT_OPTIONS_FOR_TESTS, ...overrides });
};

beforeEach(() => {
	log.length = 0;
	outbox = new MemoryOutboxStore();
	idempotency = new MemoryIdempotencyStore();
	Service.instance(
		'db.transaction',
		withUnitOfWork(async (callback) => {
			// Inner units join the open transaction, as database drivers do.
			if (depth > 0) return callback();
			depth++;
			log.push('BEGIN');
			try {
				const result = await callback();
				log.push('COMMIT');
				return result;
			} catch (error) {
				log.push('ROLLBACK');
				throw error;
			} finally {
				depth--;
			}
		})
	);
	Service.instance(MOIRAI_OUTBOX_STORE, outbox);
	Service.instance(MOIRAI_IDEMPOTENCY_STORE, idempotency);
	Service.instance(MOIRAI_INBOX_STORE, new MemoryInboxStore());
	Service.instance(MOIRAI_ACTION_LOCK, new MemoryActionLock());
	setOptions();
});

afterEach(() => {
	for (const name of [
		'db.transaction',
		MOIRAI_OUTBOX_STORE,
		MOIRAI_IDEMPOTENCY_STORE,
		MOIRAI_INBOX_STORE,
		MOIRAI_ACTION_LOCK,
		MOIRAI_OPTIONS
	]) {
		Service.remove(name);
	}
});

const sent: unknown[] = [];

class Mailer {
	@Outbox.handle('mail.send')
	public async send(payload: { to: string; fail?: boolean }) {
		if (payload.fail) throw new Error('smtp down');
		sent.push(payload);
	}
}

let runs = 0;

@Action.register({
	errors: [ConflictError],
	input: t.Object({ amount: t.Integer({ minimum: 1 }), note: t.Optional(t.String()) }),
	idempotent: true
})
class TopUp extends Action {
	public async handle(input: { amount: number; note?: string }) {
		runs++;
		log.push(`top-up ${input.amount}`);
		if (input.note === 'refuse') return new ConflictError('no');
		await Outbox.enqueue({ kind: 'mail.send', payload: { to: 'ada', amount: input.amount } });
		return { balance: input.amount * 10 };
	}
}

@Action.register({ errors: [], name: 'rename', input: t.Object({ name: t.String() }) })
class Rename extends Action {
	public handle(input: { name: string }) {
		log.push(`rename ${input.name}`);
		return { name: input.name };
	}
}

describe('actions', () => {
	beforeEach(() => {
		runs = 0;
		sent.length = 0;
	});

	it('validates the input and answers a 422 problem listing the mistakes', async () => {
		const error = await Moirai.execute(TopUp, { amount: 0 }, { idempotencyKey: 'k' });
		expect(error).toBeInstanceOf(InvalidInputError);
		if (!(error instanceof InvalidInputError)) return;
		expect(error.status).toBe(422);
		expect(error.code).toBe('VALIDATION_FAILED');
		expect(error.errors?.[0]?.pointer).toBe('/amount');
	});

	it('refuses a call that authorize declines with a 403 problem', async () => {
		@Action.register({
			errors: [],
			input: t.Object({ id: t.String() }),
			authorize: (input) => input.id === 'mine'
		})
		class Delete extends Action {
			public handle() {
				return { deleted: true };
			}
		}
		expect(await Moirai.execute(Delete, { id: 'mine' })).toEqual({ deleted: true });
		expect(await Moirai.execute(Delete, { id: 'yours' })).toBeInstanceOf(CallForbiddenError);
	});

	it('runs in a unit of work, and joins the open one', async () => {
		expect(await Moirai.execute(Rename, { name: 'ada' })).toEqual({ name: 'ada' });
		expect(log).toEqual(['BEGIN', 'rename ada', 'COMMIT']);

		log.length = 0;
		await UnitOfWork.run(async () => {
			await Moirai.execute(Rename, { name: 'a' });
			await Moirai.execute(Rename, { name: 'b' });
		});
		expect(log).toEqual(['BEGIN', 'rename a', 'rename b', 'COMMIT']);
	});

	it('needs an idempotency key for an idempotent action', async () => {
		const error = await Moirai.execute(TopUp, { amount: 1 }).catch((e) => e);
		expect(error).toBeInstanceOf(IdempotencyKeyRequiredError);
		expect(error.status).toBe(400);
	});

	it('replays the stored response of a repeated key, and refuses it with another input', async () => {
		const first = await Moirai.execute(TopUp, { amount: 2 }, { idempotencyKey: 'tap-1' });
		const again = await Moirai.execute(TopUp, { amount: 2 }, { idempotencyKey: 'tap-1' });
		expect(first).toEqual({ balance: 20 });
		expect(again).toEqual(first);
		expect(runs).toBe(1);

		const reused = await Moirai.execute(TopUp, { amount: 3 }, { idempotencyKey: 'tap-1' }).catch(
			(e) => e
		);
		expect(reused).toBeInstanceOf(IdempotencyKeyReusedError);
		expect(reused.status).toBe(422);
	});

	it('keeps the keys of two owners apart', async () => {
		const first = await Moirai.execute(TopUp, { amount: 2 }, { idempotencyKey: 'k', scope: 'ada' });
		const other = await Moirai.execute(TopUp, { amount: 5 }, { idempotencyKey: 'k', scope: 'bob' });
		expect(first).toEqual({ balance: 20 });
		expect(other).toEqual({ balance: 50 });
		expect(runs).toBe(2);
		// Without a user, the key belongs to anonymous callers.
		expect(await idempotency.get('anonymous:TopUp:k')).toBeUndefined();
		expect(await idempotency.get('ada:TopUp:k')).toMatchObject({ response: { balance: 20 } });
	});

	it('rolls back and stores nothing when the handler returns a DomainError', async () => {
		const outcome = await Moirai.execute(
			TopUp,
			{ amount: 1, note: 'refuse' },
			{ idempotencyKey: 'tap-2' }
		);
		// The refusal is a value: no throw, and its type is part of the outcome.
		expect(outcome).toBeInstanceOf(DomainError);
		expect(isDomainError(outcome) && outcome.status).toBe(409);
		expect(log).toEqual(['BEGIN', 'top-up 1', 'ROLLBACK']);
		expect(await idempotency.get('tap-2')).toBeUndefined();
		expect(outbox.rows).toEqual([]);
	});

	it('retries when another call stored the key first, and replays its response', async () => {
		const racing = new MemoryIdempotencyStore();
		let puts = 0;
		Service.remove(MOIRAI_IDEMPOTENCY_STORE);
		Service.instance(MOIRAI_IDEMPOTENCY_STORE, {
			get: (key: string) => racing.get(key),
			async put(record: Parameters<MemoryIdempotencyStore['put']>[0]) {
				if (puts++ === 0) {
					// The other call wins the race with its own response.
					await racing.put({ ...record, response: { balance: 99 } });
					throw new IdempotencyConflictError(record.key);
				}
				return racing.put(record);
			}
		});

		expect(await Moirai.execute(TopUp, { amount: 4 }, { idempotencyKey: 'tap-3' })).toEqual({
			balance: 99
		});
		expect(log.filter((entry) => entry === 'BEGIN')).toHaveLength(2);
	});

	it('retries transient failures up to maxAttempts, and not the others', async () => {
		let attempts = 0;
		@Action.register({ errors: [], input: t.Object({ mode: t.String() }) })
		class Flaky extends Action {
			public handle(input: { mode: string }, context: { attempt: number }) {
				attempts++;
				if (input.mode === 'deadlock' && context.attempt < 3) {
					throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
				}
				if (input.mode === 'broken') throw new Error('broken');
				return { attempt: context.attempt };
			}
		}

		expect(await Moirai.execute(Flaky, { mode: 'deadlock' })).toEqual({ attempt: 3 });
		expect(attempts).toBe(3);
		// Bun's SQL driver keeps the SQLSTATE in errno.
		expect(
			isTransientError(
				Object.assign(new Error('could not serialize'), {
					code: 'ERR_POSTGRES_SERVER_ERROR',
					errno: '40001'
				})
			)
		).toBe(true);

		attempts = 0;
		await expect(Moirai.execute(Flaky, { mode: 'broken' })).rejects.toThrow('broken');
		expect(attempts).toBe(1);
	});

	it('retries a returned DomainError its retry policy calls transient, and returns the last one', async () => {
		class ConcurrencyConflict extends DomainError.for('CONCURRENCY_CONFLICT', 409) {}
		let calls = 0;
		@Action.register({
			errors: [ConcurrencyConflict],
			input: t.Object({ wins: t.Integer() }),
			retry: { attempts: 4, isTransient: (error) => error instanceof ConcurrencyConflict }
		})
		class Bump extends Action {
			public handle(input: { wins: number }, context: { attempt: number }) {
				calls++;
				if (context.attempt < input.wins) return new ConcurrencyConflict('changed');
				return { attempt: context.attempt };
			}
		}

		expect(await Moirai.execute(Bump, { wins: 4 })).toEqual({ attempt: 4 });
		expect(calls).toBe(4);
		calls = 0;
		const outcome = await Moirai.execute(Bump, { wins: 9 });
		expect(outcome).toBeInstanceOf(ConcurrencyConflict);
		expect(calls).toBe(4);
		expect(log.filter((entry) => entry === 'ROLLBACK').length).toBeGreaterThanOrEqual(4);
	});

	it('serializes the calls that share a serializeBy key', async () => {
		const order: string[] = [];
		@Action.register({
			errors: [],
			input: t.Object({ wallet: t.String(), id: t.Integer() }),
			serializeBy: (i) => i.wallet
		})
		class Spend extends Action {
			public async handle(input: { id: number }) {
				order.push(`start ${input.id}`);
				await Bun.sleep(5);
				order.push(`end ${input.id}`);
			}
		}
		await Promise.all([
			Moirai.execute(Spend, { wallet: 'w', id: 1 }),
			Moirai.execute(Spend, { wallet: 'w', id: 2 })
		]);
		expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
	});

	it('runs without a unit of work when no database module is loaded', async () => {
		Service.remove('db.transaction');
		expect(await Moirai.execute(Rename, { name: 'solo' })).toEqual({ name: 'solo' });
		expect(log).toEqual(['rename solo']);
	});

	it('explains a missing store', async () => {
		Service.remove(MOIRAI_IDEMPOTENCY_STORE);
		await expect(
			Moirai.execute(TopUp, { amount: 1 }, { idempotencyKey: 'x' })
		).rejects.toBeInstanceOf(MissingStoreError);
	});

	it('refuses a class that is not an action', async () => {
		class Plain {
			public handle() {}
		}
		await expect(Moirai.execute(Plain, {})).rejects.toThrow(
			'is not marked with @Action.register()'
		);
	});
});

describe('queries', () => {
	@Query.register({ errors: [NotFoundError], input: t.Object({ id: t.String({ minLength: 2 }) }) })
	class FindUser extends Query {
		public handle(input: { id: string }) {
			if (input.id === 'gone') return new NotFoundError();
			return { id: input.id };
		}
	}

	it('validates and runs a query without a transaction', async () => {
		expect(await Moirai.ask(FindUser, { id: 'ada' })).toEqual({ id: 'ada' });
		expect(log).toEqual([]);
		expect(await Moirai.ask(FindUser, { id: 'a' })).toBeInstanceOf(InvalidInputError);
		const missing = await Moirai.ask(FindUser, { id: 'gone' });
		expect(missing).toBeInstanceOf(NotFoundError);
	});
});

describe('typed handlers', () => {
	const CitiesInput = t.Object({ country: t.String({ pattern: '^[A-Z]{2}$' }) });
	type CitiesInput = Static<typeof CitiesInput>;
	type CitiesResult = string[];
	class CountryClosed extends DomainError.for('NOT_FOUND', 404) {}

	@Query.register({ errors: [CountryClosed], name: 'cities', input: CitiesInput })
	class Cities extends Query<CitiesInput, CitiesResult, CountryClosed> {
		public override handle({ country }: CitiesInput): CitiesResult | CountryClosed {
			return country === 'FR' ? new CountryClosed('closed') : ['Douala', 'Yaoundé'];
		}
	}

	@Query.register({ errors: [], name: 'categories' })
	class Categories extends Query<void, string[]> {
		public override handle(): string[] {
			return ['music', 'comedy'];
		}
	}

	@Action.register({ errors: [], name: 'ping' })
	class Ping extends Action<void, { pong: true }> {
		public override async handle() {
			log.push('ping');
			return { pong: true as const };
		}
	}

	@Action.register({ errors: [], name: 'idempotent-ping', idempotent: true })
	class IdempotentPing extends Action<void, number> {
		private static calls = 0;
		public override handle() {
			return ++IdempotentPing.calls;
		}
	}

	it('types the input and the outcome from the class parameters', async () => {
		const outcome = await Moirai.ask(Cities, { country: 'CM' });
		expectTypeOf(outcome).toEqualTypeOf<
			CitiesResult | CountryClosed | InvalidInputError | CallForbiddenError
		>();
		expect(outcome).toEqual(['Douala', 'Yaoundé']);
		expect(await Moirai.ask(Cities, { country: 'FR' })).toBeInstanceOf(CountryClosed);
		expect(await Moirai.ask(Cities, { country: 'cm' })).toBeInstanceOf(InvalidInputError);
	});

	it('runs a query and an action that take no input, without one', async () => {
		expect(await Moirai.ask(Categories)).toEqual(['music', 'comedy']);
		expect(await Moirai.execute(Ping)).toEqual({ pong: true });
		expect(log).toContain('ping');
		const first = await Moirai.execute(IdempotentPing, undefined, { idempotencyKey: 'once' });
		expect(await Moirai.execute(IdempotentPing, undefined, { idempotencyKey: 'once' })).toBe(first);
		expect(await Moirai.execute(IdempotentPing)).toBeInstanceOf(IdempotencyKeyRequiredError);
	});

	it('requires the input of a handler that takes one', () => {
		expectTypeOf<Parameters<typeof Moirai.ask<typeof Cities>>>().toEqualTypeOf<
			[query: typeof Cities, input: CitiesInput]
		>();
		expectTypeOf<Parameters<typeof Moirai.ask<typeof Categories>>>().toEqualTypeOf<
			[query: typeof Categories, input?: undefined]
		>();
	});
});

describe('outbox', () => {
	beforeEach(() => {
		sent.length = 0;
	});

	it('relays the effects of an action once it has committed', async () => {
		await Moirai.execute(TopUp, { amount: 5 }, { idempotencyKey: 'tap-5' });
		expect(sent).toEqual([{ to: 'ada', amount: 5 }]);
		expect(outbox.rows[0]!.dispatchedAt).toBeInstanceOf(Date);
	});

	it('keeps the effects for later when relayOnCommit is off, and defers the relay when asked', async () => {
		setOptions({ relayOnCommit: false });
		await UnitOfWork.run(() => Outbox.enqueue({ kind: 'mail.send', payload: { to: 'later' } }));
		expect(sent).toEqual([]);
		expect(await Outbox.sweep()).toEqual({ dispatched: 1, retried: 0, dead: 0 });
		expect(sent).toEqual([{ to: 'later' }]);

		const deferred: Promise<unknown>[] = [];
		setOptions({ defer: (work) => void deferred.push(work) });
		await UnitOfWork.run(() => Outbox.enqueue({ kind: 'mail.send', payload: { to: 'bg' } }));
		expect(deferred).toHaveLength(1);
		await deferred[0];
		expect(sent).toEqual([{ to: 'later' }, { to: 'bg' }]);
	});

	it('leaves the effects of a delayed row until it is due', async () => {
		await UnitOfWork.run(() =>
			Outbox.enqueue({
				kind: 'mail.send',
				payload: { to: 'tomorrow' },
				availableAt: new Date(Date.now() + 86_400_000)
			})
		);
		expect(sent).toEqual([]);
		expect(await Outbox.relay()).toEqual({ dispatched: 0, retried: 0, dead: 0 });
	});

	it('retries a failing row with a backoff, then marks it dead', async () => {
		const dead: string[] = [];
		setOptions({
			relayOnCommit: false,
			maxRelayAttempts: 2,
			onDead: (row) => void dead.push(row.id)
		});
		const [id] = await Outbox.enqueue({ kind: 'mail.send', payload: { to: 'x', fail: true } });

		expect(await Outbox.relay()).toEqual({ dispatched: 0, retried: 1, dead: 0 });
		const retried = outbox.rows[0]!;
		expect(retried.attempts).toBe(1);
		expect(retried.lastError).toBe('smtp down');
		expect(retried.availableAt.getTime()).toBeGreaterThan(Date.now() + 4_000);

		await outbox.markFailed(id!, { attempts: 1, lastError: 'smtp down', availableAt: new Date(0) });
		expect(await Outbox.relay()).toEqual({ dispatched: 0, retried: 0, dead: 1 });
		expect(outbox.rows[0]!.deadAt).toBeInstanceOf(Date);
		expect(dead).toEqual([id!]);
	});

	it('claims, handles and marks each row in units of work of their own', async () => {
		setOptions({ relayOnCommit: false });
		await Outbox.enqueue({ kind: 'mail.send', payload: { to: 'x', fail: true } });
		await Outbox.enqueue({ kind: 'mail.send', payload: { to: 'y' } });
		log.length = 0;
		expect(await Outbox.relay()).toEqual({ dispatched: 1, retried: 1, dead: 0 });
		// The claim, the failing row (rolled back), its failure, and the other row.
		expect(log).toEqual([
			'BEGIN',
			'COMMIT',
			'BEGIN',
			'ROLLBACK',
			'BEGIN',
			'COMMIT',
			'BEGIN',
			'COMMIT'
		]);
	});

	it('keeps other relays off the rows it claimed until its lease ends', async () => {
		setOptions({ relayOnCommit: false });
		await Outbox.enqueue({ kind: 'mail.send', payload: { to: 'z' } });
		const now = new Date();
		const claimed = await outbox.claimDue({
			now,
			leaseUntil: new Date(now.getTime() + 300_000),
			limit: 10
		});
		expect(claimed).toHaveLength(1);
		expect(await Outbox.relay()).toEqual({ dispatched: 0, retried: 0, dead: 0 });
		const later = new Date(now.getTime() + 301_000);
		expect(await outbox.claimDue({ now: later, leaseUntil: later, limit: 10 })).toHaveLength(1);
	});

	it('fails the rows of an unknown kind', async () => {
		setOptions({ relayOnCommit: false });
		await Outbox.enqueue({ kind: 'nobody.handles', payload: {} });
		expect(await Outbox.relay()).toEqual({ dispatched: 0, retried: 1, dead: 0 });
		expect(outbox.rows[0]!.lastError).toContain('nobody.handles');
	});

	it('backs off exponentially, up to an hour', () => {
		expect([1, 2, 3].map(backoffMs)).toEqual([5_000, 10_000, 20_000]);
		expect(backoffMs(30)).toBe(3_600_000);
	});
});

describe('inbox', () => {
	it('runs the work once per message and consumer', async () => {
		const done: string[] = [];
		const message = { messageId: 'm1', consumer: 'billing' };
		expect(await Inbox.once(message, () => void done.push('a'))).toBe(true);
		expect(await Inbox.once(message, () => void done.push('b'))).toBe(false);
		expect(await Inbox.once({ ...message, consumer: 'mail' }, () => void done.push('c'))).toBe(
			true
		);
		expect(done).toEqual(['a', 'c']);
	});
});

describe('events', () => {
	const handled: string[] = [];

	class Billing {
		@Event.on('order.paid', { consumer: 'billing.invoice' })
		public invoice(payload: { order: string }, meta: { attempt: number }) {
			handled.push(`invoice:${payload.order}:${meta.attempt}`);
		}

		@Event.on('order.paid', { consumer: 'billing.flaky', retry: { attempts: 2 } })
		public static flaky(payload: { order: string; fail?: boolean }) {
			if (payload.fail) throw new Error('down');
			handled.push(`flaky:${payload.order}`);
		}
	}

	beforeEach(() => {
		handled.length = 0;
		expect(Billing).toBeDefined();
	});

	it('delivers an event to each handler once the unit of work commits', async () => {
		await UnitOfWork.run(async () => {
			await Event.publish('order.paid', { order: 'o1' });
			expect(handled).toEqual([]);
		});
		expect(handled.sort()).toEqual(['flaky:o1', 'invoice:o1:1']);
		expect(outbox.rows.map((row) => row.kind)).toEqual([MOIRAI_EVENT_EFFECT, MOIRAI_EVENT_EFFECT]);
		expect(Event.consumersOf('order.paid')).toEqual(['billing.invoice', 'billing.flaky']);
	});

	it('delivers nothing when the unit of work rolls back', async () => {
		await expect(
			UnitOfWork.run(async () => {
				await Event.publish('order.paid', { order: 'o2' });
				throw new Error('refused');
			})
		).rejects.toThrow('refused');
		expect(handled).toEqual([]);
		expect(outbox.rows).toEqual([]);
	});

	it('retries each handler on its own, and handles an event once per handler', async () => {
		setOptions({ relayOnCommit: false });
		await UnitOfWork.run(() => Event.publish('order.paid', { order: 'o3', fail: true }));
		expect(await Outbox.sweep()).toEqual({ dispatched: 1, retried: 1, dead: 0 });
		expect(handled).toEqual(['invoice:o3:1']);

		// The flaky handler has two attempts: the second failure is its last.
		const flaky = outbox.rows.find((row) => row.dispatchedAt === null)!;
		await outbox.insert([{ ...flaky, availableAt: new Date(0) }]);
		expect(await Outbox.relay()).toEqual({ dispatched: 0, retried: 0, dead: 1 });

		// A repeated delivery of a handled event does nothing.
		const invoice = outbox.rows.find((row) => row.dispatchedAt !== null)!;
		await outbox.insert([
			{ ...invoice, id: 'again', dispatchedAt: null, availableAt: new Date(0) }
		]);
		expect(await Outbox.relay({ ids: ['again'] })).toEqual({ dispatched: 1, retried: 0, dead: 0 });
		expect(handled).toEqual(['invoice:o3:1']);
	});

	it('refuses two handlers with one consumer name', () => {
		expect(() => {
			class Twice {
				@Event.on('order.paid', { consumer: 'billing.invoice' })
				public again() {}
			}
			return Twice;
		}).toThrow(DuplicateEventConsumerError);
	});
});

describe('heracles jobs', () => {
	@Job.register({ name: 'receipt', queue: 'mail' })
	class ReceiptJob extends Job {
		constructor(public readonly order: string) {
			super();
		}
		protected async execute() {}
	}

	afterEach(() => JobRegistry.clear());

	it('describes a job dispatch as an outbox effect', () => {
		expect(() => job(ReceiptJob, ['o-1'])).toThrow('is not registered');
		JobRegistry.set([
			['elysium.heracles.job.receipt', { jobClass: ReceiptJob as never, module: null as never }]
		]);
		expect(job(ReceiptJob, ['o-1'], { delay: 1000 } as never)).toEqual({
			kind: HERACLES_JOB_EFFECT,
			payload: { job: 'elysium.heracles.job.receipt', args: ['o-1'], options: { delay: 1000 } }
		});
	});

	it('runs a @Once() job once per dispatch id, in a unit of work', async () => {
		const billed: string[] = [];
		@Job.register({ name: 'bill', queue: 'billing' })
		@Once()
		class BillJob extends Job {
			constructor(public readonly invoice: string) {
				super();
			}
			protected async execute() {
				billed.push(this.invoice);
			}
		}
		JobRegistry.set([
			['elysium.heracles.job.bill', { jobClass: BillJob as never, module: null as never }]
		]);

		const delivery = (dispatchId: string) => new (WithId(BillJob, 'job-1', dispatchId))('inv-1');
		await delivery('schedule:bill:inv-1@t1').run();
		await delivery('schedule:bill:inv-1@t1').run();
		await delivery('schedule:bill:inv-1@t2').run();
		expect(billed).toEqual(['inv-1', 'inv-1']);
		expect(log).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
		expect(() => Once()(class NotAJob {})).toThrow(InvalidOnceJobError);
	});
});

describe('module stores', () => {
	const handled: string[] = [];
	let app: TestingApp | undefined;
	let root: {
		outbox: MemoryOutboxStore;
		inbox: MemoryInboxStore;
		idempotency: MemoryIdempotencyStore;
	};
	let billing: { outbox: MemoryOutboxStore; inbox: MemoryInboxStore };
	let ledger: { outbox: MemoryOutboxStore; inbox: MemoryInboxStore };
	let billingOptions: Partial<MoiraiOptions> = {};

	@Action.register({ errors: [], input: t.Object({ order: t.String() }) })
	class Charge extends Action {
		public async handle(input: { order: string }) {
			await Outbox.enqueue({ kind: 'mail.send', payload: { to: input.order } });
			await Event.publish('invoice.issued', { order: input.order });
			return { charged: input.order };
		}
	}

	@Action.register({ errors: [], input: t.Object({ n: t.Integer() }), idempotent: true })
	class Pay extends Action {
		public handle(input: { n: number }) {
			return { paid: input.n };
		}
	}

	class Ledger {
		@Event.on('invoice.issued', { consumer: 'ledger.record' })
		public record(payload: { order: string }) {
			handled.push(`ledger:${payload.order}`);
		}
	}

	class Prices {
		public of(order: string) {
			return `${order}:42`;
		}
	}

	@Query.register({ errors: [], input: t.Object({ order: t.String() }) })
	class Quote extends Query {
		public constructor(@Service.inject(Prices) private readonly prices: Prices) {
			super();
		}

		public handle(input: { order: string }) {
			return { price: this.prices.of(input.order) };
		}
	}

	class Notifier {
		@Event.on('invoice.issued', { consumer: 'notify' })
		public static notify(payload: { order: string }) {
			handled.push(`notify:${payload.order}`);
		}
	}

	@Module.register({
		services: (_config) => [
			Charge,
			Pay,
			Prices,
			Quote,
			...Moirai.stores({
				outbox: () => billing.outbox,
				inbox: () => billing.inbox,
				...billingOptions
			})
		]
	})
	class BillingModule extends Module {}

	@Module.register({
		services: [Ledger, ...Moirai.stores({ outbox: () => ledger.outbox, inbox: () => ledger.inbox })]
	})
	class LedgerModule extends Module {}

	@Module.register({})
	class EmptyModule extends Module {}

	const boot = async () => {
		app = await Application.testing({
			modules: [
				MoiraiModule.with({
					outbox: () => root.outbox,
					inbox: () => root.inbox,
					idempotency: () => root.idempotency
				}),
				BillingModule,
				LedgerModule,
				EmptyModule
			],
			overrides: { 'db.transaction': withUnitOfWork((callback) => callback()) },
			boot: 'eager'
		});
	};

	beforeEach(async () => {
		root = {
			outbox: new MemoryOutboxStore(),
			inbox: new MemoryInboxStore(),
			idempotency: new MemoryIdempotencyStore()
		};
		billing = { outbox: new MemoryOutboxStore(), inbox: new MemoryInboxStore() };
		ledger = { outbox: new MemoryOutboxStore(), inbox: new MemoryInboxStore() };
		billingOptions = {};
		handled.length = 0;
		sent.length = 0;
		expect(Notifier).toBeDefined();
	});

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('runs an action with the stores of its module', async () => {
		await boot();
		expect(await Moirai.execute(Charge, { order: 'o1' })).toEqual({ charged: 'o1' });
		expect(root.outbox.rows).toEqual([]);
		expect(billing.outbox.rows.map((row) => row.kind).sort()).toEqual([
			'mail.send',
			MOIRAI_EVENT_EFFECT,
			MOIRAI_EVENT_EFFECT
		]);
		expect(billing.outbox.rows.every((row) => row.dispatchedAt !== null)).toBe(true);
		expect(sent).toEqual([{ to: 'o1' }]);
		expect(handled.sort()).toEqual(['ledger:o1', 'notify:o1']);
	});

	it('runs a query with the services of its module', async () => {
		await boot();
		// Prices is private to BillingModule, and the query is asked from outside it.
		expect(await Moirai.ask(Quote, { order: 'o1' })).toEqual({ price: 'o1:42' });
	});

	it('records each handled event in the inbox of the handler module', async () => {
		await boot();
		await Moirai.execute(Charge, { order: 'o2' });
		const delivery = billing.outbox.rows.find((row) => row.kind === MOIRAI_EVENT_EFFECT)!;
		const id = (delivery.payload as { id: string }).id;
		expect(await ledger.inbox.record(id, 'ledger.record')).toBe(false);
		// A handler outside any module runs in the module of the outbox it came from.
		expect(await billing.inbox.record(id, 'notify')).toBe(false);
		expect(await root.inbox.record(id, 'notify')).toBe(true);
	});

	it('uses the stores of MoiraiModule that a module leaves out', async () => {
		await boot();
		expect(await Moirai.execute(Pay, { n: 1 }, { idempotencyKey: 'p' })).toEqual({ paid: 1 });
		expect(await root.idempotency.get('anonymous:Pay:p')).toBeDefined();
	});

	it('takes the options a module overrides, and sweeps one outbox or all of them', async () => {
		billingOptions = { relayOnCommit: false };
		await boot();
		await Moirai.execute(Charge, { order: 'o3' });
		expect(sent).toEqual([]);
		expect(await Outbox.relay()).toEqual({ dispatched: 0, retried: 0, dead: 0 });
		expect(await Outbox.sweep({ module: LedgerModule })).toEqual({
			dispatched: 0,
			retried: 0,
			dead: 0
		});
		expect(await Outbox.sweep()).toEqual({ dispatched: 3, retried: 0, dead: 0 });
		expect(sent).toEqual([{ to: 'o3' }]);

		await Moirai.execute(Charge, { order: 'o4' });
		expect(await Outbox.sweep({ module: BillingModule })).toEqual({
			dispatched: 3,
			retried: 0,
			dead: 0
		});
		expect(() => Outbox.relay({ module: EmptyModule })).toThrow(MissingStoreError);
	});

	it('lists private services for the module', () => {
		const inbox = new MemoryInboxStore();
		const withOptions = Moirai.stores({ relayBatch: 5, inbox });
		expect(withOptions.map((def) => (def as { name: string }).name)).toEqual([
			MOIRAI_MODULE_OPTIONS,
			MOIRAI_INBOX_STORE
		]);
		expect(withOptions.every((def) => (def as { global: boolean }).global === false)).toBe(true);
		expect(Moirai.stores({ inbox })).toHaveLength(1);
	});
});

describe('helpers', () => {
	it('hashes inputs whatever the order of their keys', async () => {
		expect(await requestHash({ a: 1, b: [{ c: 2, d: 3 }] })).toBe(
			await requestHash({ b: [{ d: 3, c: 2 }], a: 1 })
		);
		expect(await requestHash({ a: 1 })).not.toBe(await requestHash({ a: 2 }));
	});

	it('makes time-ordered UUIDs version 7', () => {
		const a = uuidv7(1_000);
		const b = uuidv7(2_000);
		expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(a < b).toBe(true);
	});
});

describe('Moirai.lock', () => {
	it('needs a unit of work', async () => {
		await expect(Moirai.lock('wallet:1')).rejects.toBeInstanceOf(LockOutsideUnitOfWorkError);
	});

	it('serializes the units of work that take the same key, until each one ends', async () => {
		const order: string[] = [];
		const hold = (name: string, key: string, wait: number, fail = false) =>
			UnitOfWork.run(async () => {
				await Moirai.lock(key);
				order.push(`${name} in`);
				await new Promise((resolve) => setTimeout(resolve, wait));
				order.push(`${name} out`);
				if (fail) throw new Error('rolled back');
			}).catch(() => undefined);

		await Promise.all([
			hold('a', 'wallet:1', 20, true),
			hold('b', 'wallet:1', 0),
			hold('c', 'wallet:2', 0)
		]);
		expect(order.indexOf('a out')).toBeLessThan(order.indexOf('b in'));
		expect(order.indexOf('c in')).toBeLessThan(order.indexOf('a out'));
	});

	it('locks from an action handler, on a key read in the handler', async () => {
		const seen: string[] = [];
		@Action.register({ errors: [], input: t.Object({ id: t.String() }) })
		class Settle extends Action {
			public async handle(input: { id: string }) {
				await Moirai.lock(`top-up-wallet:${input.id.slice(0, 1)}`);
				seen.push(`${input.id} in`);
				await new Promise((resolve) => setTimeout(resolve, 5));
				seen.push(`${input.id} out`);
				return input.id;
			}
		}

		await Promise.all([Moirai.execute(Settle, { id: 'w1' }), Moirai.execute(Settle, { id: 'w2' })]);
		expect(seen).toEqual(['w1 in', 'w1 out', 'w2 in', 'w2 out']);
	});
});

describe('outcomes', () => {
	class Missing extends DomainError.for('MISSING', 404) {}

	@Action.register({ errors: [Missing], input: t.Object({ id: t.String() }) })
	class Rename extends Action {
		public handle(input: { id: string }) {
			return input.id === 'none' ? new Missing('No such thing.') : { id: input.id };
		}
	}

	@Query.register({ errors: [Missing], input: t.Object({ id: t.String() }) })
	class Find extends Query {
		public handle(input: { id: string }) {
			return input.id === 'none' ? new Missing('No such thing.') : { id: input.id };
		}
	}

	it('give the result or the refusal as a value', async () => {
		expect(await Moirai.execute(Rename, { id: 'a' })).toEqual({ id: 'a' });
		expect(await Moirai.execute(Rename, { id: 'none' })).toBeInstanceOf(Missing);
	});

	it('give the result, or throw the refusal, with orThrow()', async () => {
		const renamed = await Moirai.execute(Rename, { id: 'a' }).orThrow();
		expectTypeOf(renamed).toEqualTypeOf<{ id: string }>();
		expect(renamed).toEqual({ id: 'a' });
		await expect(Moirai.execute(Rename, { id: 'none' }).orThrow()).rejects.toBeInstanceOf(Missing);
		await expect(Moirai.ask(Find, { id: 'b' }).orThrow()).resolves.toEqual({ id: 'b' });
		await expect(Moirai.ask(Find, { id: 'none' }).orThrow()).rejects.toBeInstanceOf(Missing);
		await expect(Moirai.ask(Find, { id: 1 } as never).orThrow()).rejects.toBeInstanceOf(
			InvalidInputError
		);
	});

	it('name the errors of the handler alone', () => {
		expectTypeOf<Moirai.ErrorsOf<typeof Rename>>().toEqualTypeOf<Missing>();
	});
});

describe('outbox payload replacement', () => {
	it('replaces the payload of a row once its handler succeeds', async () => {
		setOptions({ relayOnCommit: false });
		registerEffect('otp.send', (payload, _row, context) => {
			const otp = payload as { to: string; code: string | null; fail?: boolean };
			if (otp.fail) {
				context.replacePayload({ ...otp, code: null });
				throw new Error('sms down');
			}
			context.replacePayload({ ...otp, code: null });
		});
		await Outbox.enqueue({ kind: 'otp.send', payload: { to: '+237', code: '123456' } });
		await Outbox.enqueue({ kind: 'otp.send', payload: { to: '+225', code: '654321', fail: true } });

		expect(await Outbox.relay()).toEqual({ dispatched: 1, retried: 1, dead: 0 });
		const [sent, failed] = outbox.rows;
		expect(sent!.payload).toEqual({ to: '+237', code: null });
		expect(failed!.payload).toEqual({ to: '+225', code: '654321', fail: true });
	});

	it('refuses a replacement the store cannot make, and retries the row', async () => {
		setOptions({ relayOnCommit: false });
		const store = new MemoryOutboxStore();
		Object.defineProperty(store, 'replacePayload', { value: undefined });
		Service.remove(MOIRAI_OUTBOX_STORE);
		Service.instance(MOIRAI_OUTBOX_STORE, store);
		registerEffect('otp.plain', (payload, _row, context) => context.replacePayload(payload));
		await Outbox.enqueue({ kind: 'otp.plain', payload: { to: 'x' } });

		expect(await Outbox.relay()).toEqual({ dispatched: 0, retried: 1, dead: 0 });
		expect(store.rows[0]!.lastError).toBe(
			new PayloadReplacementUnsupportedError('MemoryOutboxStore').message
		);
	});
});
