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

import type { MoiraiOptions } from '../src';

import { DomainError, Service, t } from '@elysiumjs/core';
import { Job, JobRegistry } from '@elysiumjs/heracles';
import { UnitOfWork, withUnitOfWork } from '@elysiumjs/mnemosyne';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { HERACLES_JOB_EFFECT, job } from '../src/heracles';
import {
	backoffMs,
	CommandForbiddenError,
	Commands,
	DEFAULT_OPTIONS_FOR_TESTS,
	IdempotencyConflictError,
	IdempotencyKeyRequiredError,
	IdempotencyKeyReusedError,
	Inbox,
	InvalidInputError,
	isTransientError,
	MemoryCommandLock,
	MemoryIdempotencyStore,
	MemoryInboxStore,
	MemoryOutboxStore,
	MissingStoreError,
	Moirai,
	MOIRAI_COMMAND_LOCK,
	MOIRAI_IDEMPOTENCY_STORE,
	MOIRAI_INBOX_STORE,
	MOIRAI_OPTIONS,
	MOIRAI_OUTBOX_STORE,
	Outbox,
	Queries,
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
	Service.instance(MOIRAI_COMMAND_LOCK, new MemoryCommandLock());
	setOptions();
});

afterEach(() => {
	for (const name of [
		'db.transaction',
		MOIRAI_OUTBOX_STORE,
		MOIRAI_IDEMPOTENCY_STORE,
		MOIRAI_INBOX_STORE,
		MOIRAI_COMMAND_LOCK,
		MOIRAI_OPTIONS
	]) {
		Service.remove(name);
	}
});

const sent: unknown[] = [];

class Mailer {
	@Moirai.effect('mail.send')
	public async send(payload: { to: string; fail?: boolean }) {
		if (payload.fail) throw new Error('smtp down');
		sent.push(payload);
	}
}

let runs = 0;

@Moirai.command({
	input: t.Object({ amount: t.Integer({ minimum: 1 }), note: t.Optional(t.String()) }),
	idempotent: true
})
class TopUp {
	public async handle(input: { amount: number; note?: string }) {
		runs++;
		log.push(`top-up ${input.amount}`);
		if (input.note === 'refuse') return new DomainError({ status: 409, detail: 'no' });
		await Outbox.enqueue({ kind: 'mail.send', payload: { to: 'ada', amount: input.amount } });
		return { balance: input.amount * 10 };
	}
}

@Moirai.command({ name: 'rename', input: t.Object({ name: t.String() }) })
class Rename {
	public handle(input: { name: string }) {
		log.push(`rename ${input.name}`);
		return { name: input.name };
	}
}

