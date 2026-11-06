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

import type {
	WorkersExecutionContext,
	WorkersKVNamespace,
	WorkersMessageBatch,
	WorkersScheduledController
} from '../src';

import {
	Application,
	Http,
	HttpControllerScope,
	Module,
	ScopeMismatchError,
	Service,
	ServiceScope
} from '@elysiumjs/core';
import { beforeEach, describe, expect, it } from 'bun:test';

import {
	BindingNotFoundError,
	createRuntime,
	createWorker,
	KeyvWorkersKV,
	NoWorkersHandlerError,
	OutsideInvocationError,
	runInvocation,
	Workers,
	WORKERS_CONTEXT_SERVICE,
	WorkersModule
} from '../src';

/** An in-memory KV namespace, recording the TTLs it is given. */
export const memoryKV = () => {
	const data = new Map<string, string>();
	const ttls = new Map<string, number | undefined>();
	const kv: WorkersKVNamespace = {
		get: async (key) => data.get(key) ?? null,
		put: async (key, value, options) => {
			data.set(key, value);
			ttls.set(key, options?.expirationTtl);
		},
		delete: async (key) => {
			data.delete(key);
		},
		list: async ({ prefix = '', cursor } = {}) => {
			const keys = [...data.keys()].filter((key) => key.startsWith(prefix)).sort();
			const start = cursor ? Number(cursor) : 0;
			const page = keys.slice(start, start + 2);
			const done = start + 2 >= keys.length;
			return {
				keys: page.map((name) => ({ name })),
				list_complete: done,
				cursor: done ? undefined : String(start + 2)
			};
		}
	};
	return { kv, data, ttls };
};

const ctx = (): WorkersExecutionContext & { waited: Promise<unknown>[] } => {
	const waited: Promise<unknown>[] = [];
	return { waited, waitUntil: (p) => void waited.push(p), passThroughOnException() {} };
};

const batch = (queue: string, bodies: unknown[]): WorkersMessageBatch => ({
	queue,
	messages: bodies.map((body, i) => ({
		id: String(i),
		timestamp: new Date(0),
		body,
		attempts: 1,
		ack() {},
		retry() {}
	})),
	ackAll() {},
	retryAll() {}
});

const scheduled = (cron: string): WorkersScheduledController => ({
	scheduledTime: 0,
	cron,
	noRetry() {}
});

const runtime = createRuntime({ env: {} });

describe('Workers', () => {
	it('reads the env, context and bindings of the current invocation only', () => {
		expect(() => Workers.env()).toThrow(OutsideInvocationError);
		expect(() => Workers.context()).toThrow(OutsideInvocationError);

		const context = ctx();
		runInvocation({ env: { CACHE: 'kv', NAME: 'x' }, ctx: context }, () => {
			expect(Workers.env()).toEqual({ CACHE: 'kv', NAME: 'x' });
			expect(Workers.context()).toBe(context);
			expect(Workers.binding('CACHE')).toBe('kv');
			expect(() => Workers.binding('MISSING')).toThrow(BindingNotFoundError);
		});
	});

	it('refuses handler decorators on static methods', () => {
		expect(() => {
			class Jobs {
				@Workers.queue('jobs')
				public static run() {}
			}
			return Jobs;
		}).toThrow(TypeError);
	});
});

