// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import { afterAll, afterEach, beforeAll, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import * as d from 'drizzle-orm/pg-core';

import { Application, Service } from '@elysiumjs/core';

import { Database } from '../src/database';
import { DrizzleModel, registerTableColumnBuilders } from '../src/model';
import {
	createRLSPolicy,
	DrizzleRLSTenancy,
	DrizzleSchemaTenancy,
	getTenantSchema,
	registerTenantSchema,
	wrapTenantSchema
} from '../src/tenancy';

// ============================================================================
// Mock setup
// ============================================================================

mock.module('drizzle-orm/bun-sql', () => ({
	drizzle: mock(() => ({ mockDrizzleInstance: true }))
}));

beforeAll(() => {
	const mockContext = {
		getStore: mock(() => new Map()),
		run: mock((_: any, callback: any) => callback())
	};
	Object.defineProperty(Application, 'context', {
		get: () => mockContext,
		configurable: true
	});
});

// ============================================================================
// Tests
// ============================================================================

describe('Tenancy', () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	afterAll(() => {
		mock.restore();
	});

	describe('getTenantSchema', () => {
		it('should return a PgSchema for the tenant', () => {
			const schema = getTenantSchema('schema-test-tenant');
			expect(schema).toBeDefined();
			expect(schema.schemaName).toBe('schema-test-tenant');
		});

		it('should return the same schema for the same tenant', () => {
			const schema1 = getTenantSchema('reuse-schema-tenant');
			const schema2 = getTenantSchema('reuse-schema-tenant');
			expect(schema1).toBe(schema2);
		});
	});

	describe('registerTenantSchema', () => {
		it('should register and return a new tenant schema', () => {
			const pgSchemaSpy = spyOn(d, 'pgSchema');

			const schema = registerTenantSchema('register-tenant');

			expect(pgSchemaSpy).toHaveBeenCalledWith('register-tenant');
			expect(schema).toBeDefined();
		});

		it('should not re-register existing tenant schemas', () => {
			const pgSchemaSpy = spyOn(d, 'pgSchema');

			registerTenantSchema('already-registered');
			pgSchemaSpy.mockClear();

			const schema = registerTenantSchema('already-registered');

			expect(pgSchemaSpy).not.toHaveBeenCalled();
			expect(schema).toBeDefined();
		});
	});

	describe('wrapTenantSchema', () => {
		it('should return a regular pgTable for the public tenant', () => {
			const pgTableSpy = spyOn(d, 'pgTable');
			const cols = { id: d.uuid().primaryKey().defaultRandom() };

			const table = wrapTenantSchema('public', 'wrap_public', cols);

			expect(pgTableSpy).toHaveBeenCalledWith('wrap_public', cols);
			expect(table).toBeDefined();
		});

		it('should return a schema-qualified table for non-public tenants', () => {
			const cols = { id: d.uuid().primaryKey().defaultRandom() };

			const table = wrapTenantSchema('tenant-wrap', 'wrap_test', cols);

			expect(table).toBeDefined();
		});

		it('should cache tenant tables', () => {
			const cols = { id: d.uuid().primaryKey().defaultRandom() };

			const table1 = wrapTenantSchema('cached-wrap', 'cache_wrap_test', cols);
			const table2 = wrapTenantSchema('cached-wrap', 'cache_wrap_test', cols);

			expect(table1).toBe(table2);
		});
	});

	describe('DrizzleSchemaTenancy', () => {
		it('should have mode set to schema', () => {
			const strategy = new DrizzleSchemaTenancy();
			expect(strategy.mode).toBe('schema');
		});

		it('should resolve a table to a tenant-scoped table', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom(),
				name: d.varchar().notNull()
			};
			const table = d.pgTable('schema_strategy_test', cols);
			registerTableColumnBuilders(table, cols);

			const strategy = new DrizzleSchemaTenancy();
			const resolved = strategy.resolveTable(table, 'strategy-tenant');

			expect(resolved).toBeDefined();
			expect(resolved).not.toBe(table);
		});

		it('should pass through callback in withIsolation', async () => {
			const strategy = new DrizzleSchemaTenancy();
			const result = await strategy.withIsolation(null, 'tenant', async () => 'test-result');
			expect(result).toBe('test-result');
		});
	});

	describe('DrizzleRLSTenancy', () => {
		it('should have mode set to rls', () => {
			const strategy = new DrizzleRLSTenancy();
			expect(strategy.mode).toBe('rls');
		});

		it('should return the same table in resolveTable', () => {
			const table = d.pgTable('rls_test', {
				id: d.uuid().primaryKey().defaultRandom()
			});

			const strategy = new DrizzleRLSTenancy();
			const resolved = strategy.resolveTable(table, 'any-tenant');

			expect(resolved).toBe(table);
		});

		it('should wrap callback in a transaction with set_config', async () => {
			const mockTx = {
				execute: mock(() => Promise.resolve())
			};
			const mockConnection = {
				transaction: mock(async (fn: any) => fn(mockTx))
			};

			const strategy = new DrizzleRLSTenancy();
			const result = await strategy.withIsolation(
				mockConnection,
				'rls-tenant',
				async () => 'rls-result'
			);

			expect(mockConnection.transaction).toHaveBeenCalled();
			expect(mockTx.execute).toHaveBeenCalled();
			expect(result).toBe('rls-result');
		});
	});

	describe('createRLSPolicy', () => {
		it('should create an RLS policy with default settings', () => {
			const policy = createRLSPolicy('users');

			expect(policy).toBeDefined();
			expect(policy.name).toBe('users_tenant_isolation');
			expect(policy.for).toBe('all');
			expect(policy.to).toBe('public');
		});

		it('should create an RLS policy with custom column and policy name', () => {
			const policy = createRLSPolicy('orders', 'org_id', 'orders_org_policy');

			expect(policy).toBeDefined();
			expect(policy.name).toBe('orders_org_policy');
		});
	});
});
