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
import { t } from 'elysia';

import { Application } from '@elysiumjs/core';

import { createSchemaFromDrizzle, drizzleAdapter, DrizzleModel } from '../src/model';
import { pgTable } from '../src/table';
import * as Tenancy from '../src/tenancy';

// ============================================================================
// Test Fixtures
// ============================================================================

const mockColumns = {
	id: d.uuid().primaryKey().defaultRandom(),
	name: d.varchar().notNull(),
	age: d.integer().notNull(),
	email: d.varchar().notNull().unique(),
	is_confirmed: d.boolean().default(false)
};

const mockTable = d.pgTable('users', mockColumns);

const enhancedMockTable = pgTable('enhanced_users', mockColumns);

const mockStore = new Map([['tenant', 'test-tenant']]);
const mockGetStore = mock(() => mockStore);

// ============================================================================
// Mock Application context
// ============================================================================

beforeAll(() => {
	Object.defineProperty(Application, 'context', {
		get: () => ({
			getStore: mockGetStore,
			run: mock((_: any, callback: any) => callback())
		}),
		configurable: true
	});
});

// ============================================================================
// Tests
// ============================================================================

describe('DrizzleModel', () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	afterAll(() => {
		mock.restore();
	});

	describe('drizzleAdapter', () => {
		describe('getTableName', () => {
			it('should return the table name', () => {
				const name = drizzleAdapter.getTableName(mockTable);
				expect(name).toBe('users');
			});
		});

		describe('getColumns', () => {
			it('should return normalized column metadata', () => {
				const columns = drizzleAdapter.getColumns(mockTable);

				expect(columns).toBeArrayOfSize(5);

				const idCol = columns.find(c => c.name === 'id');
				expect(idCol).toBeDefined();
				expect(idCol!.dataType).toBe('uuid');
				expect(idCol!.isPrimaryKey).toBe(true);
				expect(idCol!.hasDefault).toBe(true);
				expect(idCol!.nullable).toBe(false);

				const nameCol = columns.find(c => c.name === 'name');
				expect(nameCol).toBeDefined();
				expect(nameCol!.dataType).toBe('string');
				expect(nameCol!.nullable).toBe(false);
				expect(nameCol!.hasDefault).toBe(false);

				const ageCol = columns.find(c => c.name === 'age');
				expect(ageCol).toBeDefined();
				expect(ageCol!.dataType).toBe('number');

				const confirmedCol = columns.find(c => c.name === 'is_confirmed');
				expect(confirmedCol).toBeDefined();
				expect(confirmedCol!.dataType).toBe('boolean');
				expect(confirmedCol!.hasDefault).toBe(true);
			});
		});

		describe('createTenantTable', () => {
			it('should create a tenant-scoped table when column builders are registered', () => {
				// Use enhanced pgTable which auto-registers builders
				const cols = {
					id: d.uuid().primaryKey().defaultRandom(),
					name: d.varchar().notNull()
				};
				const table = pgTable('items', cols);

				const pgSchemaSpy = spyOn(d, 'pgSchema');

				const tenantTable = drizzleAdapter.createTenantTable(table, 'tenant-abc');

				expect(pgSchemaSpy).toHaveBeenCalledWith('tenant-abc');
				expect(tenantTable).toBeDefined();
			});

			it('should create a public table for the public tenant', () => {
				const cols = {
					id: d.uuid().primaryKey().defaultRandom(),
					name: d.varchar().notNull()
				};
				const table = pgTable('items_public', cols);

				const pgTableSpy = spyOn(d, 'pgTable');

				const publicTable = drizzleAdapter.createTenantTable(table, 'public');

				expect(pgTableSpy).toHaveBeenCalledWith('items_public', cols);
				expect(publicTable).toBeDefined();
			});

			it('should throw if column builders are not registered', () => {
				const unregisteredTable = d.pgTable('orphan', {
					id: d.uuid().primaryKey()
				});

				expect(() => {
					drizzleAdapter.createTenantTable(unregisteredTable, 'some-tenant');
				}).toThrow('No column builders registered');
			});
		});
	});

	describe('createSchemaFromDrizzle', () => {
		it('should create a schema for select mode', () => {
			const getTableConfigSpy = spyOn(d, 'getTableConfig');
			const objectSpy = spyOn(t, 'Object');

			createSchemaFromDrizzle(mockTable, { mode: 'select' });

			expect(getTableConfigSpy).toHaveBeenCalledWith(mockTable);
			expect(objectSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					id: expect.any(Object),
					name: expect.any(Object),
					email: expect.any(Object),
					age: expect.any(Object),
					is_confirmed: expect.any(Object)
				})
			);

			objectSpy.mockRestore();
		});

		it('should create a schema for create mode', () => {
			const getTableConfigSpy = spyOn(d, 'getTableConfig');
			const objectSpy = spyOn(t, 'Object');

			createSchemaFromDrizzle(mockTable, { mode: 'create' });

			expect(getTableConfigSpy).toHaveBeenCalledWith(mockTable);

			// Primary key should be excluded in create mode
			expect(objectSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					name: expect.any(Object),
					email: expect.any(Object),
					age: expect.any(Object),
					is_confirmed: expect.any(Object)
				})
			);

			expect(objectSpy).not.toHaveBeenCalledWith(
				expect.objectContaining({
					id: expect.any(Object)
				})
			);

			objectSpy.mockRestore();
		});

		it('should create a schema for update mode', () => {
			const getTableConfigSpy = spyOn(d, 'getTableConfig');
			const objectSpy = spyOn(t, 'Object');

			createSchemaFromDrizzle(mockTable, { mode: 'update' });

			expect(getTableConfigSpy).toHaveBeenCalledWith(mockTable);

			// Primary key should be excluded in update mode
			expect(objectSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					name: expect.any(Object),
					email: expect.any(Object),
					age: expect.any(Object),
					is_confirmed: expect.any(Object)
				})
			);

			expect(objectSpy).not.toHaveBeenCalledWith(
				expect.objectContaining({
					id: expect.any(Object)
				})
			);

			objectSpy.mockRestore();
		});
	});

	describe('DrizzleModel with pgTable', () => {
		describe('single signature API', () => {
			it('should accept a pgTable directly', () => {
				const cols = {
					id: d.uuid().primaryKey().defaultRandom(),
					title: d.varchar().notNull()
				};
				const posts = pgTable('posts', cols);

				class Post extends DrizzleModel(posts) {}

				expect(Post.tableName).toBe('posts');
				expect(Post.table).toBeDefined();
				expect(Post.insertSchema).toBeDefined();
				expect(Post.updateSchema).toBeDefined();
				expect(Post.selectSchema).toBeDefined();
			});

			it('should support supportTenancy option', () => {
				const cols = {
					id: d.uuid().primaryKey().defaultRandom(),
					name: d.varchar().notNull()
				};
				const tenants = pgTable('tenants', cols);

				class Tenant extends DrizzleModel(tenants, { supportTenancy: true }) {}

				expect(Tenant.supportTenancy).toBe(true);
			});

			it('should default supportTenancy to false', () => {
				const cols = {
					id: d.uuid().primaryKey().defaultRandom()
				};
				const items = pgTable('items', cols);

				class Item extends DrizzleModel(items) {}

				expect(Item.supportTenancy).toBe(false);
			});

			it('should infer types from the table', () => {
				const cols = {
					id: d.uuid().primaryKey().defaultRandom(),
					email: d.varchar().notNull(),
					age: d.integer()
				};
				const users = pgTable('typed_users', cols);

				class TypedUser extends DrizzleModel(users) {}

				// Type inference markers
				expect(TypedUser.$inferSelect).toBeUndefined();
				expect(TypedUser.$inferInsert).toBeUndefined();
				expect(TypedUser.$inferUpdate).toBeUndefined();
			});
		});

		describe('tenancy with pgTable', () => {
			it('should create tenant table when tenancy is enabled', () => {
				const cols = {
					id: d.uuid().primaryKey().defaultRandom(),
					data: d.varchar().notNull()
				};
				const tenantData = pgTable('tenant_data', cols);

				class TenantData extends DrizzleModel(tenantData, { supportTenancy: true }) {}

				// Should not throw when accessing table
				expect(TenantData.table).toBeDefined();
			});
		});
	});

	describe('Tenancy', () => {
		it('should register a new tenant schema', () => {
			const pgSchemaSpy = spyOn(d, 'pgSchema');

			const schema = Tenancy.registerTenantSchema('new-tenant');

			expect(pgSchemaSpy).toHaveBeenCalledWith('new-tenant');
			expect(schema).toBeDefined();
		});

		it('should wrap columns with a tenant schema', () => {
			const pgTableSpy = spyOn(d, 'pgTable');
			const pgSchemaSpy = spyOn(d, 'pgSchema');

			const cols = {
				id: d.uuid().primaryKey().defaultRandom(),
				name: d.varchar().notNull()
			};

			// Call the function with a non-public tenant
			const table = Tenancy.wrapTenantSchema('wrap-test-tenant', 'items', cols);

			expect(pgSchemaSpy).toHaveBeenCalledWith('wrap-test-tenant');
			expect(table).toBeDefined();

			// Call the function with the public tenant
			const publicTable = Tenancy.wrapTenantSchema('public', 'items', cols);

			expect(pgTableSpy).toHaveBeenCalledWith('items', cols);
			expect(publicTable).toBeDefined();
		});

		it('should reuse existing tenant schemas', () => {
			const pgSchemaSpy = spyOn(d, 'pgSchema');

			Tenancy.registerTenantSchema('existing-tenant');
			pgSchemaSpy.mockClear();

			const schema = Tenancy.registerTenantSchema('existing-tenant');

			expect(pgSchemaSpy).not.toHaveBeenCalled();
			expect(schema).toBeDefined();
		});

		it('should reuse existing tenant tables', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom()
			};

			const pgSchemaSpy = spyOn(d, 'pgSchema');

			Tenancy.wrapTenantSchema('cache-tenant', 'cached_items', cols);
			pgSchemaSpy.mockClear();

			Tenancy.wrapTenantSchema('cache-tenant', 'cached_items', cols);

			expect(pgSchemaSpy).not.toHaveBeenCalled();
		});
	});
});