describe('createWorker', () => {
	beforeEach(() => Service.clear());

	const build = async () => {
		const received: string[] = [];

		@Service.register({ scope: ServiceScope.REQUEST })
		class Greeter {
			constructor(@Workers.inject('GREETING') public readonly greeting: string) {}
		}

		@Service.register()
		class Jobs {
			@Workers.queue('emails')
			public async send(batch: WorkersMessageBatch<{ to: string }>) {
				for (const message of batch.messages) received.push(`email:${message.body.to}`);
			}

			@Workers.queue('*')
			public async audit(batch: WorkersMessageBatch) {
				received.push(`audit:${batch.queue}:${Workers.binding<string>('GREETING')}`);
			}

			@Workers.cron('*/5 * * * *')
			public async sweep(controller: WorkersScheduledController) {
				received.push(`cron:${controller.cron}`);
				const context = await Service.resolve<WorkersExecutionContext>(WORKERS_CONTEXT_SERVICE);
				context.waitUntil(Promise.resolve('swept'));
			}
		}

		@Http.controller({ path: '/greet', scope: HttpControllerScope.REQUEST })
		class GreetController {
			constructor(@Service.inject(Greeter) private readonly greeter: Greeter) {}

			@Http.get()
			public greet() {
				return { greeting: this.greeter.greeting, name: Workers.env<{ NAME: string }>().NAME };
			}
		}

		@Module.register({ services: [Greeter, Jobs], controllers: [GreetController] })
		class AppModule extends Module {}

		@Application.register({
			runtime,
			modules: [WorkersModule.with({ bindings: ['GREETING'] }), AppModule],
			openapi: false
		})
		class App extends Application {}

		const app = new App();
		return { app, received, worker: await createWorker(app) };
	};

	it('serves requests with the bindings of each one', async () => {
		const { app, worker } = await build();
		const [hello, bonjour] = await Promise.all([
			worker.fetch(new Request('http://localhost/greet'), { GREETING: 'hello', NAME: 'a' }, ctx()),
			worker.fetch(new Request('http://localhost/greet'), { GREETING: 'bonjour', NAME: 'b' }, ctx())
		]);
		expect(await hello.json()).toEqual({ greeting: 'hello', name: 'a' });
		expect(await bonjour.json()).toEqual({ greeting: 'bonjour', name: 'b' });
		await app.kernel.shutdown();
	});

	it('hands queue batches to the matching consumers', async () => {
		const { app, received, worker } = await build();
		await worker.queue(batch('emails', [{ to: 'ada' }, { to: 'alan' }]), { GREETING: 'hi' }, ctx());
		await worker.queue(batch('other', []), { GREETING: 'yo' }, ctx());
		expect(received).toEqual(['email:ada', 'email:alan', 'audit:emails:hi', 'audit:other:yo']);
		await app.kernel.shutdown();
	});

	it('calls the cron handlers, with the invocation context', async () => {
		const { app, received, worker } = await build();
		const context = ctx();
		await worker.scheduled(scheduled('*/5 * * * *'), {}, context);
		expect(received).toEqual(['cron:*/5 * * * *']);
		expect(await Promise.all(context.waited)).toEqual(['swept']);

		expect(worker.scheduled(scheduled('0 0 * * *'), {}, ctx())).rejects.toThrow(
			NoWorkersHandlerError
		);
		await app.kernel.shutdown();
	});

	it('destroys request-scoped services through waitUntil once the body is read', async () => {
		const destroyed: string[] = [];

		@Service.register({ scope: ServiceScope.REQUEST })
		class Scratch {
			public onDestroy() {
				destroyed.push('Scratch');
			}
		}

		@Http.controller({ path: '/scratch' })
		class ScratchController {
			@Http.get()
			public show(@Service.inject(Scratch) scratch: Scratch) {
				return { ok: !!scratch };
			}
		}

		@Module.register({ services: [Scratch], controllers: [ScratchController] })
		class ScratchModule extends Module {}

		@Application.register({ runtime, modules: [ScratchModule], openapi: false })
		class ScratchApp extends Application {}

		const app = new ScratchApp();
		const worker = await createWorker(app);
		const context = ctx();
		const response = await worker.fetch(new Request('http://localhost/scratch'), {}, context);
		expect(response.status).toBe(200);
		expect(context.waited.length).toBeGreaterThan(0);
		expect(await response.json()).toEqual({ ok: true });
		await Promise.all(context.waited);
		expect(destroyed).toEqual(['Scratch']);
		await app.kernel.shutdown();
	});

	it('fails a batch no service consumes', async () => {
		@Module.register({})
		class EmptyModule extends Module {}

		@Application.register({ runtime, modules: [EmptyModule], openapi: false })
		class EmptyApp extends Application {}

		const app = new EmptyApp();
		const worker = await createWorker(app);
		expect(worker.queue(batch('emails', []), {}, ctx())).rejects.toThrow(NoWorkersHandlerError);
		await app.kernel.shutdown();
	});

	const trackedBatch = (queue: string, count: number) => {
		const acked: string[] = [];
		const retried: string[] = [];
		const messages = Array.from({ length: count }, (_, i) => ({
			id: String(i + 1),
			timestamp: new Date(0),
			body: i + 1,
			attempts: 1,
			ack: () => void acked.push(String(i + 1)),
			retry: () => void retried.push(String(i + 1))
		}));
		const value: WorkersMessageBatch = { queue, messages, ackAll() {}, retryAll() {} };
		return { value, acked, retried };
	};

	const appWith = async (services: any[]) => {
		@Module.register({ services })
		class QueueModule extends Module {}

		@Application.register({
			runtime,
			modules: [WorkersModule.with({}), QueueModule],
			openapi: false
		})
		class QueueApp extends Application {}

		const app = new QueueApp();
		return { app, worker: await createWorker(app) };
	};

	it('acks the good messages and retries only the failing one', async () => {
		@Service.register()
		class Jobs {
			@Workers.queue('jobs', { each: true })
			public run(message: { body: number }) {
				if (message.body === 2) throw new Error('boom');
			}
		}
		const { app, worker } = await appWith([Jobs]);
		const { value, acked, retried } = trackedBatch('jobs', 3);
		await worker.queue(value, {}, ctx());
		expect(acked).toEqual(['1', '3']);
		expect(retried).toEqual(['2']);
		await app.kernel.shutdown();
	});

	it('does not rerun a succeeding handler when another fails', async () => {
		const audited: number[] = [];

		@Service.register()
		class Jobs {
			@Workers.queue('*', { each: true })
			public audit(message: { body: number }) {
				audited.push(message.body);
			}

			@Workers.queue('jobs', { each: true })
			public run(message: { body: number }) {
				if (message.body === 1) throw new Error('boom');
			}
		}
		const { app, worker } = await appWith([Jobs]);
		const { value, acked, retried } = trackedBatch('jobs', 2);
		await worker.queue(value, {}, ctx());
		expect(audited).toEqual([1, 2]);
		expect(acked).toEqual(['2']);
		expect(retried).toEqual(['1']);
		await app.kernel.shutdown();
	});

	it('retries every message when a batch handler throws', async () => {
		@Service.register()
		class Jobs {
			@Workers.queue('jobs')
			public run() {
				throw new Error('boom');
			}
		}
		const { app, worker } = await appWith([Jobs]);
		const { value, acked, retried } = trackedBatch('jobs', 2);
		await worker.queue(value, {}, ctx());
		expect(acked).toEqual([]);
		expect(retried).toEqual(['1', '2']);
		await app.kernel.shutdown();
	});

	it('keeps bindings out of singletons', async () => {
		@Service.register()
		class Captive {
			constructor(@Workers.inject('GREETING') public readonly greeting: string) {}

			@Workers.queue('jobs')
			public run() {}
		}

		@Module.register({ services: [Captive] })
		class CaptiveModule extends Module {}

		@Application.register({
			runtime,
			modules: [WorkersModule.with({ bindings: ['GREETING'] }), CaptiveModule],
			openapi: false
		})
		class CaptiveApp extends Application {}

		const app = new CaptiveApp();
		const worker = await createWorker(app);
		expect(worker.queue(batch('jobs', []), { GREETING: 'x' }, ctx())).rejects.toThrow(
			ScopeMismatchError
		);
		await app.kernel.shutdown();
	});
});

