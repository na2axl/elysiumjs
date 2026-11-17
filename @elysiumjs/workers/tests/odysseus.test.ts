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

import type { WorkflowStep } from '@elysiumjs/olympus/odysseus';
import type {
	CloudflareStepLike,
	WorkersExecutionContext,
	WorkflowBindingLike,
	WorkflowInstanceLike,
	WorkflowRunnerPayload
} from '../src';

import { Application, DomainError, Module, Serializable, t } from '@elysiumjs/olympus';
import {
	Odysseus,
	OdysseusModule,
	Workflow,
	WorkflowAlreadyStartedError,
	WorkflowEvent,
	WorkflowFinishedError,
	WorkflowNotFoundError,
	Workflows,
	WorkflowStepFailedError,
	WorkflowTimeoutError
} from '@elysiumjs/olympus/odysseus';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
	adaptSteps,
	CloudflareWorkflowDriver,
	runInvocation,
	runWorkflow,
	useWorkflowApplication,
	WorkflowApplicationMissingError,
	WorkflowBindingConflictError,
	WorkflowCreateError,
	WorkflowPayloadError
} from '../src';

type FakeInstance = {
	id: string;
	payload: WorkflowRunnerPayload;
	status: string;
	output?: unknown;
	error?: { name: string; message: string };
	events: { type: string; payload: unknown }[];
};

/** A Cloudflare Workflow binding in memory; `run(id)` runs an instance through to its end. */
const fakeWorkflows = () => {
	const instances = new Map<string, FakeInstance>();
	const configs: { name: string; config: unknown }[] = [];
	let refuse: string | undefined;
	const handle = (instance: FakeInstance): WorkflowInstanceLike => ({
		id: instance.id,
		status: async () => ({
			status: instance.status as never,
			output: instance.output,
			error: instance.error
		}),
		sendEvent: async (event) => {
			if (['complete', 'errored', 'terminated'].includes(instance.status)) {
				throw new Error('instance is not running');
			}
			instance.events.push(event);
		},
		terminate: async () => {
			if (['complete', 'errored', 'terminated'].includes(instance.status)) {
				throw new Error('instance is finished');
			}
			instance.status = 'terminated';
		}
	});
	const binding: WorkflowBindingLike = {
		createBatch: async ({ instances: requested }) => {
			const created: { id: string }[] = [];
			const errors: { index: number; id?: string; code: number; message: string }[] = [];
			requested.forEach((request, index) => {
				if (refuse) errors.push({ index, id: request.id, code: 10001, message: refuse });
				else if (instances.has(request.id)) {
					errors.push({ index, id: request.id, code: 10405, message: 'exists' });
				} else {
					instances.set(request.id, {
						id: request.id,
						payload: request.params as WorkflowRunnerPayload,
						status: 'queued',
						events: []
					});
					created.push({ id: request.id });
				}
			});
			return { created, errors };
		},
		get: async (id) => {
			const instance = instances.get(id);
			if (!instance) throw new Error(`instance ${id} not found`);
			return handle(instance);
		}
	};
	const step = (instance: FakeInstance): CloudflareStepLike => ({
		do: async (name, config, callback) => {
			configs.push({ name, config });
			const limit = config.retries?.limit ?? 5;
			let last: unknown;
			for (let attempt = 1; attempt <= limit + 1; attempt++) {
				try {
					return structuredClone(await callback({ attempt }));
				} catch (error) {
					last = error;
				}
			}
			throw last;
		},
		sleep: async () => {},
		sleepUntil: async () => {},
		waitForEvent: async (_name, { type }) => {
			const index = instance.events.findIndex((event) => event.type === type);
			if (index === -1) throw new Error('waitForEvent timed out');
			const [event] = instance.events.splice(index, 1);
			return { payload: event!.payload as never, timestamp: new Date(), type };
		}
	});
	const run = async (env: Record<string, unknown>, id: string) => {
		const instance = instances.get(id)!;
		instance.status = 'running';
		try {
			instance.output = await runWorkflow(env, ctx, instance.payload, step(instance));
			instance.status = 'complete';
		} catch (error) {
			instance.status = 'errored';
			instance.error = { name: (error as Error).name, message: (error as Error).message };
		}
	};
	return {
		binding,
		instances,
		configs,
		run,
		refuse: (message: string | undefined) => (refuse = message)
	};
};

const ctx: WorkersExecutionContext = { waitUntil: () => {}, passThroughOnException: () => {} };

