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
import type { QueuedAction } from '../../src/moirai';

import { afterEach, describe, expect, expectTypeOf, it } from 'bun:test';

import { HeraclesModule, MemoryTransport, Queue } from '../../src/heracles/index';
import {
	Application,
	ConflictError,
	DATABASE_TRANSACTION_SERVICE,
	MemoryLock,
	Module,
	t
} from '../../src/index';
import { UnitOfWork, withUnitOfWork } from '../../src/mnemosyne/index';
import {
	Action,
	CallForbiddenError,
	IdempotencyKeyRequiredError,
	InvalidInputError,
	MemoryIdempotencyStore,
	MemoryInboxStore,
	MemoryOutboxStore,
	Moirai,
	MoiraiModule,
	QueuedActionsUnavailableError
} from '../../src/moirai';
import { ActionJob } from '../../src/moirai/heracles';

const ran: string[] = [];

@Action.register({
	name: 'queued.greet',
	errors: [ConflictError],
	input: t.Object({ name: t.String(), times: t.Integer({ default: 1 }) }),
	authorize: (input) => input.name !== 'mallory',
	queue: 'mail'
})
class Greet extends Action<{ name: string; times: number }> {
	public handle(input: { name: string; times: number }) {
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

@Action.register({ name: 'queued.outer', errors: [] })
class Outer extends Action {
	public async handle() {
		await Moirai.execute(Greet, { name: 'inner' }, { queue: true }).orThrow();
		ran.push('outer done');
		if (Outer.fail) throw new Error('rollback');
	}

	public static fail = false;
}

@Module.register({ jobs: [ActionJob] })
class AppModule extends Module {}

@Module.register({})
class BareModule extends Module {}

describe('queued actions', () => {
	let app: TestingApp | undefined;

	const boot = async (modules: (typeof Module)[] = [AppModule]) => {
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
				...modules
			],
			overrides: {
				[DATABASE_TRANSACTION_SERVICE]: withUnitOfWork((callback) => callback())
			},
			boot: 'eager'
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
		const queued = await Moirai.execute(Greet, { name: 'ada' }, { queue: 'default' }).orThrow();
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

	it('uses the queue of the registration for `queue: true`', async () => {
		await boot();
		const queued = await Moirai.execute(Greet, { name: 'bob' }, { queue: true }).orThrow();
		expect(queued.queue).toBe('mail');
		await MemoryTransport.settled();
		expect(ran).toEqual(['greet bob x1']);
	});

	it('runs now without a queue', async () => {
		await boot();
		expect(await Moirai.execute(Greet, { name: 'eve' }).orThrow()).toEqual({ greeted: 'eve' });
		expect(ran).toEqual(['greet eve x1']);
	});

	it('checks the input, authorize and the idempotency key when the call is made', async () => {
		await boot();
		const invalid = await Moirai.execute(Greet, { name: 1 } as never, { queue: true });
		expect(invalid.error).toBeInstanceOf(InvalidInputError);
		const forbidden = await Moirai.execute(Greet, { name: 'mallory' }, { queue: true });
		expect(forbidden.error).toBeInstanceOf(CallForbiddenError);
		const keyless = await Moirai.execute(Charge, { amount: 5 }, { queue: true });
		expect(keyless.error).toBeInstanceOf(IdempotencyKeyRequiredError);
		await MemoryTransport.settled();
		expect(ran).toEqual([]);
	});

	it('replays an idempotent queued call given the same key', async () => {
		await boot();
		const call = { queue: true, idempotencyKey: 'k-1', scope: 'user-1' } as const;
		await Moirai.execute(Charge, { amount: 5 }, call).orThrow();
		await Moirai.execute(Charge, { amount: 5 }, call).orThrow();
		await MemoryTransport.settled();
		expect(ran).toEqual(['charge 5']);
	});

	it('ends the job of a refused call without retrying it', async () => {
		await boot();
		const queued = await Moirai.execute(Greet, { name: 'refused' }, { queue: true }).orThrow();
		await MemoryTransport.settled();
		const status = await Queue.get('mail').getJobStatus(queued);
		expect(status?.status).toBe('completed');
		expect(status?.retries).toBe(0);
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
		expect(UnitOfWork.active()).toBe(false);
	});

	it('needs ActionJob in the jobs of a loaded module', async () => {
		await boot([BareModule]);
		await expect(
			Moirai.execute(Greet, { name: 'ada' }, { queue: true }).orThrow()
		).rejects.toBeInstanceOf(QueuedActionsUnavailableError);
	});

	it('types a queued call by its call', () => {
		const queued = () => Moirai.execute(Greet, { name: 'ada', times: 1 }, { queue: 'mail' });
		expectTypeOf<Awaited<ReturnType<typeof queued>>['value']>().toEqualTypeOf<
			QueuedAction | undefined
		>();
		const now = () => Moirai.execute(Greet, { name: 'ada', times: 1 });
		expectTypeOf<Awaited<ReturnType<typeof now>>['value']>().toEqualTypeOf<
			{ greeted: string } | undefined
		>();
	});
});
