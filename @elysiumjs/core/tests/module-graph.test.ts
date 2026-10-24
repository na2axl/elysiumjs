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

import { describe, expect, it } from 'bun:test';

import type { Container } from '../src/container.ts';

import {
	ConflictingModuleConfigError,
	DuplicateCommandError,
	ModuleCycleError
} from '../src/errors.ts';
import { buildModuleGraph, selectConfig } from '../src/module-graph.ts';
import { Module } from '../src/module.ts';

const ids = (nodes: readonly { id: string }[]) => nodes.map((n) => n.id);

describe('buildModuleGraph', () => {
	it('orders a linear chain with imports first', () => {
		@Module.register()
		class C extends Module {}
		@Module.register({ imports: [C] })
		class B extends Module {}
		@Module.register({ imports: [B] })
		class A extends Module {}

		const graph = buildModuleGraph([A], 'development');
		expect(ids(graph.nodes)).toEqual(['C', 'B', 'A']);
	});

	it('includes a diamond dependency once, after both parents', () => {
		@Module.register()
		class D extends Module {}
		@Module.register({ imports: [D] })
		class B extends Module {}
		@Module.register({ imports: [D] })
		class C extends Module {}
		@Module.register({ imports: [B, C] })
		class A extends Module {}

		const order = ids(buildModuleGraph([A], 'development').nodes);
		expect(order.filter((i) => i === 'D')).toHaveLength(1);
		expect(order).toEqual(['D', 'B', 'C', 'A']);
	});

	it('uses the shortest path as depth', () => {
		@Module.register()
		class D extends Module {}
		@Module.register({ imports: [D] })
		class B extends Module {}
		@Module.register({ imports: [B, D] })
		class A extends Module {}

		const graph = buildModuleGraph([A], 'development');
		expect(graph.node(A)!.depth).toBe(1);
		expect(graph.node(B)!.depth).toBe(2);
		expect(graph.node(D)!.depth).toBe(2);
	});

	it('throws on a cycle with the path', () => {
		const holder: any[] = [];
		@Module.register({ imports: holder })
		class A extends Module {}
		@Module.register({ imports: [A] })
		class B extends Module {}
		holder.push(B);

		try {
			buildModuleGraph([A], 'development');
			throw new Error('expected cycle');
		} catch (e) {
			expect(e).toBeInstanceOf(ModuleCycleError);
			expect((e as ModuleCycleError).path).toEqual(['A', 'B', 'A']);
			expect((e as Error).message).toContain('A -> B -> A');
		}
	});

	it('skips modules excluded by env and does not walk their imports', () => {
		@Module.register()
		class Dep extends Module {}
		@Module.register({ imports: [Dep], env: ['development'] })
		class DevOnly extends Module {}
		@Module.register({ imports: [DevOnly] })
		class A extends Module {}

		const graph = buildModuleGraph([A], 'production');
		expect(ids(graph.nodes)).toEqual(['A']);
		expect(graph.skipped).toEqual([DevOnly]);
		expect(graph.node(Dep)).toBeUndefined();
		expect(graph.node(A)!.imports).toEqual([]);
	});

	it('keeps imports of a skipped module that another loaded module imports', () => {
		@Module.register()
		class Dep extends Module {}
		@Module.register({ imports: [Dep], env: ['development'] })
		class DevOnly extends Module {}
		@Module.register({ imports: [DevOnly, Dep] })
		class A extends Module {}

		const graph = buildModuleGraph([A], 'production');
		expect(ids(graph.nodes)).toEqual(['Dep', 'A']);
	});

	it('is not transitive for visibility', () => {
		@Module.register()
		class C extends Module {}
		@Module.register({ imports: [C] })
		class B extends Module {}
		@Module.register({ imports: [B] })
		class A extends Module {}

		const graph = buildModuleGraph([A], 'development');
		expect(ids(graph.visibleOwners(graph.node(A)!))).toEqual(['B']);
	});

	it('exposes re-exported modules to importers', () => {
		@Module.register()
		class C extends Module {}
		@Module.register({ imports: [C], exports: [C] })
		class B extends Module {}
		@Module.register({ imports: [B] })
		class A extends Module {}

		const graph = buildModuleGraph([A], 'development');
		expect(ids(graph.visibleOwners(graph.node(A)!))).toEqual(['B', 'C']);
		expect(graph.exportsOf(graph.node(B)!)).toEqual([]);
	});

	it('returns true for exports: true and service names otherwise', () => {
		class Foo {}
		@Module.register({ exports: true })
		class All extends Module {}
		@Module.register({ exports: [Foo, 'token'] })
		class Some extends Module {}

		const graph = buildModuleGraph([All, Some], 'development');
		expect(graph.exportsOf(graph.node(All)!)).toBe(true);
		expect(graph.exportsOf(graph.node(Some)!)).toEqual(['Foo', 'token']);
	});

	it('is assignable to the container visibility resolver', () => {
		const graph = buildModuleGraph([], 'development');
		const r: Parameters<typeof Container.setVisibility>[0] = graph;
		expect(r).toBe(graph);
	});

	it('throws when two modules register the same command', () => {
		class X {
			static command = 'same';
			static dev = false;
		}
		class Y {
			static command = 'same';
			static dev = false;
		}
		@Module.register({ commands: [X as any] })
		class M1 extends Module {}
		@Module.register({ commands: [Y as any] })
		class M2 extends Module {}

		try {
			buildModuleGraph([M1, M2], 'development');
			throw new Error('expected duplicate');
		} catch (e) {
			expect(e).toBeInstanceOf(DuplicateCommandError);
			expect((e as DuplicateCommandError).modules).toEqual(['M1', 'M2']);
		}
	});

	it('drops dev commands under production', () => {
		class X {
			static command = 'same';
			static dev = true;
		}
		class Y {
			static command = 'same';
			static dev = false;
		}
		@Module.register({ commands: [X as any] })
		class M1 extends Module {}
		@Module.register({ commands: [Y as any] })
		class M2 extends Module {}

		const graph = buildModuleGraph([M1, M2], 'production');
		expect(graph.collect('commands').map((c) => c.item)).toEqual([Y as any]);
		expect(() => buildModuleGraph([M1, M2], 'development')).toThrow(DuplicateCommandError);
	});

	it('collects items with their owning node', () => {
		class J1 {}
		class J2 {}
		@Module.register({ jobs: [J1] })
		class M1 extends Module {}
		@Module.register({ jobs: [J2] })
		class M2 extends Module {}

		const graph = buildModuleGraph([M1, M2], 'development');
		const jobs = graph.collect('jobs');
		expect(jobs.map((j) => [j.item, j.module.id])).toEqual([
			[J1, 'M1'],
			[J2, 'M2']
		]);
	});
});

