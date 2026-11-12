// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { LifecycleEvent } from '../src/lifecycle';

import { afterEach, describe, expect, it } from 'bun:test';

import { LifecycleListenerNotSupportedError } from '../src/errors';
import { Lifecycle, LifecycleBus } from '../src/lifecycle';
import { Module } from '../src/module';
import { Service } from '../src/service';
import { createTestingApp } from '../src/testing';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('module-scoped @Lifecycle listeners', () => {
	let app: Awaited<ReturnType<typeof createTestingApp>> | undefined;

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('adds no listener when a class with @Lifecycle.on is declared', () => {
		const before = LifecycleBus.instance.listenerCount('el:import');

		class Declared {
			@Lifecycle.on('el:import')
			public static handle() {}
		}

		expect(Declared).toBeDefined();
		expect(LifecycleBus.instance.listenerCount('el:import')).toBe(before);
	});

	it('wires a static listener when the module initialises, and removes it on shutdown', async () => {
		const calls: unknown[] = [];

		class Listener {
			@Lifecycle.on('el:static')
			public static handle(e: LifecycleEvent<string>) {
				calls.push(e.data);
			}
		}

		@Module.register({ controllers: [Listener] })
		class M extends Module {}

		app = await createTestingApp({ modules: [M], boot: 'eager' });
		expect(LifecycleBus.instance.listenerCount('el:static')).toBe(1);
		Lifecycle.emit('el:static', 'a');
		await tick();
		expect(calls).toEqual(['a']);

		await app.shutdown();
		app = undefined;
		expect(LifecycleBus.instance.listenerCount('el:static')).toBe(0);
		Lifecycle.emit('el:static', 'b');
		await tick();
		expect(calls).toEqual(['a']);
	});

	it('does not double-register across two boot/shutdown cycles', async () => {
		class Listener {
			@Lifecycle.on('el:cycle')
			public static handle() {}
		}

		@Module.register({ controllers: [Listener] })
		class M extends Module {}

		for (let i = 0; i < 2; i++) {
			const booted = await createTestingApp({ modules: [M], boot: 'eager' });
			await booted.kernel.initModule(booted.kernel.graph.nodes[0]);
			expect(LifecycleBus.instance.listenerCount('el:cycle')).toBe(1);
			await booted.shutdown();
			expect(LifecycleBus.instance.listenerCount('el:cycle')).toBe(0);
		}
	});

	it('runs an instance listener on the singleton service, in the module context', async () => {
		const seen: unknown[] = [];
		const receivers: unknown[] = [];

		@Service.register({ name: 'el.peer' })
		class Peer {}

		@Service.register({ name: 'el.listener' })
		class Listener {
			@Lifecycle.on('el:instance')
			public handle() {
				receivers.push(this);
				seen.push(Service.get('el.peer'));
			}
		}

		@Module.register({ services: [Peer, Listener] })
		class M extends Module {}

		app = await createTestingApp({ modules: [M], boot: 'eager' });
		Lifecycle.emit('el:instance', {});
		Lifecycle.emit('el:instance', {});
		await tick();

		expect(receivers).toHaveLength(2);
		expect(receivers[0]).toBeInstanceOf(Listener);
		expect(receivers[1]).toBe(receivers[0]);
		expect(seen[0]).toBeInstanceOf(Peer);
	});

	it('honours once and prepend', async () => {
		const order: string[] = [];

		class Listener {
			@Lifecycle.once('el:once')
			public static first() {
				order.push('once');
			}

			@Lifecycle.on('el:once', { prepend: true })
			public static early() {
				order.push('early');
			}
		}

		@Module.register({ controllers: [Listener] })
		class M extends Module {}

		app = await createTestingApp({ modules: [M], boot: 'eager' });
		Lifecycle.emit('el:once', {});
		Lifecycle.emit('el:once', {});
		await tick();
		expect(order).toEqual(['early', 'once', 'early']);
	});

	it('routes handler errors to elysium:error', async () => {
		const errors: unknown[] = [];
		const collect = (e: LifecycleEvent<unknown>) => {
			errors.push(e.data);
		};

		class Listener {
			@Lifecycle.on('el:boom')
			public static handle() {
				throw new Error('boom');
			}
		}

		@Module.register({ controllers: [Listener] })
		class M extends Module {}

		Lifecycle.on('elysium:error', collect);
		try {
			app = await createTestingApp({ modules: [M], boot: 'eager' });
			Lifecycle.emit('el:boom', {});
			await tick();
			expect((errors[0] as Error).message).toBe('boom');
		} finally {
			LifecycleBus.instance.removeListener('elysium:error', collect);
		}
	});

	it('does not wire listeners of a module that is not initialised (lazy boot)', async () => {
		class Listener {
			@Lifecycle.on('el:lazy')
			public static handle() {}
		}

		@Module.register({ controllers: [Listener] })
		class M extends Module {}

		app = await createTestingApp({ modules: [M], boot: 'lazy' });
		expect(LifecycleBus.instance.listenerCount('el:lazy')).toBe(0);
		await app.kernel.initModule(app.kernel.graph.nodes[0]);
		expect(LifecycleBus.instance.listenerCount('el:lazy')).toBe(1);
	});

	it('rejects an instance listener on a class that is not a service', async () => {
		class NotAService {
			@Lifecycle.on('el:bad')
			public handle() {}
		}

		@Module.register({ controllers: [NotAService] })
		class M extends Module {}

		const failure = await createTestingApp({ modules: [M], boot: 'eager' }).then(
			() => null,
			(e: unknown) => e
		);
		expect(failure).toBeInstanceOf(LifecycleListenerNotSupportedError);
		expect(LifecycleBus.instance.listenerCount('el:bad')).toBe(0);
	});

	it('keeps the functional Lifecycle.on registering immediately', () => {
		const handler = () => {};
		const before = LifecycleBus.instance.listenerCount('el:fn');
		Lifecycle.on('el:fn', handler);
		expect(LifecycleBus.instance.listenerCount('el:fn')).toBe(before + 1);
		LifecycleBus.instance.removeListener('el:fn', handler);
	});
});
