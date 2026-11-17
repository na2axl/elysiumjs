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
import type { WorkflowStep } from '../../src/odysseus/index';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
	Application,
	Clock,
	DomainError,
	Module,
	Runtime,
	Service,
	t,
	ValidationFailedError
} from '../../src/index';
import {
	EngineDriver,
	InvalidWorkflowError,
	MemoryWorkflowStore,
	Odysseus,
	OdysseusModule,
	OdysseusNotConfiguredError,
	UnregisteredWorkflowError,
	Workflow,
	WorkflowAlreadyStartedError,
	WorkflowDriverUnavailableError,
	WorkflowEvent,
	WorkflowFinishedError,
	WorkflowNotFoundError,
	Workflows,
	WorkflowStepFailedError,
	WorkflowStore,
	WorkflowTimeoutError
} from '../../src/odysseus/index';
import { testRuntime } from '../core/test-runtime';

const DAY = 86_400_000;

class OutOfStock extends DomainError.for('OUT_OF_STOCK', 409) {
	constructor(sku: string) {
		super(`${sku} is out of stock.`, { extensions: { sku } });
	}
}

const Paid = WorkflowEvent.define('order-paid', t.Object({ amount: t.Integer({ minimum: 1 }) }));

/** Counts the side effects of each step, across replays. */
const calls: Record<string, number> = {};
const hit = (name: string) => (calls[name] = (calls[name] ?? 0) + 1);

@Service.register()
class Inventory {
	public stock = 5;

	public reserve(sku: string, quantity: number): { reservationId: string } | OutOfStock {
		hit('reserve');
		if (quantity > this.stock) return new OutOfStock(sku);
		return { reservationId: `res-${sku}` };
	}
}

type OrderParams = { sku: string; quantity: number };
type OrderOutput = { reservationId: string; amount: number } | OutOfStock | WorkflowTimeoutError;

@Workflow.register({
	name: 'orders.fulfil',
	params: t.Object({ sku: t.String(), quantity: t.Integer({ minimum: 1 }) }),
	errors: [OutOfStock]
})
class FulfilOrder extends Workflow<OrderParams, OrderOutput> {
	constructor(@Service.inject(Inventory) private readonly inventory: Inventory) {
		super();
	}

	public async run(params: OrderParams, step: WorkflowStep): Promise<OrderOutput> {
		const reservation = await step.do('reserve', () =>
			this.inventory.reserve(params.sku, params.quantity)
		);
		if (reservation instanceof OutOfStock) return reservation;
		const paid = await step.waitFor('wait for payment', Paid, { timeout: '2 days' });
		if (paid instanceof WorkflowTimeoutError) {
			await step.do('release', () => hit('release'));
			return paid;
		}
		await step.sleep('cool down', '1 day');
		await step.do('ship', () => hit('ship'));
		return { reservationId: reservation.reservationId, amount: paid.amount };
	}
}

let flaky = { failures: 0, seen: 0 };

@Workflow.register({ name: 'flaky', retries: { limit: 2, delay: '1 minute', backoff: 'constant' } })
class Flaky extends Workflow<{ catchIt: boolean }, string> {
	public async run(params: { catchIt: boolean }, step: WorkflowStep): Promise<string> {
		try {
			return await step.do('call', ({ attempt }) => {
				flaky.seen = attempt;
				if (flaky.failures-- > 0) throw new Error(`boom ${attempt}`);
				return 'ok';
			});
		} catch (error) {
			if (!params.catchIt) throw error;
			return error instanceof WorkflowStepFailedError ? `caught after ${error.attempts}` : 'other';
		}
	}
}

@Workflow.register({ name: 'shapes' })
class Shapes extends Workflow<Record<string, never>, unknown> {
	public async run(_: Record<string, never>, step: WorkflowStep) {
		const date = await step.do('date', () => ({ at: new Date('2026-01-01T00:00:00Z') }));
		const items: number[] = [];
		for (let i = 0; i < 3; i++) items.push(await step.do('item', () => (hit('item'), i * 10)));
		const both = await Promise.all([
			step.do('left', () => (hit('left'), 'L')),
			step.do('right', () => (hit('right'), 'R'))
		]);
		await step.sleepUntil('past', '2000-01-01T00:00:00Z');
		return { date, items, both };
	}
}

@Module.register({ workflows: [FulfilOrder, Flaky, Shapes], services: [Inventory] })
class OrdersModule extends Module {}

