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

import { describe, expect, it } from 'bun:test';

import type { Ability, CerberusConfig, Subject } from '../../src/cerberus/utils';

describe('Cerberus types', () => {
	describe('Subject type', () => {
		it('should accept an object with id field', () => {
			const subject: Subject = { id: 'user-123' };
			expect(subject.id).toBe('user-123');
		});
	});

	describe('Ability type', () => {
		it('should accept action and resource', () => {
			const ability: Ability = {
				action: 'read',
				resource: 'Post'
			};
			expect(ability.action).toBe('read');
			expect(ability.resource).toBe('Post');
		});

		it('should accept optional fields', () => {
			const ability: Ability = {
				action: 'update',
				resource: 'User',
				fields: ['name', 'email']
			};
			expect(ability.fields).toEqual(['name', 'email']);
		});
	});

	describe('CerberusConfig type', () => {
		it('should accept a config with required getSubject', () => {
			const config: CerberusConfig = {
				getSubject: async () => ({ id: 'user-1' })
			};
			expect(config.getSubject).toBeDefined();
			expect(typeof config.getSubject).toBe('function');
		});

		it('should accept optional getAbilities', () => {
			const config: CerberusConfig = {
				getSubject: async () => ({ id: 'user-1' }),
				getAbilities: async () => [{ action: 'read', resource: 'Post' }]
			};
			expect(config.getAbilities).toBeDefined();
		});

		it('should accept optional defineAbility', () => {
			const config: CerberusConfig = {
				getSubject: async () => ({ id: 'user-1' }),
				defineAbility: async (subject, define) => {
					return define((can) => {
						can('read', 'Post');
					});
				}
			};
			expect(config.defineAbility).toBeDefined();
		});
	});
});