describe('KeyvWorkersKV', () => {
	const inInvocation = <T>(kv: WorkersKVNamespace, fn: () => Promise<T>) =>
		runInvocation({ env: { CACHE: kv }, ctx: ctx() }, fn);

	it('stores namespaced entries, with TTLs of at least 60 seconds', async () => {
		const { kv, data, ttls } = memoryKV();
		const store = new KeyvWorkersKV({ binding: 'CACHE', namespace: 'cache' });

		await inInvocation(kv, async () => {
			await store.set('a', 'one', 1500);
			await store.setMany([
				{ key: 'b', value: 'two', ttl: 120_000 },
				{ key: 'c', value: 'three' }
			]);
			expect(await store.get('a')).toBe('one');
			expect(await store.getMany(['a', 'missing'])).toEqual(['one', undefined]);
			expect(await store.has('b')).toBe(true);
			expect(await store.delete('b')).toBe(true);
			expect(await store.delete('b')).toBe(false);
			expect(await store.deleteMany(['a', 'zzz'])).toBe(true);
		});

		expect([...data.keys()]).toEqual(['cache::c']);
		expect(ttls.get('cache::a')).toBe(60);
		expect(ttls.get('cache::b')).toBe(120);
		expect(ttls.get('cache::c')).toBeUndefined();
		expect(store.opts).toMatchObject({
			dialect: 'workers-kv',
			binding: 'CACHE',
			namespace: 'cache'
		});
	});

	it('clears only its namespace, page by page', async () => {
		const { kv, data } = memoryKV();
		const store = new KeyvWorkersKV({ binding: 'CACHE', namespace: 'tags' });
		await inInvocation(kv, async () => {
			for (const key of ['1', '2', '3', '4', '5']) await store.set(key, key);
			await kv.put('other::1', 'x');
			await store.clear();
		});
		expect([...data.keys()]).toEqual(['other::1']);

		const all = new KeyvWorkersKV({ binding: 'CACHE' });
		await inInvocation(kv, async () => {
			await all.set('k', 'v');
			await all.clear();
		});
		expect(data.size).toBe(0);
	});

	it('clear() deletes in chunks of 50', async () => {
		const { kv, data } = memoryKV();
		let inFlight = 0;
		let maxInFlight = 0;
		const slow: WorkersKVNamespace = {
			...kv,
			delete: async (key) => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 1));
				await kv.delete(key);
				inFlight--;
			}
		};
		for (let i = 0; i < 120; i++) await kv.put(`k${i}`, 'v');
		const store = new KeyvWorkersKV({ binding: 'CACHE' });
		await inInvocation(slow, () => store.clear());
		expect(data.size).toBe(0);
		expect(maxInFlight).toBeLessThanOrEqual(50);
		expect(maxInFlight).toBeGreaterThan(1);
	});

	it('needs an invocation, so it holds no binding', () => {
		const store = new KeyvWorkersKV({ binding: 'CACHE' });
		expect(store.on('error', () => {})).toBe(store);
		expect(store.get('k')).rejects.toThrow(OutsideInvocationError);
	});
});
