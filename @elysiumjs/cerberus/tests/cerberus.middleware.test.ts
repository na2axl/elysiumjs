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

import { defineAbility } from '@casl/ability';
import { describe, expect, it } from 'bun:test';

import { CerberusMiddleware } from '../src/cerberus.middleware';

describe('CerberusMiddleware', () => {
	let middleware: CerberusMiddleware;

	function createMockContext(): any {
		return {
			status: (code: number, message: string) => new Error(`${code}: ${message}`),
			'elysium:cerberus': undefined
		};
	}

	function build(config: any) {
		middleware = new CerberusMiddleware(config);
	}

	describe('onBeforeHandle', () => {
		it('should use defineAbility when config.defineAbility is provided', async () => {
			const mockAbility = defineAbility((can) => {
				can('read', 'Post');
			});

			build({
				getSubject: async () => ({ id: 'user-1' }),
				defineAbility: async () => mockAbility
			});

			const ctx = createMockContext();
			await middleware.onBeforeHandle(ctx);

			expect(ctx['elysium:cerberus']).toBeDefined();
		});

		it('should use getAbilities when config.getAbilities is provided', async () => {
			build({
				getSubject: async () => ({ id: 'user-1' }),
				getAbilities: async () => [
					{ action: 'read', resource: 'Post' },
					{ action: 'create', resource: 'Post' }
				]
			});

			const ctx = createMockContext();
			await middleware.onBeforeHandle(ctx);

			expect(ctx['elysium:cerberus']).toBeDefined();
			const ability = ctx['elysium:cerberus'];
			expect(ability.can('read', 'Post')).toBe(true);
			expect(ability.can('create', 'Post')).toBe(true);
			expect(ability.can('delete', 'Post')).toBe(false);
		});

		it('should default to manage all when no abilities method is provided', async () => {
			build({
				getSubject: async () => ({ id: 'user-1' })
			});

			const ctx = createMockContext();
			await middleware.onBeforeHandle(ctx);

			expect(ctx['elysium:cerberus']).toBeDefined();
			const ability = ctx['elysium:cerberus'];
			expect(ability.can('manage', 'all')).toBe(true);
		});
	});
});