describe('selectConfig', () => {
	const Base = Module.configurable<{ a?: unknown; b?: number }>();

	it('plain import plus with() yields one node configured by with()', () => {
		@Module.register()
		class Cfg extends Base {}
		@Module.register({ imports: [Cfg] })
		class P extends Module {}

		const graph = buildModuleGraph([P, Cfg.with({ a: 1 })], 'development');
		expect(graph.nodes.filter((n) => n.id === 'Cfg')).toHaveLength(1);
		expect(selectConfig(graph.node(Cfg)!)!.config).toEqual({ a: 1 });
	});

	it('prefers the app-level config over a package config at depth 2', () => {
		@Module.register()
		class Cfg extends Base {}
		@Module.register({ imports: [Cfg.with({ a: 2 })] })
		class Pkg extends Module {}

		const graph = buildModuleGraph([Pkg, Cfg.with({ a: 1 })], 'development');
		const source = selectConfig(graph.node(Cfg)!)!;
		expect(source.config).toEqual({ a: 1 });
		expect(source.site).toBe('<app>');
		expect(source.depth).toBe(1);
	});

	it('throws for different configs at the same depth, not for equal ones', () => {
		@Module.register()
		class Cfg extends Base {}

		const bad = buildModuleGraph([Cfg.with({ a: 1 }), Cfg.with({ a: 2 })], 'development');
		expect(() => selectConfig(bad.node(Cfg)!)).toThrow(ConflictingModuleConfigError);

		const ok = buildModuleGraph(
			[Cfg.with({ a: { x: 1 } }), Cfg.with({ a: { x: 1 } })],
			'development'
		);
		expect(selectConfig(ok.node(Cfg)!)).toBeDefined();
	});

	it('returns the first source when function-form configs tie', () => {
		@Module.register()
		class Cfg extends Base {}
		const graph = buildModuleGraph(
			[Cfg.with(() => ({ a: 1 })), Cfg.with({ a: 2 })],
			'development'
		);
		expect(typeof selectConfig(graph.node(Cfg)!)!.config).toBe('function');
	});

	it('returns undefined without configuration', () => {
		@Module.register()
		class Cfg extends Module {}
		const graph = buildModuleGraph([Cfg], 'development');
		expect(selectConfig(graph.node(Cfg)!)).toBeUndefined();
	});
});
