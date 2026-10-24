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

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { Container } from '../src/container';
import { DuplicateGlobalServiceError, ServiceNotFoundError } from '../src/errors';
import { Service, ServiceScope } from '../src/service';
import { Symbols } from '../src/utils';

describe('Service', () => {
	beforeEach(() => {
		Container.reset();
	});

	afterAll(() => {
		Container.reset();
	});

	describe('@Service.register', () => {
		it('only writes metadata and leaves the container empty', () => {
			@Service.register({ name: 'custom', scope: ServiceScope.FACTORY, global: true })
			class TestService {}

			expect(Service.exists('custom')).toBe(false);
			expect(Service.exists(TestService)).toBe(false);
			expect(Service.keys('*')).toEqual([]);
			expect(Reflect.getMetadata(Symbols.serviceOptions, TestService)).toEqual({
				name: 'custom',
				scope: ServiceScope.FACTORY,
				global: true
			});
		});

		it('writes empty options when called without arguments', () => {
			@Service.register()
			class TestService {}

			expect(Reflect.getMetadata(Symbols.serviceOptions, TestService)).toEqual({});
		});
	});

	describe('global imperative API', () => {
		it('binds, retrieves and removes a service by class and name', () => {
			class TestService {}
			const instance = Service.bind(TestService);
			expect(Service.exists(TestService)).toBe(true);
			expect(Service.get(TestService)).toBe(instance);

			Service.remove(TestService);
			expect(Service.exists(TestService)).toBe(false);
			expect(Service.get('TestService')).toBeNull();
		});

		it('reports whether a service has been built, without building it', () => {
			let built = 0;
			Service.registerLazy('lazy-one', () => ++built);
			expect(Service.isConstructed('lazy-one')).toBe(false);
			expect(built).toBe(0);

			Service.get('lazy-one');
			expect(Service.isConstructed('lazy-one')).toBe(true);
			expect(Service.isConstructed('unknown')).toBe(false);
		});

		it('binds with a custom name', () => {
			class TestService {}
			const instance = Service.bind(TestService, 'CustomName');
			expect(Service.get('CustomName')).toBe(instance);
		});

		it('registers an instance by class or name', () => {
			class TestService {}
			const a = new TestService();
			const b = new TestService();
			expect(Service.instance(TestService, a)).toBe(a);
			expect(Service.instance('Named', b)).toBe(b);
			expect(Service.get(TestService)).toBe(a);
			expect(Service.get('Named')).toBe(b);
		});

		it('registers factories that build a new instance each time', () => {
			class TestService {
				value = 'factory';
			}
			const first = Service.factory(TestService);
			expect(first.value).toBe('factory');
			expect(Service.get(TestService)).not.toBe(first);

			const custom = Service.factory('Custom', () => ({ value: 'custom' }));
			expect(custom.value).toBe('custom');
			expect(Service.get('Custom')).not.toBe(custom);
		});

		it('make() builds a fresh instance and injects dependencies', () => {
			class Dep {}
			class TestService {
				constructor(@Service.inject(Dep) public dep: Dep) {}
			}
			const dep = Service.bind(Dep);
			const made = Service.make(TestService);
			expect(made.dep).toBe(dep);
			expect(Service.make(TestService)).not.toBe(made);
		});

		it('make() throws ServiceNotFoundError for a missing dependency', () => {
			class TestService {
				constructor(@Service.inject('Missing') public dep: any) {}
			}
			expect(() => Service.make(TestService)).toThrow(ServiceNotFoundError);
		});

		it('throws on duplicate registration instead of exiting', () => {
			class TestService {}
			Service.bind(TestService);
			expect(() => Service.instance(TestService, new TestService())).toThrow(
				DuplicateGlobalServiceError
			);
			expect(() => Service.factory('TestService', () => ({}))).toThrow(DuplicateGlobalServiceError);
			expect(() => Service.registerLazy('TestService', () => ({}))).toThrow(
				DuplicateGlobalServiceError
			);
		});

		it('registerLazy resolves on first access only, once', () => {
			let calls = 0;
			Service.registerLazy('Lazy', () => {
				calls++;
				return { n: calls };
			});
			expect(calls).toBe(0);
			expect(Service.get('Lazy')).toBe(Service.get('Lazy'));
			expect(calls).toBe(1);
		});

		it('keys() matches glob-like patterns', () => {
			Service.instance('a.one', {});
			Service.instance('a.two', {});
			Service.instance('b.one', {});
			expect(Service.keys('a.*').sort()).toEqual(['a.one', 'a.two']);
			expect(Service.keys('?.one').sort()).toEqual(['a.one', 'b.one']);
		});

		it('clear() empties the global scope', () => {
			Service.instance('x', {});
			Service.clear();
			expect(Service.keys('*')).toEqual([]);
		});

		it('resolve() awaits and returns a global service', async () => {
			const x = {};
			Service.instance('x', x);
			expect(await Service.resolve('x')).toBe(x);
		});
	});
});