describe('odysseus', () => {
	let app: TestingApp | undefined;
	let engine: EngineDriver;
	let store: MemoryWorkflowStore;

	const boot = async (options: { work?: boolean } = {}) => {
		store = new MemoryWorkflowStore();
		engine = Workflows.for('engine', { store, work: options.work ?? false }) as EngineDriver;
		app = await Application.testing({
			modules: [OdysseusModule.with({ driver: engine }), OrdersModule],
			boot: 'eager'
		});
	};

	beforeEach(() => {
		for (const key of Object.keys(calls)) delete calls[key];
		flaky = { failures: 0, seen: 0 };
		Clock.freeze('2026-11-01T00:00:00Z');
	});

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
		Clock.reset();
		Runtime.use(testRuntime);
	});

	it('runs an instance through a wait, a sleep and its steps, each step once', async () => {
		await boot();
		const started = await Odysseus.start(
			FulfilOrder,
			{ sku: 'mug', quantity: 2 },
			{ id: 'order-1' }
		);
		expect(started).toEqual({ workflow: 'orders.fulfil', id: 'order-1' });

		await engine.drain();
		expect((await Odysseus.status(FulfilOrder, 'order-1')) as { status: string }).toMatchObject({
			status: 'waiting'
		});

		expect(await Odysseus.signal(FulfilOrder, 'order-1', Paid, { amount: 1500 })).toBeUndefined();
		await engine.drain();
		expect(calls.ship).toBeUndefined();

		Clock.travel(DAY);
		await engine.drain();
		const status = await Odysseus.status(FulfilOrder, 'order-1');
		expect(status).toMatchObject({
			status: 'completed',
			output: { reservationId: 'res-mug', amount: 1500 }
		});
		expect(calls).toEqual({ reserve: 1, ship: 1 });
	});

	it('keeps an event sent before the instance waits for it', async () => {
		await boot();
		await Odysseus.start(FulfilOrder, { sku: 'mug', quantity: 1 }, { id: 'order-2' });
		await Odysseus.signal(FulfilOrder, 'order-2', Paid, { amount: 10 });
		await engine.drain();
		Clock.travel(DAY);
		await engine.drain();
		expect(await Odysseus.status(FulfilOrder, 'order-2')).toMatchObject({ status: 'completed' });
	});

	it('gives a WorkflowTimeoutError as a value when the event does not come in time', async () => {
		await boot();
		await Odysseus.start(FulfilOrder, { sku: 'mug', quantity: 1 }, { id: 'order-3' });
		await engine.drain();
		Clock.travel(2 * DAY);
		await engine.drain();
		const status = (await Odysseus.status(FulfilOrder, 'order-3')) as {
			output: unknown;
			status: string;
		};
		expect(status.status).toBe('completed');
		expect(status.output).toBeInstanceOf(WorkflowTimeoutError);
		expect(calls.release).toBe(1);
	});

	it('does not retry a step that returns a DomainError, and gives it back with its class', async () => {
		await boot();
		await Odysseus.start(FulfilOrder, { sku: 'sofa', quantity: 99 }, { id: 'order-4' });
		await engine.drain();
		const status = (await Odysseus.status(FulfilOrder, 'order-4')) as { output: unknown };
		expect(status.output).toBeInstanceOf(OutOfStock);
		expect((status.output as OutOfStock).extensions).toEqual({ sku: 'sofa' });
		expect(calls.reserve).toBe(1);
	});

	it('retries a step that throws, after its delay', async () => {
		await boot();
		flaky.failures = 2;
		await Odysseus.start(Flaky, { catchIt: false }, { id: 'f-1' });
		await engine.drain();
		expect(flaky.seen).toBe(1);
		Clock.travel(60_000);
		await engine.drain();
		Clock.travel(60_000);
		await engine.drain();
		expect(flaky.seen).toBe(3);
		expect(await Odysseus.status(Flaky, 'f-1')).toMatchObject({
			status: 'completed',
			output: 'ok'
		});
	});

	it('throws WorkflowStepFailedError into run() once the retries are spent', async () => {
		await boot();
		flaky.failures = 10;
		await Odysseus.start(Flaky, { catchIt: false }, { id: 'f-2' });
		await Odysseus.start(Flaky, { catchIt: true }, { id: 'f-3' });
		for (let i = 0; i < 3; i++) {
			await engine.drain();
			Clock.travel(60_000);
		}
		await engine.drain();
		expect(await Odysseus.status(Flaky, 'f-2')).toMatchObject({
			status: 'errored',
			error: { name: 'WorkflowStepFailedError' }
		});
		expect(await Odysseus.status(Flaky, 'f-3')).toMatchObject({
			status: 'completed',
			output: 'caught after 3'
		});
	});

	it('answers JSON copies, numbers repeated step names, and runs parallel steps', async () => {
		await boot();
		await Odysseus.start(Shapes, {}, { id: 's-1' });
		await engine.drain();
		expect(await Odysseus.status(Shapes, 's-1')).toMatchObject({
			status: 'completed',
			output: { date: { at: '2026-01-01T00:00:00.000Z' }, items: [0, 10, 20], both: ['L', 'R'] }
		});
		expect(calls).toEqual({ item: 3, left: 1, right: 1 });
	});

	it('starts an id once and checks ids and params', async () => {
		await boot();
		await Odysseus.start(Shapes, {}, { id: 'dup' });
		expect(await Odysseus.start(Shapes, {}, { id: 'dup' })).toBeInstanceOf(
			WorkflowAlreadyStartedError
		);
		expect(await Odysseus.start(Shapes, {}, { id: 'not valid!' })).toBeInstanceOf(
			ValidationFailedError
		);
		expect(
			await Odysseus.start(FulfilOrder, { sku: 'mug', quantity: 0 }, { id: 'bad-params' })
		).toBeInstanceOf(ValidationFailedError);
		const many = await Odysseus.startMany(Shapes, [
			{ id: 'm-1', params: {} },
			{ id: 'dup', params: {} },
			{ id: '-bad', params: {} }
		]);
		expect(many[0]).toEqual({ workflow: 'shapes', id: 'm-1' });
		expect(many[1]).toBeInstanceOf(WorkflowAlreadyStartedError);
		expect(many[2]).toBeInstanceOf(ValidationFailedError);
	});

	it('answers errors as values for signals, status and terminate', async () => {
		await boot();
		expect(await Odysseus.signal(FulfilOrder, 'nope', Paid, { amount: 1 })).toBeInstanceOf(
			WorkflowNotFoundError
		);
		expect(await Odysseus.status(FulfilOrder, 'nope')).toBeInstanceOf(WorkflowNotFoundError);
		expect(await Odysseus.terminate(FulfilOrder, 'nope')).toBeInstanceOf(WorkflowNotFoundError);

		await Odysseus.start(FulfilOrder, { sku: 'mug', quantity: 1 }, { id: 'order-5' });
		expect(
			await Odysseus.signal(FulfilOrder, 'order-5', Paid, { amount: 0 } as never)
		).toBeInstanceOf(ValidationFailedError);
		await engine.drain();
		expect(await Odysseus.terminate(FulfilOrder, 'order-5')).toBeUndefined();
		expect(await Odysseus.status(FulfilOrder, 'order-5')).toMatchObject({ status: 'terminated' });
		expect(await Odysseus.terminate(FulfilOrder, 'order-5')).toBeInstanceOf(WorkflowFinishedError);
		expect(await Odysseus.signal(FulfilOrder, 'order-5', Paid, { amount: 1 })).toBeInstanceOf(
			WorkflowFinishedError
		);
		Clock.travel(3 * DAY);
		await engine.drain();
		expect(calls.release).toBeUndefined();
	});

	it('runs instances on its own when the worker is on', async () => {
		await boot({ work: true });
		await Odysseus.start(Shapes, {}, { id: 'auto' });
		for (let i = 0; i < 50; i++) {
			const status = (await Odysseus.status(Shapes, 'auto')) as { status: string };
			if (status.status === 'completed') break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(await Odysseus.status(Shapes, 'auto')).toMatchObject({ status: 'completed' });
	});

	it('lets one worker at a time run an instance', async () => {
		await boot();
		const now = Clock.epochMs();
		await store.create({
			workflow: 'shapes',
			id: 'lease',
			params: {},
			status: 'queued',
			wakeAt: now,
			createdAt: now,
			updatedAt: now
		});
		expect(
			await store.claim('shapes', 'lease', { owner: 'a', until: now + 1000 }, now)
		).not.toBeNull();
		expect(await store.claim('shapes', 'lease', { owner: 'b', until: now + 1000 }, now)).toBeNull();
		expect(await store.saveStep('shapes', 'lease', 'b', 'x', { kind: 'done', value: 1 })).toBe(
			false
		);
		expect(
			await store.claim('shapes', 'lease', { owner: 'b', until: now + 3000 }, now + 1000)
		).not.toBeNull();
		expect(await store.saveStep('shapes', 'lease', 'a', 'x', { kind: 'done', value: 1 })).toBe(
			false
		);
	});

	it('refuses workflows outside OdysseusModule or not listed by a module', async () => {
		expect(() => Odysseus.definition(Shapes)).toThrow(UnregisteredWorkflowError);
		@Workflow.register({ name: 'stray' })
		class Stray extends Workflow {
			public async run() {}
		}
		await boot();
		expect(() => Odysseus.definition(Stray)).toThrow(UnregisteredWorkflowError);
		expect(() => Workflow.register({ name: 'Bad Name' })).toThrow(InvalidWorkflowError);
		await app!.shutdown();
		app = await Application.testing({ modules: [OrdersModule], boot: 'eager' });
		expect(Odysseus.start(Shapes, {}, { id: 'x' })).rejects.toThrow();
	});

	it('refuses to run the engine on Cloudflare Workers', async () => {
		Runtime.use({ ...testRuntime, name: 'workers' });
		const driver = Workflows.for('engine', { store: WorkflowStore.for('memory') });
		expect(
			driver.open!({ run: async () => undefined, definition: () => undefined })
		).rejects.toThrow(WorkflowDriverUnavailableError);
	});

	it('names the missing module', () => {
		expect(new OdysseusNotConfiguredError().message).toContain('OdysseusModule');
	});
});
