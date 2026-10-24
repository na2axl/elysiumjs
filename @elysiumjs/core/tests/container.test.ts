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

import type { ModuleNode } from '../src/module-graph';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { Container } from '../src/container';
import {
	DuplicateGlobalServiceError,
	EnvironmentSkippedModuleError,
	ServiceNotFoundError,
	ServiceNotReadyError,
	ServiceNotVisibleError
} from '../src/errors';
import { ModuleContext } from '../src/module-context';
import { Service, ServiceScope } from '../src/service';

const A: ModuleNode = { id: 'A' };
const B: ModuleNode = { id: 'B' };
const C: ModuleNode = { id: 'C' };

describe('Container', () => {
	beforeEach(() => {
		Container.reset();
		Container.setModuleInitHook(null);
		Container.setSkippedLookup(null);
		// A imports B; B exports only BService.
		Container.setVisibility({
			visibleOwners: (node) => (node.id === 'A' ? [B] : []),
			exportsOf: (node) => (node.id === 'B' ? ['BService'] : [])
		});
	});

	afterEach(() => {
		Container.setVisibility(null);
		Container.setModuleInitHook(null);
		Container.setSkippedLookup(null);
		Container.reset();
	});

	const run = <T>(node: ModuleNode, fn: () => T) => ModuleContext.run(node, fn);

	it('resolves a module own service', () => {
		class AService {}
		Container.register(A, AService, undefined);
		expect(run(A, () => Service.get(AService))).toBeInstanceOf(AService);
	});

	it('resolves an exported service of an imported module', () => {
		class BService {}
		Container.register(B, BService, undefined);
		expect(run(A, () => Service.get(BService))).toBeInstanceOf(BService);
	});

	it('hides non-exported services of imported modules', () => {
		class Hidden {}
		class Consumer {
			constructor(@Service.inject(Hidden) public hidden: Hidden) {}
		}
		Container.register(B, Hidden, undefined);
		Container.register(A, Consumer, undefined);

		expect(run(A, () => Service.get(Hidden))).toBeNull();
		let thrown: unknown;
		try {
			run(A, () => Service.make(Consumer));
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(ServiceNotVisibleError);
		expect((thrown as Error).message).toContain("add it to B's exports");
	});

	it('throws ServiceNotFoundError when a dependency exists nowhere', () => {
		class Consumer {
			constructor(@Service.inject('Nope') public dep: any) {}
		}
		expect(() => run(A, () => Service.make(Consumer))).toThrow(ServiceNotFoundError);
	});

	it('reports skipped-environment modules before not-found', () => {
		Container.setSkippedLookup((name) =>
			name === 'Dev' ? { module: 'DevModule', environment: 'production' } : null
		);
		class Consumer {
			constructor(@Service.inject('Dev') public dep: any) {}
		}
		expect(() => run(A, () => Service.make(Consumer))).toThrow(EnvironmentSkippedModuleError);
		expect(run(A, () => Service.get('Dev'))).toBeNull();
	});

	it('makes global services visible everywhere, including with no context', () => {
		class G {}
		Container.register(B, { name: 'G', factory: () => new G(), global: true }, undefined);
		expect(Service.get('G')).toBeInstanceOf(G);
		expect(run(C, () => Service.get('G'))).toBeInstanceOf(G);
		expect(Container.lookup('G', undefined)?.owner).toBe(B);
	});

	it('hides non-global services when there is no context', () => {
		class AService {}
		Container.register(A, AService, undefined);
		expect(Service.get(AService)).toBeNull();
	});

	it('keeps same-named services of different modules apart', () => {
		class Shared {}
		Container.register(A, Shared, undefined);
		Container.register(C, Shared, undefined);
		const a = run(A, () => Service.get(Shared));
		const c = run(C, () => Service.get(Shared));
		expect(a).not.toBe(c);
	});

	it('rejects duplicate global names, naming both owners', () => {
		const def = { name: 'G', factory: () => ({}), global: true };
		Container.register(A, def, undefined);
		let thrown: unknown;
		try {
			Container.register(B, def, undefined);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(DuplicateGlobalServiceError);
		expect((thrown as DuplicateGlobalServiceError).modules).toEqual(['A', 'B']);
	});

	it('builds singletons once and factories each time', () => {
		class Single {}
		class Many {}
		Container.register(A, Single, undefined);
		Container.register(
			A,
			{ name: 'Many', factory: () => new Many(), scope: ServiceScope.FACTORY },
			undefined
		);
		expect(run(A, () => Service.get(Single))).toBe(run(A, () => Service.get(Single)));
		expect(run(A, () => Service.get('Many'))).not.toBe(run(A, () => Service.get('Many')));
	});

	it('records constructed singletons in construction order, excluding factories', () => {
		class First {}
		class Second {}
		class Fact {}
		Container.register(A, Second, undefined);
		Container.register(A, First, undefined);
		Container.register(
			A,
			{ name: 'Fact', factory: () => new Fact(), scope: ServiceScope.FACTORY },
			undefined
		);
		run(A, () => {
			Service.get(First);
			Service.get('Fact');
			Service.get(Second);
		});
		const snapshot = Container.constructed();
		expect(snapshot.map((c) => c.name)).toEqual(['First', 'Second']);
		expect(snapshot[0].owner).toBe(A);
		expect(Container.constructed()).not.toBe(snapshot);
	});

	it('constructs inside the owner context', () => {
		let seen: string | undefined;
		class Spy {
			constructor() {
				seen = ModuleContext.current()?.id;
			}
		}
		Container.register(B, Spy, undefined);
		Container.setVisibility({ visibleOwners: () => [B], exportsOf: () => true });
		run(A, () => Service.get(Spy));
		expect(seen).toBe('B');
	});

	it('passes config and a resolver to factory definitions', () => {
		class Dep {}
		Container.register(A, Dep, undefined);
		Container.register(
			A,
			{ name: 'F', factory: (config, get) => ({ config, dep: get(Dep) }) },
			{ x: 1 }
		);
		const f = run(A, () => Service.get<any>('F'));
		expect(f.config).toEqual({ x: 1 });
		expect(f.dep).toBeInstanceOf(Dep);
	});

	it('throws ServiceNotReadyError on get for async onInit, and resolve awaits it', async () => {
		class Slow {
			public ready = false;
			async onInit() {
				await Bun.sleep(5);
				this.ready = true;
			}
		}
		Container.register(A, Slow, undefined);
		expect(() => run(A, () => Service.get(Slow))).toThrow(ServiceNotReadyError);
		const slow = await run(A, () => Service.resolve(Slow));
		expect(slow.ready).toBe(true);
		expect(run(A, () => Service.get(Slow))).toBe(slow);
	});

	it('calls sync onInit on get', () => {
		class Quick {
			public ready = false;
			onInit() {
				this.ready = true;
			}
		}
		Container.register(A, Quick, undefined);
		expect(run(A, () => Service.get(Quick))!.ready).toBe(true);
	});

	it('uses the module init hook: throws when pending, awaited by resolve, sync when ready', async () => {
		class AService {}
		Container.register(A, AService, undefined);
		let initialised = false;
		Container.setModuleInitHook(() => {
			if (initialised) return;
			return Bun.sleep(5).then(() => {
				initialised = true;
			});
		});
		expect(() => run(A, () => Service.get(AService))).toThrow(ServiceNotReadyError);
		expect(await run(A, () => Service.resolve(AService))).toBeInstanceOf(AService);
		expect(initialised).toBe(true);
		expect(run(A, () => Service.get(AService))).toBeInstanceOf(AService);
	});

	it('resolve awaits dependencies that are still initialising', async () => {
		class D {
			public ready = false;
			async onInit() {
				await Bun.sleep(5);
				this.ready = true;
			}
		}
		class X {
			constructor(@Service.inject(D) public dep: D) {}
		}
		Container.register(A, D, undefined);
		Container.register(A, X, undefined);
		const x = await run(A, () => Service.resolve(X));
		expect(x.dep.ready).toBe(true);
	});

	it('resolve awaits a pending init of the dependency owner module', async () => {
		class D {}
		class X {
			constructor(@Service.inject('DService') public dep: D) {}
		}
		Container.register(B, { name: 'DService', factory: () => new D() }, undefined);
		Container.register(A, X, undefined);
		Container.setVisibility({ visibleOwners: () => [B], exportsOf: () => true });
		let initialised = false;
		Container.setModuleInitHook((owner) => {
			if (owner.id !== 'B' || initialised) return;
			return Bun.sleep(5).then(() => {
				initialised = true;
			});
		});
		const x = await run(A, () => Service.resolve(X));
		expect(initialised).toBe(true);
		expect(x.dep).toBeInstanceOf(D);
	});

	it('surfaces a failed onInit from both get and resolve', async () => {
		class Broken {
			async onInit() {
				throw new Error('boom');
			}
		}
		Container.register(A, Broken, undefined);
		expect(() => run(A, () => Service.get(Broken))).toThrow(ServiceNotReadyError);
		await expect(run(A, () => Service.resolve(Broken))).rejects.toThrow('boom');
		expect(() => run(A, () => Service.get(Broken))).toThrow('boom');
		await expect(run(A, () => Service.resolve(Broken))).rejects.toThrow('boom');
	});

	it('resolve rejects with typed errors', async () => {
		await expect(run(A, () => Service.resolve('Nope'))).rejects.toBeInstanceOf(
			ServiceNotFoundError
		);
	});
});