@Serializable({ name: 'shop.declined' })
class Declined extends DomainError.for('PAYMENT_DECLINED', 402) {}

const Paid = WorkflowEvent.define('paid', t.Object({ amount: t.Integer() }));
let attempts = 0;

@Workflow.register({ name: 'shop.order', errors: [Declined] })
class Order extends Workflow<{ sku: string; decline?: boolean }, unknown> {
	public async run(params: { sku: string; decline?: boolean }, step: WorkflowStep) {
		const charge = await step.do('charge', { retries: { limit: 2, delay: '1 second' } }, () =>
			params.decline ? new Declined('Declined.') : { at: new Date('2026-01-01T00:00:00Z') }
		);
		if (charge instanceof Declined) return charge;
		const paid = await step.waitFor('paid', Paid, { timeout: '1 day' });
		if (paid instanceof WorkflowTimeoutError) return 'timed out';
		await step.sleep('cool down', '1 hour');
		return { sku: params.sku, amount: paid.amount, at: charge.at };
	}
}

@Workflow.register({ name: 'shop.flaky', driver: { binding: 'FLAKY' } })
class Flaky extends Workflow<Record<string, never>, string> {
	public async run(_: Record<string, never>, step: WorkflowStep) {
		try {
			await step.do('call', { retries: { limit: 1, delay: 0 } }, () => {
				attempts += 1;
				throw new Error('down');
			});
			return 'ok';
		} catch (error) {
			return error instanceof WorkflowStepFailedError ? `failed after ${error.attempts}` : 'other';
		}
	}
}

@Module.register({ workflows: [Order, Flaky] })
class ShopModule extends Module {}

