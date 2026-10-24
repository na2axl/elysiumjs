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

import { InvalidModuleError, MissingModuleConfigError } from '../src/errors.ts';
import { getModuleProps, isConfiguredModule, Module } from '../src/module.ts';
import { Symbols } from '../src/utils.ts';

describe('Module', () => {
	describe('@Module.register', () => {
		it('stores the props as metadata', () => {
			class Ctl {}
			const props = { controllers: [Ctl], prefix: '/x' as const };

			@Module.register(props)
			class TestModule extends Module {}

			expect(Reflect.getMetadata(Symbols.module, TestModule)).toEqual(props);
			expect(getModuleProps(TestModule)).toEqual(props);
		});

		it('does not create an Elysia plugin', () => {
			@Module.register()
			class TestModule extends Module {}

			expect(Reflect.getMetadata(Symbols.elysiaPlugin, TestModule)).toBeUndefined();
			expect(getModuleProps(TestModule)).toEqual({});
		});
	});

	describe('getModuleProps', () => {
		it('throws InvalidModuleError on an undecorated class', () => {
			class Plain extends Module {}
			expect(() => getModuleProps(Plain)).toThrow(InvalidModuleError);
		});
	});

	describe('hooks', () => {
		it('default to no-ops', async () => {
			@Module.register()
			class TestModule extends Module {}
			const m = new TestModule();

			expect(await m.onInit()).toBeUndefined();
			expect(await m.onDestroy()).toBeUndefined();
			expect(await m.onServe({} as any)).toBeUndefined();
		});
	});

	describe('Module.configurable', () => {
		type Cfg = { url: string; opts: { a: number; b: number } };

		@Module.register()
		class XModule extends Module.configurable<Cfg>({
			defaults: { opts: { a: 1, b: 2 } },
			required: ['url']
		}) {}

		it('with() returns a configured module', () => {
			const cm = XModule.with({ url: 'u' });
			expect(isConfiguredModule(cm)).toBe(true);
			expect(cm.module).toBe(XModule);
			expect(cm.config).toEqual({ url: 'u' });
		});

		it('isConfiguredModule rejects other values', () => {
			expect(isConfiguredModule(XModule)).toBe(false);
			expect(isConfiguredModule(null)).toBe(false);
			expect(isConfiguredModule({})).toBe(false);
		});

		it('config token reflects the subclass name', () => {
			expect(XModule.config).toBe('elysium.module.XModule.config');
		});

		it('resolveConfig deep-merges defaults', () => {
			const resolved = XModule.resolveConfig({ url: 'u', opts: { a: 9 } as any });
			expect(resolved).toEqual({ url: 'u', opts: { a: 9, b: 2 } });
		});

		it('resolveConfig does not mutate its input or the defaults', () => {
			const input = { url: 'u' } as Partial<Cfg>;
			XModule.resolveConfig(input);
			expect(input).toEqual({ url: 'u' });
			XModule.resolveConfig({ url: 'w', opts: { a: 5 } as any });
			expect(XModule.resolveConfig({ url: 'v' }).opts).toEqual({ a: 1, b: 2 });
		});

		it('resolveConfig leaves nested input and defaults unchanged and unshared', () => {
			const input = { url: 'u', opts: { a: 9 } } as any;
			const r1 = XModule.resolveConfig(input);
			const r2 = XModule.resolveConfig({ url: 'v' });
			expect(input).toEqual({ url: 'u', opts: { a: 9 } });
			expect(r1.opts).toEqual({ a: 9, b: 2 });

			r2.opts.a = 77;
			const r3 = XModule.resolveConfig({ url: 'w' });
			expect(r3.opts).toEqual({ a: 1, b: 2 });
			expect(r2.opts).not.toBe(r3.opts);
		});

		it('resolveConfig throws listing missing required keys', () => {
			try {
				XModule.resolveConfig({});
				throw new Error('should have thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(MissingModuleConfigError);
				expect((e as MissingModuleConfigError).keys).toEqual(['url']);
			}
		});

		it('instance config getter reads the kernel-set metadata', () => {
			const m = new XModule();
			Reflect.defineMetadata(Symbols.moduleConfig, { url: 'z' }, m);
			expect(m.config).toEqual({ url: 'z' });
		});
	});
});
