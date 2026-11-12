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

import type { ModuleNode } from '../src/module-graph';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { Application } from '../src/app';
import { Container } from '../src/container';
import { ElysiumError, ScopeMismatchError, ServiceNotReadyError } from '../src/errors';
import { Http } from '../src/http';
import { Module } from '../src/module';
import { ModuleContext } from '../src/module-context';
import { Service, ServiceScope } from '../src/service';
import { resetContainer } from '../src/testing';

interface Plugin {
	readonly name: string;
}

const Plugins = Service.tag<Plugin>('test.plugins');

const A: ModuleNode = { id: 'A' } as ModuleNode;
const B: ModuleNode = { id: 'B' } as ModuleNode;
const Outside: ModuleNode = { id: 'Outside' } as ModuleNode;

const run = <T>(node: ModuleNode | undefined, fn: () => T) =>
	node ? ModuleContext.run(node, fn) : fn();

describe('multi-binding', () => {
	beforeEach(() => {
		resetContainer();
		// A imports nothing; the application is made of A and B.
		Container.setVisibility({ visibleOwners: () => [], exportsOf: () => [], nodes: [A, B] });
	});

	afterEach(() => resetContainer());

	describe('container', () => {
		it('gives every tagged service, in registration order, across modules', () => {
			@Service.register({ tags: [Plugins] })
			class First implements Plugin {
				public readonly name = 'first';
			}
			@Service.register({ tags: [Plugins] })
			class Second implements Plugin {
				public readonly name = 'second';
			}
			@Service.register({ tags: [Plugins], global: true })
			class Third implements Plugin {
				public readonly name = 'third';
			}
			Container.register(B, First, undefined);
			Container.register(A, Second, undefined);
			Container.register(B, Third, undefined);

			const names = run(A, () => Service.getAll(Plugins).map((p) => p.name));
			expect(names).toEqual(['first', 'second', 'third']);
		});

		it('keeps token lookups to the visibility rules', () => {
			@Service.register({ tags: [Plugins] })
			class Hidden implements Plugin {
				public readonly name = 'hidden';
			}
			Container.register(B, Hidden, undefined);

			expect(run(A, () => Service.get(Hidden))).toBeNull();
			expect(run(A, () => Service.getAll(Plugins))).toHaveLength(1);
		});

		it('shares singletons with token injection', () => {
			@Service.register({ tags: [Plugins] })
			class Shared implements Plugin {
				public readonly name = 'shared';
			}
			Container.register(A, Shared, undefined);

			const [tagged] = run(A, () => Service.getAll(Plugins));
			expect(run(A, () => Service.get(Shared))).toBe(tagged as Shared);
		});

		it('leaves out services of modules outside the application', () => {
			@Service.register({ tags: [Plugins] })
			class Elsewhere implements Plugin {
				public readonly name = 'elsewhere';
			}
			Container.register(Outside, Elsewhere, undefined);

			expect(run(A, () => Service.getAll(Plugins))).toEqual([]);
			expect(run(Outside, () => Service.getAll(Plugins))).toHaveLength(1);
		});

		it('sees only its own and global tagged services without a module graph', () => {
			Container.setVisibility(null);
			@Service.register({ tags: [Plugins] })
			class Own implements Plugin {
				public readonly name = 'own';
			}
			@Service.register({ tags: [Plugins] })
			class Other implements Plugin {
				public readonly name = 'other';
			}
			Container.register(A, Own, undefined);
			Container.register(B, Other, undefined);
			Service.instance('test.global-plugin', { name: 'global' });

			expect(run(A, () => Service.getAll(Plugins).map((p) => p.name))).toEqual(['own']);
		});

		it('gives an empty array for a tag without services', () => {
			class Consumer {
				constructor(@Service.injectAll(Plugins) public readonly plugins: Plugin[]) {}
			}
			expect(Service.make(Consumer).plugins).toEqual([]);
		});

		it('tags factory definitions', () => {
			Container.register(
				A,
				{ name: 'test.factory-plugin', tags: [Plugins], factory: () => ({ name: 'factory' }) },
				undefined
			);
			expect(run(A, () => Service.getAll(Plugins).map((p) => p.name))).toEqual(['factory']);
		});

		it('matches tags by name', () => {
			@Service.register({ tags: [Service.tag<Plugin>('test.plugins')] })
			class Twin implements Plugin {
				public readonly name = 'twin';
			}
			Container.register(A, Twin, undefined);
			expect(run(A, () => Service.getAll(Plugins))).toHaveLength(1);
		});

		it('lists a service once per tag, even when the tag is given twice', () => {
			@Service.register({ tags: [Plugins, Plugins] })
			class Twice implements Plugin {
				public readonly name = 'twice';
			}
			Container.register(A, Twice, undefined);
			expect(run(A, () => Service.getAll(Plugins))).toHaveLength(1);
		});

		it('refuses a request-scoped tagged service in a singleton', () => {
			@Service.register({ tags: [Plugins], scope: ServiceScope.REQUEST })
			class PerRequest implements Plugin {
				public readonly name = 'request';
			}
			@Service.register()
			class Registry {
				constructor(@Service.injectAll(Plugins) public readonly plugins: Plugin[]) {}
			}
			Container.register(A, PerRequest, undefined);
			Container.register(A, Registry, undefined);

			expect(() => Service.runInRequestScope(() => run(A, () => Service.get(Registry)))).toThrow(
				ScopeMismatchError
			);
		});

		it('gives request-scoped tagged services to a request-scoped consumer', () => {
			@Service.register({ tags: [Plugins], scope: ServiceScope.REQUEST })
			class PerRequest implements Plugin {
				public readonly name = 'request';
			}
			@Service.register({ scope: ServiceScope.REQUEST })
			class Registry {
				constructor(@Service.injectAll(Plugins) public readonly plugins: Plugin[]) {}
			}
			Container.register(A, PerRequest, undefined);
			Container.register(A, Registry, undefined);

			const [registry, plugin] = Service.runInRequestScope(() =>
				run(A, () => [Service.get(Registry)!, Service.get(PerRequest)!] as const)
			);
			expect(registry.plugins).toEqual([plugin]);
		});

		it('awaits the async onInit of every tagged service with resolveAll', async () => {
			@Service.register({ tags: [Plugins] })
			class Slow implements Plugin {
				public name = 'pending';
				public async onInit() {
					await new Promise((resolve) => setTimeout(resolve, 1));
					this.name = 'ready';
				}
			}
			Container.register(A, Slow, undefined);

			expect(() => run(A, () => Service.getAll(Plugins))).toThrow(ServiceNotReadyError);
			const plugins = await run(A, () => Service.resolveAll(Plugins));
			expect(plugins.map((p) => p.name)).toEqual(['ready']);
		});

		it('prepares the tagged dependencies of a class', async () => {
			@Service.register({ tags: [Plugins] })
			class Slow implements Plugin {
				public name = 'pending';
				public async onInit() {
					await new Promise((resolve) => setTimeout(resolve, 1));
					this.name = 'ready';
				}
			}
			class Consumer {
				constructor(@Service.injectAll(Plugins) public readonly plugins: Plugin[]) {}
			}
			Container.register(A, Slow, undefined);

			await run(A, () => Container.prepareClass(Consumer));
			expect(run(A, () => Service.make(Consumer)).plugins.map((p) => p.name)).toEqual(['ready']);
		});

		it('keeps an overridden service in its tags', () => {
			@Service.register({ tags: [Plugins] })
			class Real implements Plugin {
				public readonly name = 'real';
			}
			Container.setOverrides([Real]);
			Service.instance(Real, { name: 'fake' });
			Container.register(A, Real, undefined);

			expect(run(A, () => Service.getAll(Plugins).map((p) => p.name))).toEqual(['fake']);
		});

		it('forgets a removed global service', () => {
			Container.add({
				token: 'test.removed',
				name: 'test.removed',
				scope: ServiceScope.SINGLETON,
				global: true,
				owner: null,
				create: () => ({ name: 'removed' }),
				initialised: false,
				tags: ['test.plugins']
			});
			expect(Service.getAll(Plugins)).toHaveLength(1);
			Service.remove('test.removed');
			expect(Service.getAll(Plugins)).toEqual([]);
		});

		it('refuses something that is not a tag', () => {
			expect(() => Service.injectAll('test.plugins' as never)).toThrow(ElysiumError);
		});
	});

	describe('application', () => {
		it('injects the tagged services of modules a module does not import', async () => {
			@Service.register({ tags: [Plugins] })
			class AuditPlugin implements Plugin {
				public readonly name = 'audit';
			}

			@Service.register({ tags: [Plugins] })
			class BillingPlugin implements Plugin {
				public readonly name = 'billing';
				public async onInit() {
					await new Promise((resolve) => setTimeout(resolve, 1));
				}
			}

			@Service.register()
			class PluginRegistry {
				constructor(@Service.injectAll(Plugins) public readonly plugins: Plugin[]) {}
			}

			@Http.controller('/plugins')
			class PluginController {
				constructor(@Service.inject(PluginRegistry) private readonly registry: PluginRegistry) {}

				@Http.get()
				public list(@Service.injectAll(Plugins) plugins: Plugin[]) {
					return {
						fromRegistry: this.registry.plugins.map((p) => p.name),
						fromHandler: plugins.map((p) => p.name)
					};
				}
			}

			@Module.register({ services: [PluginRegistry], controllers: [PluginController] })
			class CoreModule extends Module {}

			@Module.register({ imports: [CoreModule], services: [AuditPlugin] })
			class AuditModule extends Module {}

			@Module.register({ imports: [CoreModule], services: [BillingPlugin] })
			class BillingModule extends Module {}

			@Application.register({ modules: [CoreModule, AuditModule, BillingModule], openapi: false })
			class PluginApp extends Application {}

			const instance = new PluginApp();
			const app = await instance.build();
			const response = await app.handle(new Request('http://localhost/plugins'));
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				fromRegistry: ['audit', 'billing'],
				fromHandler: ['audit', 'billing']
			});
			await instance.kernel.shutdown();
		});
	});
});
