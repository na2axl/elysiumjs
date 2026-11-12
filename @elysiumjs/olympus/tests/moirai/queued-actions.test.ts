// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { TestingApp } from '../../src/index';

import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { Heracles, HeraclesModule, MemoryTransport, Queue } from '../../src/heracles/index';
import {
	Application,
	ConflictError,
	DATABASE_TRANSACTION_SERVICE,
	MemoryLock,
	Module,
	t
} from '../../src/index';
import { withUnitOfWork } from '../../src/mnemosyne/index';
import {
	Action,
	CallForbiddenError,
	DuplicateActionNameError,
	IdempotencyKeyRequiredError,
	InvalidInputError,
	MemoryIdempotencyStore,
	MemoryInboxStore,
	MemoryOutboxStore,
	Moirai,
	MoiraiModule,
	QueuedActionsUnavailableError,
	QueuedInputError,
	UnknownActionError
} from '../../src/moirai';
import { ActionJob } from '../../src/moirai/heracles';

const ran: string[] = [];

type GreetInput = { name: string; times?: number };

@Action.register({
	name: 'queued.greet',
	errors: [ConflictError],
	input: t.Object({ name: t.String(), times: t.Integer({ default: 1 }) }),
	authorize: (input) => input.name !== 'mallory',
	queue: 'mail'
})
class Greet extends Action<GreetInput> {
	public handle(input: GreetInput) {
		if (input.name === 'refused') return new ConflictError('no');
		ran.push(`greet ${input.name} x${input.times}`);
		return { greeted: input.name };
	}
}

@Action.register({
	name: 'queued.charge',
	errors: [],
	input: t.Object({ amount: t.Integer() }),
	idempotent: true
})
class Charge extends Action<{ amount: number }> {
	public handle(input: { amount: number }) {
		ran.push(`charge ${input.amount}`);
		return { charged: input.amount };
	}
}

@Action.register({ name: 'queued.remind', errors: [], input: t.Object({ at: t.Date() }) })
class Remind extends Action<{ at: Date }> {
	public handle(input: { at: Date }) {
		ran.push(`remind ${input.at instanceof Date ? input.at.toISOString() : typeof input.at}`);
	}
}

@Action.register({ name: 'queued.store', errors: [], input: t.Object({ data: t.Any() }) })
class Store extends Action<{ data: unknown }> {
	public handle(_input: { data: unknown }) {}
}

@Action.register({ name: 'queued.once', errors: [], retry: false })
class Once extends Action {
	public handle() {
		ran.push('once');
	}
}

@Action.register({ name: 'queued.outer', errors: [] })
class Outer extends Action {
	public static fail = false;

	public async handle() {
		await Moirai.enqueue(Greet, { name: 'inner' }).orThrow();
		ran.push('outer done');
		if (Outer.fail) throw new Error('rollback');
	}
}

@Module.register({ jobs: [ActionJob] })
class AppModule extends Module {}

@Module.register({})
class BareModule extends Module {}

