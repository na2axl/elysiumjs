// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { Container } from '../src/container';
import {
	ConflictingModuleConfigError,
	EnvironmentSkippedModuleError,
	MissingModuleConfigError
} from '../src/errors';
import { Kernel } from '../src/kernel';
import { Module } from '../src/module';
import { ModuleContext } from '../src/module-context';
import { buildModuleGraph } from '../src/module-graph';
import { Service } from '../src/service';

const events: string[] = [];

const reset = () => {
	events.length = 0;
	Container.reset();
	Container.setVisibility(null);
	Container.setModuleInitHook(null);
	Container.setSkippedLookup(null);
};

/** Creates a service class with a given name that records its destruction. */
const tracked = (name: string, failInit: false | 'async' | 'sync' = false) => {
	const cls = class {
		onInit() {
			if (failInit === 'sync') throw new Error('init failed');
			if (failInit === 'async') return Promise.reject(new Error('init failed'));
		}
		onDestroy() {
			events.push(`destroy:${name}`);
		}
	};
	Object.defineProperty(cls, 'name', { value: name });
	return cls;
};

describe('Kernel', () => {
	beforeEach(reset);
	afterEach(reset);

	it("registers itself as the global 'elysium.kernel' service", async () => {
		@Module.register({})
		class Solo extends Module {}
		const kernel = new Kernel(buildModuleGraph([Solo]));
		await kernel.register();
		expect(Service.get<Kernel>('elysium.kernel')).toBe(kernel);
		expect(Service.get<Kernel>('elysium.kernel').graph).toBe(kernel.graph);
	});

	it("re-registers 'elysium.kernel' after a container reset without a duplicate error", async () => {
		@Module.register({})
		class Solo extends Module {}
		await new Kernel(buildModuleGraph([Solo])).register();
		reset();
		const second = new Kernel(buildModuleGraph([Solo]));
		await second.register();
		expect(Service.get<Kernel>('elysium.kernel')).toBe(second);
	});

	it('passes the resolved config to a function-form services()', async () => {
		let received: unknown;
		type Cfg = { level: string; extra: number };
		@Module.register<Cfg>({
			services: (config) => {
				received = config;
				return [];
			}
		})
		class M extends Module.configurable<Cfg>({ defaults: { extra: 1 } }) {}

		const kernel = new Kernel(buildModuleGraph([M.with(() => ({ level: 'debug' }))], 'test'));
		await kernel.register();
		expect(received).toEqual({ level: 'debug', extra: 1 });
	});

	it('throws when a required config key is missing', async () => {
		@Module.register()
		class M extends Module.configurable<{ url: string }>({ required: ['url'] }) {}
		const kernel = new Kernel(buildModuleGraph([M], 'test'));
		await expect(kernel.register()).rejects.toBeInstanceOf(MissingModuleConfigError);
	});

	it('makes the config injectable inside its module only', async () => {
		@Module.register()
		class Inner extends Module.configurable<{ level: string }>() {}
		@Module.register()
		class Other extends Module {}

		const graph = buildModuleGraph([Inner.with({ level: 'warn' }), Other], 'test');
		const kernel = new Kernel(graph);
		await kernel.register();
		await kernel.initModule(graph.node(Inner)!);

		const read = (cls: typeof Inner | typeof Other) =>
			ModuleContext.run(graph.node(cls)!, () => Service.get(Inner.config));
		expect(read(Inner)).toEqual({ level: 'warn' });
		expect(read(Other)).toBeNull();
	});

	it('stores the config on the module instance', async () => {
		@Module.register()
		class M extends Module.configurable<{ level: string }>() {}
		const graph = buildModuleGraph([M.with({ level: 'warn' })], 'test');
		const kernel = new Kernel(graph);
		await kernel.register();
		expect((kernel.moduleInstance(graph.node(M)!) as InstanceType<typeof M>).config).toEqual({
			level: 'warn'
		});
	});

	it('throws when tied function-form configs evaluate differently', async () => {
		@Module.register()
		class Target extends Module.configurable<{ n: number }>() {}
		@Module.register({ imports: [Target.with(() => ({ n: 1 }))] })
		class P1 extends Module {}
		@Module.register({ imports: [Target.with(() => ({ n: 2 }))] })
		class P2 extends Module {}

		const kernel = new Kernel(buildModuleGraph([P1, P2], 'test'));
		await expect(kernel.register()).rejects.toBeInstanceOf(ConflictingModuleConfigError);
	});

	it('accepts tied function-form configs that evaluate equally', async () => {
		@Module.register()
		class Target extends Module.configurable<{ n: number }>() {}
		@Module.register({ imports: [Target.with(() => ({ n: 1 }))] })
		class P1 extends Module {}
		@Module.register({ imports: [Target.with(async () => ({ n: 1 }))] })
		class P2 extends Module {}

		await new Kernel(buildModuleGraph([P1, P2], 'test')).register();
	});

	it('reports a service that belongs to a module skipped for the environment', async () => {
		class DevOnlyService {}
		@Module.register({
			env: ['development'],
			services: [DevOnlyService],
			exports: [DevOnlyService]
		})
		class DevModule extends Module {}

		class NeedsDev {
			constructor(@Service.inject('DevOnlyService') public readonly dev: unknown) {}
		}
		@Module.register({ imports: [DevModule], services: [NeedsDev] })
		class App extends Module {}

		const graph = buildModuleGraph([App], 'production');
		await new Kernel(graph).register();

		let error: unknown;
		try {
			ModuleContext.run(graph.node(App)!, () => Service.make(NeedsDev));
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(EnvironmentSkippedModuleError);
		expect(error).toMatchObject({
			service: 'DevOnlyService',
			requester: 'NeedsDev',
			skippedModule: 'DevModule',
			environment: 'production'
		});
	});

	it('initialises imports first and runs onInit once', async () => {
		@Module.register()
		class B extends Module {
			onInit() {
				events.push('B');
			}
		}
		@Module.register({ imports: [B] })
		class A extends Module {
			onInit() {
				events.push('A');
			}
		}
		const graph = buildModuleGraph([A], 'test');
		const kernel = new Kernel(graph);
		await kernel.register();

		await Promise.all([kernel.initModule(graph.node(A)!), kernel.initModule(graph.node(A)!)]);
		await kernel.initModule(graph.node(A)!);
		expect(events).toEqual(['B', 'A']);
	});

	it('initialises sync modules synchronously through the container hook, imports first', async () => {
		@Module.register({ services: [{ name: 'b.svc', global: true, factory: () => 1 }] })
		class B extends Module {
			onInit() {
				events.push('B');
			}
			onDestroy() {
				events.push('destroy:B');
			}
		}
		@Module.register({
			imports: [B],
			services: [{ name: 'a.svc', global: true, factory: () => 2 }]
		})
		class A extends Module {
			onInit() {
				events.push('A');
			}
			onDestroy() {
				events.push('destroy:A');
			}
		}
		const graph = buildModuleGraph([A], 'test');
		const kernel = new Kernel(graph);
		await kernel.register();

		expect(Service.get('a.svc')).toBe(2);
		expect(events).toEqual(['B', 'A']);
		await kernel.shutdown();
		expect(events).toEqual(['B', 'A', 'destroy:A', 'destroy:B']);
	});

	it('records a failing sync onInit reached through the hook and skips it on shutdown', async () => {
		@Module.register({ services: [{ name: 'bad.svc', global: true, factory: () => 1 }] })
		class Bad extends Module {
			onInit() {
				throw new Error('sync boom');
			}
			onDestroy() {
				events.push('destroy:Bad');
			}
		}
		const graph = buildModuleGraph([Bad], 'test');
		const kernel = new Kernel(graph);
		await kernel.register();

		expect(() => Service.get('bad.svc')).toThrow('sync boom');
		expect(() => Service.get('bad.svc')).toThrow('sync boom');
		await expect(kernel.initModule(graph.node(Bad)!)).rejects.toThrow('sync boom');
		await kernel.shutdown();
		expect(events).toEqual([]);
	});

	it('lets a factory get a service of a sync-init module under Service.resolve', async () => {
		@Module.register({ services: [{ name: 'infra.conn', global: true, factory: () => 'conn' }] })
		class Infra extends Module {}
		@Module.register({
			services: [
				{ name: 'user.repo', factory: (_c: unknown, get: any) => ({ conn: get('infra.conn') }) }
			]
		})
		class User extends Module {}
		const graph = buildModuleGraph([Infra, User], 'test');
		const kernel = new Kernel(graph);
		await kernel.register();

		const repo = await ModuleContext.run(graph.node(User)!, () => Service.resolve('user.repo'));
		expect(repo).toEqual({ conn: 'conn' });
	});

	it('gives a factory get on an async-init owner the improved ServiceNotReadyError', async () => {
		@Module.register({ services: [{ name: 'slow.conn', global: true, factory: () => 'conn' }] })
		class Slow extends Module {
			async onInit() {
				await Promise.resolve();
			}
		}
		@Module.register({
			services: [
				{ name: 'user.repo', factory: (_c: unknown, get: any) => ({ conn: get('slow.conn') }) }
			]
		})
		class User extends Module {}
		const graph = buildModuleGraph([Slow, User], 'test');
		const kernel = new Kernel(graph);
		await kernel.register();

		const attempt = ModuleContext.run(graph.node(User)!, () => Service.resolve('user.repo'));
		await expect(attempt).rejects.toThrow(/Slow initialises asynchronously/);
	});

	it('runs onInit once for a diamond dependency', async () => {
		@Module.register()
		class D extends Module {
			async onInit() {
				await new Promise((r) => setTimeout(r, 5));
				events.push('D');
			}
		}
		@Module.register({ imports: [D] })
		class B extends Module {
			onInit() {
				events.push('B');
			}
		}
		@Module.register({ imports: [D] })
		class C extends Module {
			onInit() {
				events.push('C');
			}
		}
		@Module.register({ imports: [B, C] })
		class A extends Module {
			onInit() {
				events.push('A');
			}
		}
		const graph = buildModuleGraph([A], 'test');
		const kernel = new Kernel(graph);
		await kernel.register();
		await Promise.all([kernel.initModule(graph.node(B)!), kernel.initModule(graph.node(C)!)]);
		await kernel.initModule(graph.node(A)!);
		expect(events.filter((e) => e === 'D')).toHaveLength(1);
		expect(events).toEqual(['D', 'B', 'C', 'A']);
	});

	it('prepare initialises the command module and global dependency owners, not others', async () => {
		@Service.register({ global: true })
		class GlobalSvc {}
		@Module.register({ services: [GlobalSvc] })
		class Provider extends Module {
			onInit() {
				events.push('Provider');
			}
		}
		@Module.register()
		class Unrelated extends Module {
			onInit() {
				events.push('Unrelated');
			}
		}
		class Cmd {
			constructor(@Service.inject('GlobalSvc') public readonly svc: GlobalSvc) {}
		}
		@Module.register({ commands: [Cmd as any] })
		class Home extends Module {
			onInit() {
				events.push('Home');
			}
		}

		const graph = buildModuleGraph([Provider, Unrelated, Home], 'test');
		const kernel = new Kernel(graph);
		await kernel.register();

		const cmd = await kernel.prepare(Cmd, graph.node(Home)!);
		expect(cmd.svc).toBeInstanceOf(GlobalSvc);
		expect(events).toContain('Home');
		expect(events).toContain('Provider');
		expect(events).not.toContain('Unrelated');
	});

	it('bootEager initialises every module and constructs every singleton', async () => {
		class S1 {
			constructor() {
				events.push('S1');
			}
		}
		class S2 {
			constructor() {
				events.push('S2');
			}
		}
		@Module.register({ services: [S1] })
		class A extends Module {
			onInit() {
				events.push('A');
			}
		}
		@Module.register({ services: [S2] })
		class B extends Module {
			onInit() {
				events.push('B');
			}
		}
		const kernel = new Kernel(buildModuleGraph([A, B], 'test'));
		await kernel.register();
		await kernel.bootEager();
		expect(events).toEqual(['A', 'B', 'S1', 'S2']);
	});

	it('shuts down services in reverse construction order, then modules in reverse init order', async () => {
		const S1 = tracked('S1');
		const S2 = tracked('S2');
		@Module.register()
		class B extends Module {
			onDestroy() {
				events.push('destroy:B');
			}
		}
		@Module.register({ imports: [B], services: [S1, S2] })
		class A extends Module {
			onDestroy() {
				events.push('destroy:A');
			}
		}
		const kernel = new Kernel(buildModuleGraph([A], 'test'));
		await kernel.register();
		await kernel.bootEager();
		await kernel.shutdown();
		await kernel.shutdown();
		expect(events).toEqual(['destroy:S2', 'destroy:S1', 'destroy:A', 'destroy:B']);
	});

	it('logs onDestroy errors without stopping the others', async () => {
		class Bad {
			onDestroy() {
				throw new Error('boom');
			}
		}
		class Good {
			onDestroy() {
				events.push('good');
			}
		}
		@Module.register({ services: [Good, Bad] })
		class A extends Module {}
		const kernel = new Kernel(buildModuleGraph([A], 'test'));
		await kernel.register();
		await kernel.bootEager();

		const original = console.error;
		const logged: unknown[][] = [];
		console.error = (...args: unknown[]) => void logged.push(args);
		try {
			await kernel.shutdown();
		} finally {
			console.error = original;
		}
		expect(events).toEqual(['good']);
		expect(logged.length).toBeGreaterThan(0);
	});

	it('after a failing service onInit during bootEager, shutdown destroys only what was constructed, in reverse', async () => {
		const [S1, S2, S3, S4] = [tracked('S1'), tracked('S2'), tracked('S3', 'async'), tracked('S4')];
		@Module.register({ services: [S1, S2, S3, S4] })
		class A extends Module {}
		const kernel = new Kernel(buildModuleGraph([A], 'test'));
		await kernel.register();

		await expect(kernel.bootEager()).rejects.toThrow('init failed');
		await kernel.shutdown();
		// S3 never became live and S4 was never constructed: neither is destroyed.
		expect(events).toEqual(['destroy:S2', 'destroy:S1']);
	});

	it('treats a synchronously failing service onInit the same way', async () => {
		const [S1, S2, S3, S4] = [tracked('S1'), tracked('S2'), tracked('S3', 'sync'), tracked('S4')];
		@Module.register({ services: [S1, S2, S3, S4] })
		class A extends Module {}
		const kernel = new Kernel(buildModuleGraph([A], 'test'));
		await kernel.register();

		await expect(kernel.bootEager()).rejects.toThrow('init failed');
		await kernel.shutdown();
		expect(events).toEqual(['destroy:S2', 'destroy:S1']);
	});

	it('prepare names the command class as requester when a dependency is from a skipped module', async () => {
		class DevOnlyService {}
		@Module.register({
			env: ['development'],
			services: [DevOnlyService],
			exports: [DevOnlyService]
		})
		class DevModule extends Module {}

		class MyCommand {
			constructor(@Service.inject('DevOnlyService') public readonly dev: unknown) {}
		}
		@Module.register({ imports: [DevModule], commands: [MyCommand as any] })
		class Home extends Module {}

		const graph = buildModuleGraph([Home], 'production');
		const kernel = new Kernel(graph);
		await kernel.register();

		const error = await kernel.prepare(MyCommand, graph.node(Home)!).catch((e) => e);
		expect(error).toBeInstanceOf(EnvironmentSkippedModuleError);
		expect(error).toMatchObject({ requester: 'MyCommand', skippedModule: 'DevModule' });
	});
});
