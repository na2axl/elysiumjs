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

import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { ColumnMetadata, ModelAdapter } from '@elysiumjs/mnemosyne';

import { getTableConfig, pgTable } from 'drizzle-orm/pg-core';
import { AbstractModel, createSchemaFromModel } from '@elysiumjs/mnemosyne';

import { wrapTenantSchema } from './tenancy';

// ============================================================================
// Column Builder Registry
// ============================================================================

/**
 * Maps built tables to their original column builder definitions.
 *
 * When `pgTable()` is called, column builders are consumed and turned into
 * built `PgColumn` instances. Those built columns cannot be passed to
 * `pgTable()` again. This registry preserves the original builder objects
 * so that `createTenantTable` can re-create a table in a different schema.
 */
const columnBuilderRegistry = new WeakMap<object, Record<string, any>>();

/**
 * Registers a table's original column builders.
 * @param table The built table.
 * @param columns The original column builder definitions.
 */
export const registerTableColumnBuilders = (table: object, columns: Record<string, any>): void => {
	columnBuilderRegistry.set(table, columns);
};

/**
 * Retrieves the original column builders for a built table.
 * @param table The built table.
 * @returns The original column builder definitions, or `undefined`.
 */
export const getTableColumnBuilders = (table: object): Record<string, any> | undefined => {
	return columnBuilderRegistry.get(table);
};

// ============================================================================
// Column Type Mapping
// ============================================================================

/**
 * Maps a Drizzle column to a normalized data type.
 * @param col The Drizzle column to inspect.
 * @returns A normalized data type string.
 */
const mapDrizzleDataType = (col: PgColumn): ColumnMetadata['dataType'] => {
	if (col.columnType === 'PgUUID') return 'uuid';
	switch (col.dataType) {
		case 'string': return 'string';
		case 'number': return 'number';
		case 'boolean': return 'boolean';
		case 'array': return 'array';
		case 'json': return 'json';
		case 'date': return 'date';
		case 'bigint': return 'bigint';
		case 'buffer': return 'buffer';
		default: return 'string';
	}
};

// ============================================================================
// Drizzle Model Adapter
// ============================================================================

/**
 * Drizzle-specific model adapter.
 *
 * Bridges Drizzle's `PgTableWithColumns` to the framework's
 * normalized model metadata.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const drizzleAdapter: ModelAdapter<PgTableWithColumns<any>> = {
	getTableName(table) {
		return getTableConfig(table).name;
	},

	getColumns(table): ColumnMetadata[] {
		const config = getTableConfig(table);
		return config.columns.map((col: PgColumn) => ({
			name: col.name,
			dataType: mapDrizzleDataType(col),
			nullable: !col.notNull,
			hasDefault: col.hasDefault,
			isPrimaryKey: col.primary || config.primaryKeys.some(pk => pk.columns.some(c => c.name === col.name))
		}));
	},

	createTenantTable(table, tenant) {
		const builders = getTableColumnBuilders(table);
		if (!builders) {
			throw new Error(
				`No column builders registered for table. ` +
				`Use DrizzleModel() to create models with tenant support.`
			);
		}
		const config = getTableConfig(table);
		return wrapTenantSchema(tenant, config.name, builders) as PgTableWithColumns<any>;
	}
};

// ============================================================================
// Schema Helper
// ============================================================================

/**
 * Creates Elysia validation schemas from a Drizzle table.
 *
 * This is a convenience wrapper around `createSchemaFromModel` that
 * automatically extracts column metadata via the `drizzleAdapter`.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @param table The Drizzle table to generate schemas for.
 * @param opts Schema generation options.
 * @returns An Elysia validation schema.
 */
export const createSchemaFromDrizzle = (
	table: PgTableWithColumns<any>,
	opts?: { mode?: 'create' | 'update' | 'select' }
) => {
	return createSchemaFromModel(drizzleAdapter.getColumns(table), opts);
};

// ============================================================================
// DrizzleModel Mixin
// ============================================================================

/**
 * Drizzle-specific model mixin.
 *
 * Creates a model class backed by a Drizzle `pgTable`, with
 * automatic validation schema generation and tenancy support.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tableName The name of the database table.
 * @param columns The column definitions.
 * @param extraConfig Optional extra Drizzle table configuration.
 * @returns A model class with Drizzle-backed static metadata.
 */
export const DrizzleModel = <TColumnsMap extends Record<string, any>>(
	tableName: string,
	columns: TColumnsMap,
	extraConfig?: any
) => {
	const baseTable = pgTable(tableName, columns, extraConfig);
	// Store original column builders so createTenantTable can re-create the table
	registerTableColumnBuilders(baseTable, columns);
	return AbstractModel(tableName, columns, drizzleAdapter, baseTable);
};