describe('cloudflare workflow driver', () => {
	let app: Awaited<ReturnType<typeof Application.testing>> | undefined;
	let shared: ReturnType<typeof fakeWorkflows>;
	let flaky: ReturnType<typeof fakeWorkflows>;
	let env: Record<string, unknown>;
	const inWorker = <T>(fn: () => T) => runInvocation({ env, ctx }, fn);

	beforeEach(async () => {
		attempts = 0;
		shared = fakeWorkflows();
		flaky = fakeWorkflows();
		env = { WORKFLOWS: shared.binding, FLAKY: flaky.binding };
		app = await Application.testing({
			modules: [OdysseusModule.with({ driver: () => Workflows.for('cloudflare') }), ShopModule],
			boot: 'eager'
		});
		// The testing app is booted already; the runner only boots it.
		useWorkflowApplication({ boot: async () => {} } as never);
	});

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('starts instances on the shared binding, under ids prefixed by the workflow', async () => {
		const ref = await inWorker(() => Odysseus.start(Order, { sku: 'mug' }, { id: 'o-1' }));
		expect(ref).toMatchObject({ id: 'o-1' });
		const [instance] = [...shared.instances.values()];
		expect(instance!.id).toMatch(/^[0-9a-f]{8}_o-1$/);
		expect(instance!.payload).toEqual({ workflow: 'shop.order', params: { sku: 'mug' } });
		expect(
			await inWorker(() => Odysseus.start(Order, { sku: 'mug' }, { id: 'o-1' }))
		).toBeInstanceOf(WorkflowAlreadyStartedError);
		expect(await inWorker(() => Odysseus.status(Order, 'o-1'))).toMatchObject({ status: 'queued' });
	});

	it('runs a workflow with its steps, events and values', async () => {
		await inWorker(() => Odysseus.start(Order, { sku: 'mug' }, { id: 'o-1' }));
		expect(
			await inWorker(() => Odysseus.signal(Order, 'o-1', Paid, { amount: 1500 }))
		).toBeUndefined();
		const id = [...shared.instances.keys()][0]!;
		await shared.run(env, id);
		expect(await inWorker(() => Odysseus.status(Order, 'o-1'))).toMatchObject({
			status: 'completed',
			output: { sku: 'mug', amount: 1500, at: new Date('2026-01-01T00:00:00Z') }
		});
		expect(shared.configs[0]).toEqual({
			name: 'charge',
			config: { retries: { limit: 2, delay: 1000, backoff: 'exponential' }, timeout: 600_000 }
		});
		expect(await inWorker(() => Odysseus.signal(Order, 'o-1', Paid, { amount: 1 }))).toBeInstanceOf(
			WorkflowFinishedError
		);
		expect(await inWorker(() => Odysseus.terminate(Order, 'o-1'))).toBeInstanceOf(
			WorkflowFinishedError
		);
	});

	it('gives DomainErrors and timeouts back as values', async () => {
		await inWorker(() => Odysseus.start(Order, { sku: 'mug', decline: true }, { id: 'declined' }));
		await inWorker(() => Odysseus.start(Order, { sku: 'mug' }, { id: 'late' }));
		for (const id of shared.instances.keys()) await shared.run(env, id);
		const declined = (await inWorker(() => Odysseus.status(Order, 'declined'))) as {
			output: unknown;
		};
		expect(declined.output).toBeInstanceOf(Declined);
		expect(await inWorker(() => Odysseus.status(Order, 'late'))).toMatchObject({
			output: 'timed out'
		});
	});

	it('uses the binding of a workflow, with the ids as given, and throws step failures', async () => {
		await inWorker(() => Odysseus.start(Flaky, {}, { id: 'f-1' }));
		expect([...flaky.instances.keys()]).toEqual(['f-1']);
		expect(shared.instances.size).toBe(0);
		await flaky.run(env, 'f-1');
		expect(attempts).toBe(2);
		expect(await inWorker(() => Odysseus.status(Flaky, 'f-1'))).toMatchObject({
			status: 'completed',
			output: 'failed after 2'
		});
	});

	it('answers missing instances, terminates, and reports refused starts', async () => {
		expect(await inWorker(() => Odysseus.status(Order, 'nope'))).toBeInstanceOf(
			WorkflowNotFoundError
		);
		expect(
			await inWorker(() => Odysseus.signal(Order, 'nope', Paid, { amount: 1 }))
		).toBeInstanceOf(WorkflowNotFoundError);
		await inWorker(() => Odysseus.start(Order, { sku: 'mug' }, { id: 'stop' }));
		expect(await inWorker(() => Odysseus.terminate(Order, 'stop'))).toBeUndefined();
		expect(await inWorker(() => Odysseus.status(Order, 'stop'))).toMatchObject({
			status: 'terminated'
		});
		shared.refuse('rate limited');
		expect(inWorker(() => Odysseus.start(Order, { sku: 'mug' }, { id: 'x' }))).rejects.toThrow(
			WorkflowCreateError
		);
	});

	it('names the ids of the shared binding by a stable hash', () => {
		const driver = new CloudflareWorkflowDriver();
		expect(driver.instanceId('shop.order', 'a')).toBe(driver.instanceId('shop.order', 'a'));
		expect(driver.instanceId('shop.order', 'a')).not.toBe(driver.instanceId('shop.other', 'a'));
		expect(driver.instanceId('shop.order', 'x'.repeat(90)).length).toBeLessThanOrEqual(100);
	});

	it('runs instances through WorkflowRunner, the class of the bindings', async () => {
		mock.module('cloudflare:workers', () => ({
			DurableObject: class {
				constructor(
					protected ctx: unknown,
					protected env: unknown
				) {}
			},
			WorkflowEntrypoint: class {
				constructor(
					protected ctx: unknown,
					protected env: unknown
				) {}
			}
		}));
		const { WorkflowRunner } = await import('../src/durable-objects');
		await inWorker(() => Odysseus.start(Flaky, {}, { id: 'f-2' }));
		const instance = flaky.instances.get('f-2')!;
		const runner = new WorkflowRunner(ctx, env);
		const steps = {
			do: async () => {
				throw new Error('down');
			}
		} as unknown as CloudflareStepLike;
		expect(await runner.run({ payload: instance.payload }, steps)).toBe('failed after 2');
	});

	it('refuses to run without an application', async () => {
		useWorkflowApplication(undefined as never);
		expect(
			runWorkflow(env, ctx, { workflow: 'shop.order', params: {} }, {} as CloudflareStepLike)
		).rejects.toThrow(WorkflowApplicationMissingError);
	});

	it('refuses a payload the driver did not create', async () => {
		expect(runWorkflow(env, ctx, null as never, {} as CloudflareStepLike)).rejects.toThrow(
			WorkflowPayloadError
		);
		expect(runWorkflow(env, ctx, {} as never, {} as CloudflareStepLike)).rejects.toThrow(
			WorkflowPayloadError
		);
	});

	it('refuses workflows that would share the ids of a binding', () => {
		const host = (props: Record<string, Record<string, unknown> | undefined>) =>
			({
				workflows: () => Object.keys(props),
				definition: (name: string) => ({ driver: props[name] })
			}) as never;
		const driver = new CloudflareWorkflowDriver();
		expect(() => driver.open(host({ a: { binding: 'PAY' }, b: { binding: 'PAY' } }))).toThrow(
			WorkflowBindingConflictError
		);
		expect(() => driver.open(host({ a: undefined, b: { binding: 'WORKFLOWS' } }))).toThrow(
			WorkflowBindingConflictError
		);
		expect(() => driver.open(host({ a: { binding: 'WORKFLOWS' }, b: undefined }))).toThrow(
			WorkflowBindingConflictError
		);
		expect(() =>
			driver.open(host({ a: undefined, b: undefined, c: { binding: 'PAY' } }))
		).not.toThrow();
	});

	it('tells which instances started when Cloudflare refuses a later batch', async () => {
		let calls = 0;
		const real = shared.binding.createBatch;
		shared.binding.createBatch = async (options) => {
			calls += 1;
			if (calls === 2) throw new Error('rate limited');
			return real(options);
		};
		const requests = Array.from({ length: 150 }, (_, i) => ({
			params: { sku: `s${i}` },
			id: `b-${i}`
		}));
		const error = await inWorker(() => Odysseus.startMany(Order, requests)).catch((e) => e);
		expect(error).toBeInstanceOf(WorkflowCreateError);
		expect((error as WorkflowCreateError).started.filter(Boolean).length).toBe(100);
	});

	describe('steps', () => {
		const definition = {} as never;
		const fake = (overrides: Partial<CloudflareStepLike> = {}) => {
			const calls: { kind: string; args: unknown[] }[] = [];
			const step: CloudflareStepLike = {
				do: async (_name, config, callback) => {
					let last: unknown;
					for (let attempt = 1; attempt <= (config.retries?.limit ?? 5) + 1; attempt++) {
						try {
							return await callback({ attempt });
						} catch (error) {
							last = error;
						}
					}
					throw last;
				},
				sleep: async (...args) => void calls.push({ kind: 'sleep', args }),
				sleepUntil: async (...args) => void calls.push({ kind: 'sleepUntil', args }),
				waitForEvent: async (...args) => {
					calls.push({ kind: 'wait', args });
					throw new Error('timed out');
				},
				...overrides
			};
			return { step: adaptSteps(step, definition), calls };
		};

		it('fails a step whose value cannot be kept, without a retry', async () => {
			const { step } = fake();
			let runs = 0;
			const error = await step
				.do('big', { retries: { limit: 3, delay: 0 } }, () => {
					runs += 1;
					return { later: () => 1 } as never;
				})
				.catch((e) => e);
			expect(runs).toBe(1);
			expect(error).toBeInstanceOf(WorkflowStepFailedError);
			expect((error as WorkflowStepFailedError).attempts).toBe(1);
		});

		it('counts the attempts the work made, and lets other failures through', async () => {
			const { step } = fake({
				do: async (_name, _config, callback) => {
					try {
						return await callback({ attempt: 1 });
					} catch {
						return callback({ attempt: 2 });
					}
				}
			});
			const error = await step
				.do('call', { retries: { limit: 5, delay: 0 } }, () => {
					throw new Error('down');
				})
				.catch((e) => e);
			expect((error as WorkflowStepFailedError).attempts).toBe(2);

			const limit = new Error('step output is too large');
			const { step: over } = fake({
				do: async (_name, _config, callback) => {
					await callback({ attempt: 1 });
					throw limit;
				}
			});
			expect(await over.do('big', () => 'x').catch((e) => e)).toBe(limit);
		});

		it('checks names, sleeps and waits as the engine does', async () => {
			const { step, calls } = fake();
			expect(step.do('', () => 1)).rejects.toThrow('1 to 256 characters');
			expect(step.sleep('x'.repeat(300), '1 second')).rejects.toThrow('1 to 256 characters');
			expect(step.sleepUntil('far', Date.now() + 400 * 86_400_000)).rejects.toThrow('365 days');
			expect(await step.waitFor('quick', Paid, { timeout: 10 })).toBeInstanceOf(
				WorkflowTimeoutError
			);
			expect(calls.at(-1)).toEqual({
				kind: 'wait',
				args: ['quick', { type: 'paid', timeout: 1000 }]
			});
		});
	});
});
