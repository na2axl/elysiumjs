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

import { Metadata } from '../src/metadata';

const noop: ClassDecorator & PropertyDecorator & ParameterDecorator = () => {};

describe('Metadata', () => {
	describe('class metadata', () => {
		it('should store and read a value', () => {
			class A {}
			Metadata.define('key', 42, A);

			expect(Metadata.get('key', A)).toBe(42);
			expect(Metadata.getOwn('key', A)).toBe(42);
			expect(Metadata.has('key', A)).toBe(true);
		});

		it('should return undefined for a missing key', () => {
			class A {}

			expect(Metadata.get('missing', A)).toBeUndefined();
			expect(Metadata.has('missing', A)).toBe(false);
		});

		it('should replace a value defined twice', () => {
			class A {}
			Metadata.define('key', 1, A);
			Metadata.define('key', 2, A);

			expect(Metadata.get('key', A)).toBe(2);
		});

		it('should accept symbol keys', () => {
			const key = Symbol('key');
			class A {}
			Metadata.define(key, 'value', A);

			expect(Metadata.get(key, A)).toBe('value');
		});

		it('should let a subclass read its parent metadata, but not own it', () => {
			class Parent {}
			class Child extends Parent {}
			Metadata.define('key', 'parent', Parent);

			expect(Metadata.get('key', Child)).toBe('parent');
			expect(Metadata.getOwn('key', Child)).toBeUndefined();
			expect(Metadata.has('key', Child)).toBe(true);
		});

		it('should let a subclass shadow its parent metadata without changing it', () => {
			class Parent {}
			class Child extends Parent {}
			Metadata.define('key', 'parent', Parent);
			Metadata.define('key', 'child', Child);

			expect(Metadata.get('key', Child)).toBe('child');
			expect(Metadata.get('key', Parent)).toBe('parent');
		});
	});

	describe('property metadata', () => {
		it('should keep property metadata apart from class metadata', () => {
			class A {}
			Metadata.define('key', 'class', A);
			Metadata.define('key', 'method', A.prototype, 'run');

			expect(Metadata.get('key', A)).toBe('class');
			expect(Metadata.get('key', A.prototype, 'run')).toBe('method');
			expect(Metadata.get('key', A.prototype, 'other')).toBeUndefined();
		});

		it('should read property metadata through the prototype chain', () => {
			class Parent {}
			class Child extends Parent {}
			Metadata.define('key', 'value', Parent.prototype, 'run');

			expect(Metadata.get('key', Child.prototype, 'run')).toBe('value');
			expect(Metadata.getOwn('key', Child.prototype, 'run')).toBeUndefined();
		});
	});

	describe('alongside reflect-metadata', () => {
		it('should read values that reflect-metadata stored', () => {
			class A {}
			const reflect = Reflect as unknown as Record<string, unknown>;
			reflect.getMetadata = (key: string, target: object) =>
				key === 'design:type' && target === A ? 'foreign' : undefined;
			reflect.getOwnMetadata = reflect.getMetadata;

			try {
				expect(Metadata.get('design:type', A)).toBe('foreign');
				expect(Metadata.getOwn('design:type', A)).toBe('foreign');
				expect(Metadata.has('design:type', A)).toBe(true);
			} finally {
				delete reflect.getMetadata;
				delete reflect.getOwnMetadata;
			}
		});

		it('should prefer its own values', () => {
			class A {}
			Metadata.define('key', 'own', A);
			const reflect = Reflect as unknown as Record<string, unknown>;
			reflect.getMetadata = () => 'foreign';

			try {
				expect(Metadata.get('key', A)).toBe('own');
			} finally {
				delete reflect.getMetadata;
			}
		});
	});

	describe('compiler-emitted design types', () => {
		it('should capture constructor parameter types', () => {
			class Dependency {}

			@noop
			class A {
				constructor(_dependency: Dependency, _count: number) {}
			}

			expect(Metadata.get('design:paramtypes', A)).toEqual([Dependency, Number]);
		});

		it('should capture property types', () => {
			class A {
				@noop
				public names!: string[];

				@noop
				public verbose!: boolean;
			}

			expect(Metadata.get('design:type', A.prototype, 'names')).toBe(Array);
			expect(Metadata.get('design:type', A.prototype, 'verbose')).toBe(Boolean);
		});

		it('should capture method parameter types', () => {
			class Dependency {}

			class A {
				public run(@noop _dependency: Dependency) {}
			}

			expect(Metadata.get('design:paramtypes', A.prototype, 'run')).toEqual([Dependency]);
		});
	});
});
