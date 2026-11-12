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

import { defineAbility } from '@casl/ability';
import { describe, expect, it } from 'bun:test';

import { Cerberus } from '../src/capability';

describe('Cerberus namespace', () => {
	describe('Cerberus.can()', () => {
		it('should return a decorator', () => {
			const decorator = Cerberus.can({ action: 'read', resource: 'Post' });
			expect(decorator).toBeDefined();
			expect(typeof decorator).toBe('function');
		});
	});

	describe('Cerberus.cannot()', () => {
		it('should return a decorator', () => {
			const decorator = Cerberus.cannot({ action: 'delete', resource: 'Post' });
			expect(decorator).toBeDefined();
			expect(typeof decorator).toBe('function');
		});
	});
});