describe('commands', () => {
	beforeEach(() => {
		runs = 0;
		sent.length = 0;
	});

	it('validates the input and answers a 400 problem listing the mistakes', async () => {
		const error = await Commands.execute(TopUp, { amount: 0 }, { idempotencyKey: 'k' }).catch(
			(e) => e
		);
		expect(error).toBeInstanceOf(InvalidInputError);
		expect(error.status).toBe(400);
		expect(error.extensions.errors[0].pointer).toBe('/amount');
	});

	it('refuses a call that authorize declines with a 403 problem', async () => {
		@Moirai.command({
			input: t.Object({ id: t.String() }),
			authorize: (input) => input.id === 'mine'
		})
		class Delete {
			public handle() {
				return { deleted: true };
			}
		}
		expect(await Commands.execute(Delete, { id: 'mine' })).toEqual({ deleted: true });
		expect(Commands.execute(Delete, { id: 'yours' })).rejects.toBeInstanceOf(CommandForbiddenError);
	});

	it('runs in a unit of work, and joins the open one', async () => {
		expect(await Commands.execute(Rename, { name: 'ada' })).toEqual({ name: 'ada' });
		expect(log).toEqual(['BEGIN', 'rename ada', 'COMMIT']);

		log.length = 0;
		await UnitOfWork.run(async () => {
			await Commands.execute(Rename, { name: 'a' });
			await Commands.execute(Rename, { name: 'b' });
		});
		expect(log).toEqual(['BEGIN', 'rename a', 'rename b', 'COMMIT']);
	});

	it('needs an idempotency key for an idempotent command', async () => {
		const error = await Commands.execute(TopUp, { amount: 1 }).catch((e) => e);
		expect(error).toBeInstanceOf(IdempotencyKeyRequiredError);
		expect(error.status).toBe(428);
	});

	it('replays the stored response of a repeated key, and refuses it with another input', async () => {
		const first = await Commands.execute(TopUp, { amount: 2 }, { idempotencyKey: 'tap-1' });
		const again = await Commands.execute(TopUp, { amount: 2 }, { idempotencyKey: 'tap-1' });
		expect(first).toEqual({ balance: 20 });
		expect(again).toEqual(first);
		expect(runs).toBe(1);

		const reused = await Commands.execute(TopUp, { amount: 3 }, { idempotencyKey: 'tap-1' }).catch(
			(e) => e
		);
		expect(reused).toBeInstanceOf(IdempotencyKeyReusedError);
		expect(reused.status).toBe(422);
	});

	it('keeps the keys of two owners apart', async () => {
		const first = await Commands.execute(
			TopUp,
			{ amount: 2 },
			{ idempotencyKey: 'k', scope: 'ada' }
		);
		const other = await Commands.execute(
			TopUp,
			{ amount: 5 },
			{ idempotencyKey: 'k', scope: 'bob' }
		);
		expect(first).toEqual({ balance: 20 });
		expect(other).toEqual({ balance: 50 });
		expect(runs).toBe(2);
		// Without a user, the key belongs to anonymous callers.
		expect(await idempotency.get('anonymous:TopUp:k')).toBeUndefined();
		expect(await idempotency.get('ada:TopUp:k')).toMatchObject({ response: { balance: 20 } });
	});

	it('rolls back and stores nothing when the handler returns a DomainError', async () => {
		const error = await Commands.execute(
			TopUp,
			{ amount: 1, note: 'refuse' },
			{ idempotencyKey: 'tap-2' }
		).catch((e) => e);
		expect(error).toBeInstanceOf(DomainError);
		expect(error.status).toBe(409);
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

		expect(await Commands.execute(TopUp, { amount: 4 }, { idempotencyKey: 'tap-3' })).toEqual({
			balance: 99
		});
		expect(log.filter((entry) => entry === 'BEGIN')).toHaveLength(2);
	});

	it('retries transient failures up to maxAttempts, and not the others', async () => {
		let attempts = 0;
		@Moirai.command({ input: t.Object({ mode: t.String() }) })
		class Flaky {
			public handle(input: { mode: string }, context: { attempt: number }) {
				attempts++;
				if (input.mode === 'deadlock' && context.attempt < 3) {
					throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
				}
				if (input.mode === 'broken') throw new Error('broken');
				return { attempt: context.attempt };
			}
		}

		expect(await Commands.execute(Flaky, { mode: 'deadlock' })).toEqual({ attempt: 3 });
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
		expect(Commands.execute(Flaky, { mode: 'broken' })).rejects.toThrow('broken');
		await Bun.sleep(0);
		expect(attempts).toBe(1);
	});

	it('serializes the calls that share a serializeBy key', async () => {
		const order: string[] = [];
		@Moirai.command({
			input: t.Object({ wallet: t.String(), id: t.Integer() }),
			serializeBy: (i) => i.wallet
		})
		class Spend {
			public async handle(input: { id: number }) {
				order.push(`start ${input.id}`);
				await Bun.sleep(5);
				order.push(`end ${input.id}`);
			}
		}
		await Promise.all([
			Commands.execute(Spend, { wallet: 'w', id: 1 }),
			Commands.execute(Spend, { wallet: 'w', id: 2 })
		]);
		expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
	});

	it('runs without a unit of work when no database module is loaded', async () => {
		Service.remove('db.transaction');
		expect(await Commands.execute(Rename, { name: 'solo' })).toEqual({ name: 'solo' });
		expect(log).toEqual(['rename solo']);
	});

	it('explains a missing store', async () => {
		Service.remove(MOIRAI_IDEMPOTENCY_STORE);
		expect(Commands.execute(TopUp, { amount: 1 }, { idempotencyKey: 'x' })).rejects.toBeInstanceOf(
			MissingStoreError
		);
	});

	it('refuses a class that is not a command', () => {
		class Plain {
			public handle() {}
		}
		expect(Commands.execute(Plain, {})).rejects.toThrow('is not marked with @Moirai.command()');
	});
});

describe('queries', () => {
	@Moirai.query({ input: t.Object({ id: t.String({ minLength: 2 }) }) })
	class FindUser {
		public handle(input: { id: string }) {
			if (input.id === 'gone') return new DomainError({ status: 404 });
			return { id: input.id };
		}
	}

	it('validates and runs a query without a transaction', async () => {
		expect(await Queries.ask(FindUser, { id: 'ada' })).toEqual({ id: 'ada' });
		expect(log).toEqual([]);
		expect(Queries.ask(FindUser, { id: 'a' })).rejects.toBeInstanceOf(InvalidInputError);
		const error = await Queries.ask(FindUser, { id: 'gone' }).catch((e) => e);
		expect(error.status).toBe(404);
	});
});

describe('outbox', () => {
	beforeEach(() => {
		sent.length = 0;
	});

	it('relays the effects of a command once it has committed', async () => {
		await Commands.execute(TopUp, { amount: 5 }, { idempotencyKey: 'tap-5' });
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
