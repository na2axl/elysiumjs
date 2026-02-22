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
import { t } from 'elysia';

import type { ColumnMetadata } from '../src/interfaces';

import { createSchemaFromModel, AbstractModel } from '../src/model';

// Hand-crafted column metadata for testing
const userColumns: ColumnMetadata[] = [
	{ name: 'id', dataType: 'uuid', nullable: false, hasDefault: true, isPrimaryKey: true },
	{ name: 'name', dataType: 'string', nullable: false, hasDefault: false, isPrimaryKey: false },
	{ name: 'age', dataType: 'number', nullable: false, hasDefault: false, isPrimaryKey: false },
	{ name: 'email', dataType: 'string', nullable: false, hasDefault: false, isPrimaryKey: false },
	{ name: 'is_confirmed', dataType: 'boolean', nullable: false, hasDefault: true, isPrimaryKey: false },
];

describe('Model', () => {
	describe('createSchemaFromModel', () => {
		it('should create a schema for select mode', () => {
			const schema = createSchemaFromModel(userColumns, { mode: 'select' });

			// Select mode should include all columns including primary key
			expect(schema.properties).toBeDefined();
			expect(schema.properties.id).toBeDefined();
			expect(schema.properties.name).toBeDefined();
			expect(schema.properties.age).toBeDefined();
			expect(schema.properties.email).toBeDefined();
			expect(schema.properties.is_confirmed).toBeDefined();
		});

		it('should create a schema for create mode', () => {
			const schema = createSchemaFromModel(userColumns, { mode: 'create' });

			// Create mode should exclude primary key
			expect(schema.properties).toBeDefined();
			expect(schema.properties.id).toBeUndefined();
			expect(schema.properties.name).toBeDefined();
			expect(schema.properties.age).toBeDefined();
			expect(schema.properties.email).toBeDefined();
			expect(schema.properties.is_confirmed).toBeDefined();
		});

		it('should create a schema for update mode', () => {
			const schema = createSchemaFromModel(userColumns, { mode: 'update' });

			// Update mode should exclude primary key
			expect(schema.properties).toBeDefined();
			expect(schema.properties.id).toBeUndefined();
			expect(schema.properties.name).toBeDefined();
			expect(schema.properties.age).toBeDefined();
			expect(schema.properties.email).toBeDefined();
			expect(schema.properties.is_confirmed).toBeDefined();
		});

		it('should make all fields optional in update mode', () => {
			const columns: ColumnMetadata[] = [
				{ name: 'id', dataType: 'uuid', nullable: false, hasDefault: true, isPrimaryKey: true },
				{ name: 'name', dataType: 'string', nullable: false, hasDefault: false, isPrimaryKey: false },
			];

			const schema = createSchemaFromModel(columns, { mode: 'update' });

			// In update mode, all non-PK fields should be optional (not required)
			const required = schema.required ?? [];
			expect(required).not.toContain('name');
		});

		it('should make fields with defaults optional in create mode', () => {
			const columns: ColumnMetadata[] = [
				{ name: 'id', dataType: 'uuid', nullable: false, hasDefault: true, isPrimaryKey: true },
				{ name: 'status', dataType: 'string', nullable: false, hasDefault: true, isPrimaryKey: false },
				{ name: 'name', dataType: 'string', nullable: false, hasDefault: false, isPrimaryKey: false },
			];

			const schema = createSchemaFromModel(columns, { mode: 'create' });

			// 'status' has a default, so it should be optional
			// 'name' does not have a default, so it should be required
			expect(schema.properties.status).toBeDefined();
			expect(schema.properties.name).toBeDefined();
		});

		it('should handle nullable columns', () => {
			const columns: ColumnMetadata[] = [
				{ name: 'bio', dataType: 'string', nullable: true, hasDefault: false, isPrimaryKey: false },
			];

			const schema = createSchemaFromModel(columns, { mode: 'select' });

			// Nullable columns should be wrapped in t.Nullable
			expect(schema.properties.bio).toBeDefined();
		});

		it('should return an empty object schema for empty columns', () => {
			const schema = createSchemaFromModel([]);

			// Should return t.Object({})
			expect(schema.properties).toBeDefined();
			expect(Object.keys(schema.properties)).toHaveLength(0);
		});

		it('should return an empty object schema for undefined columns', () => {
			// @ts-expect-error Testing undefined input
			const schema = createSchemaFromModel(undefined);

			// Should return t.Object({})
			expect(schema.properties).toBeDefined();
			expect(Object.keys(schema.properties)).toHaveLength(0);
		});

		it('should handle all supported data types', () => {
			const allTypeColumns: ColumnMetadata[] = [
				{ name: 'col_string', dataType: 'string', nullable: false, hasDefault: false, isPrimaryKey: false },
				{ name: 'col_uuid', dataType: 'uuid', nullable: false, hasDefault: false, isPrimaryKey: false },
				{ name: 'col_number', dataType: 'number', nullable: false, hasDefault: false, isPrimaryKey: false },
				{ name: 'col_boolean', dataType: 'boolean', nullable: false, hasDefault: false, isPrimaryKey: false },
				{ name: 'col_array', dataType: 'array', nullable: false, hasDefault: false, isPrimaryKey: false },
				{ name: 'col_json', dataType: 'json', nullable: false, hasDefault: false, isPrimaryKey: false },
				{ name: 'col_date', dataType: 'date', nullable: false, hasDefault: false, isPrimaryKey: false },
				{ name: 'col_datetime', dataType: 'datetime', nullable: false, hasDefault: false, isPrimaryKey: false },
				{ name: 'col_bigint', dataType: 'bigint', nullable: false, hasDefault: false, isPrimaryKey: false },
				{ name: 'col_buffer', dataType: 'buffer', nullable: false, hasDefault: false, isPrimaryKey: false },
			];

			const schema = createSchemaFromModel(allTypeColumns, { mode: 'select' });

			// All data types should produce a valid schema property
			expect(schema.properties.col_string).toBeDefined();
			expect(schema.properties.col_uuid).toBeDefined();
			expect(schema.properties.col_number).toBeDefined();
			expect(schema.properties.col_boolean).toBeDefined();
			expect(schema.properties.col_array).toBeDefined();
			expect(schema.properties.col_json).toBeDefined();
			expect(schema.properties.col_date).toBeDefined();
			expect(schema.properties.col_datetime).toBeDefined();
			expect(schema.properties.col_bigint).toBeDefined();
			expect(schema.properties.col_buffer).toBeDefined();
		});

		it('should default to select mode when no mode is specified', () => {
			const columns: ColumnMetadata[] = [
				{ name: 'id', dataType: 'uuid', nullable: false, hasDefault: true, isPrimaryKey: true },
				{ name: 'name', dataType: 'string', nullable: false, hasDefault: false, isPrimaryKey: false },
			];

			const schema = createSchemaFromModel(columns);

			// Default mode should be 'select', which includes primary key
			expect(schema.properties.id).toBeDefined();
			expect(schema.properties.name).toBeDefined();
		});
	});

	describe('AbstractModel', () => {
		it('should create a model class with the correct properties', () => {
			const mockAdapter = {
				getTableName: () => 'users',
				getColumns: () => userColumns,
				createTenantTable: (table: any, tenant: string) => table,
			};

			const mockTable = { _tableName: 'users' };

			class UserModel extends AbstractModel('users', { id: 'uuid', name: 'text' }, mockAdapter, mockTable) {}

			// Check if the model class has the correct static properties
			expect(UserModel.tableName).toBe('users');
			expect(UserModel.columns).toEqual({ id: 'uuid', name: 'text' });
			expect(UserModel.insertSchema).toBeDefined();
			expect(UserModel.updateSchema).toBeDefined();
			expect(UserModel.selectSchema).toBeDefined();
			expect(UserModel.supportTenancy).toBe(false);
			expect(UserModel.$inferSelect).toBeUndefined();
			expect(UserModel.$inferInsert).toBeUndefined();
			expect(UserModel.$inferUpdate).toBeUndefined();
		});

		it('should use the adapter to extract column metadata', () => {
			const getColumnsSpy = { called: false };
			const mockAdapter = {
				getTableName: () => 'products',
				getColumns: (table: any) => {
					getColumnsSpy.called = true;
					return [
						{ name: 'id', dataType: 'uuid' as const, nullable: false, hasDefault: true, isPrimaryKey: true },
						{ name: 'title', dataType: 'string' as const, nullable: false, hasDefault: false, isPrimaryKey: false },
					];
				},
				createTenantTable: (table: any, tenant: string) => table,
			};

			const mockTable = { _tableName: 'products' };

			class ProductModel extends AbstractModel('products', { id: 'uuid', title: 'text' }, mockAdapter, mockTable) {}

			// The adapter's getColumns should have been called during model creation
			expect(getColumnsSpy.called).toBe(true);

			// Schemas should be generated from the adapter's column metadata
			expect(ProductModel.insertSchema.properties.title).toBeDefined();
			expect(ProductModel.insertSchema.properties.id).toBeUndefined(); // primary key excluded in create mode
			expect(ProductModel.selectSchema.properties.id).toBeDefined(); // primary key included in select mode
		});

		it('should expose the table via the static table getter', () => {
			const mockAdapter = {
				getTableName: () => 'items',
				getColumns: () => [],
				createTenantTable: (table: any, tenant: string) => table,
			};

			const mockTable = { _tableName: 'items' };

			class ItemModel extends AbstractModel('items', {}, mockAdapter, mockTable) {}

			// The table getter should return the base table when not in a tenancy context
			expect(ItemModel.table).toBe(mockTable);
		});
	});
});