describe('Moirai.enqueue', () => {
	let app: TestingApp | undefined;

	const boot = async (modules: Function[] = [AppModule], lazy = false) => {
		app = await Application.testing({
			modules: [
				HeraclesModule.with({
					queues: {
						default: { transport: MemoryTransport },
						mail: { transport: MemoryTransport }
					}
				}),
				MoiraiModule.with({
					idempotency: () => new MemoryIdempotencyStore(),
					outbox: () => new MemoryOutboxStore(),
					inbox: () => new MemoryInboxStore(),
					lock: () => new MemoryLock()
				}),
				...(modules as never[])
			],
			overrides: {
				[DATABASE_TRANSACTION_SERVICE]: withUnitOfWork((callback) => callback())
			},
			boot: lazy ? 'lazy' : 'eager'
		});
	};

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
		ran.length = 0;
		Outer.fail = false;
	});

	it('answers once the job is accepted, and runs the action in the job', async () => {
		await boot();
		const queued = await Moirai.enqueue(Greet, { name: 'ada' }, { queue: 'default' }).orThrow();
		expect(queued).toEqual({
			jobId: expect.any(String),
			dispatchId: expect.any(String),
			queue: 'default'
		});
		expect(ran).toEqual([]);

		await MemoryTransport.settled();
		expect(ran).toEqual(['greet ada x1']);
		expect((await Queue.get('default').getJobStatus(queued))?.status).toBe('completed');
	});

	it('uses the queue of the registration when the call names none', async () => {
		await boot();
		const queued = await Moirai.enqueue(Greet, { name: 'bob' }).orThrow();
		expect(queued.queue).toBe('mail');
		await MemoryTransport.settled();
		expect(ran).toEqual(['greet bob x1']);
	});

	it('works on a lazy boot', async () => {
		await boot([AppModule], true);
		await Moirai.enqueue(Greet, { name: 'lazy' }).orThrow();
		await MemoryTransport.settled();
		expect(ran).toEqual(['greet lazy x1']);
	});

	it('checks the input, authorize and the idempotency key when the call is made', async () => {
		await boot();
		const invalid = await Moirai.enqueue(Greet, { name: 1 } as never);
		expect(invalid.error).toBeInstanceOf(InvalidInputError);
		const forbidden = await Moirai.enqueue(Greet, { name: 'mallory' });
		expect(forbidden.error).toBeInstanceOf(CallForbiddenError);
		const keyless = await Moirai.enqueue(Charge, { amount: 5 });
		expect(keyless.error).toBeInstanceOf(IdempotencyKeyRequiredError);
		await MemoryTransport.settled();
		expect(ran).toEqual([]);
	});

	it('carries dates in the input', async () => {
		await boot();
		await Moirai.enqueue(Remind, { at: new Date('2026-01-01T00:00:00Z') }).orThrow();
		await MemoryTransport.settled();
		expect(ran).toEqual(['remind 2026-01-01T00:00:00.000Z']);
	});

	it('refuses an input that does not survive JSON', async () => {
		await boot();
		await expect(
			Moirai.enqueue(Store, { data: new Map([['a', 1]]) }).orThrow()
		).rejects.toBeInstanceOf(QueuedInputError);
	});

	it('refuses an action whose name another class took', async () => {
		await boot();
		@Action.register({ name: 'queued.clash', errors: [] })
		class First extends Action {
			public handle() {}
		}
		@Action.register({ name: 'queued.clash', errors: [] })
		class Second extends Action {
			public handle() {}
		}
		await expect(Moirai.enqueue(First).orThrow()).rejects.toBeInstanceOf(DuplicateActionNameError);
		expect(await Moirai.enqueue(Second).orThrow()).toMatchObject({ queue: 'default' });
	});

	it('replays an idempotent queued call given the same key', async () => {
		await boot();
		const call = { idempotencyKey: 'k-1', scope: 'user-1' };
		await Moirai.enqueue(Charge, { amount: 5 }, call).orThrow();
		await Moirai.enqueue(Charge, { amount: 5 }, call).orThrow();
		await MemoryTransport.settled();
		expect(ran).toEqual(['charge 5']);
	});

	it('ends the job of a refused call without retrying it', async () => {
		await boot();
		const queued = await Moirai.enqueue(Greet, { name: 'refused' }).orThrow();
		await MemoryTransport.settled();
		const status = await Queue.get('mail').getJobStatus(queued);
		expect(status?.status).toBe('completed');
		expect(status?.retries).toBe(0);
	});

	it('dispatches the job of an action registered with retry: false without retries', async () => {
		await boot();
		const dispatch = spyOn(Heracles, 'dispatch');
		try {
			await Moirai.enqueue(Once).orThrow();
			expect(dispatch.mock.calls[0]?.[2]).toMatchObject({ maxRetries: 0 });
		} finally {
			dispatch.mockRestore();
		}
	});

	it('passes the schedule and priority of the call', async () => {
		await boot();
		const dispatch = spyOn(Heracles, 'dispatch');
		const scheduledFor = new Date(Date.now() + 60_000);
		try {
			await Moirai.enqueue(Greet, { name: 'later' }, { scheduledFor, priority: 3 }).orThrow();
			expect(dispatch.mock.calls[0]?.[2]).toMatchObject({ scheduledFor, priority: 3 });
		} finally {
			dispatch.mockRestore();
		}
	});

	it('dispatches the job of a call made in a unit of work once it commits', async () => {
		await boot();
		await Moirai.execute(Outer).orThrow();
		await MemoryTransport.settled();
		expect(ran).toEqual(['outer done', 'greet inner x1']);

		ran.length = 0;
		Outer.fail = true;
		await expect(Moirai.execute(Outer).orThrow()).rejects.toThrow('rollback');
		await MemoryTransport.settled();
		expect(ran).toEqual(['outer done']);
	});

	it('needs a queue that exists', async () => {
		await boot();
		await expect(
			Moirai.enqueue(Greet, { name: 'x' }, { queue: 'nowhere' }).orThrow()
		).rejects.toThrow('Queue nowhere does not exist');
	});

	it('needs ActionJob in the jobs of a loaded module', async () => {
		await boot([BareModule]);
		await expect(Moirai.enqueue(Greet, { name: 'ada' }).orThrow()).rejects.toBeInstanceOf(
			QueuedActionsUnavailableError
		);
	});

	it('fails the job of an unknown action', async () => {
		await boot();
		const ids = await Heracles.dispatch(ActionJob, [
			{ action: 'queued.missing', input: undefined, scope: 'anonymous' }
		]);
		await MemoryTransport.settled();
		const status = await Queue.get('default').getJobStatus(ids);
		expect(status?.status).toBe('failed');
		expect(status?.error).toContain(new UnknownActionError('queued.missing').message);
	});
});
