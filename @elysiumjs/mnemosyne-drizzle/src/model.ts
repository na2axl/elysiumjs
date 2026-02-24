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

import type { ColumnMetadata, ModelAdapter } from '@elysiumjs/mnemosyne';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';

import { AbstractModel, createSchemaFromModel } from '@elysiumjs/mnemosyne';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { getTableBuilders } from './table';
import { wrapTenantSchema } from './tenancy';

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
		case 'string':
			return 'string';
		case 'number':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'array':
			return 'array';
		case 'json':
			return 'json';
		case 'date':
			return 'date';
		case 'bigint':
			return 'bigint';
		case 'buffer':
			return 'buffer';
		default:
			return 'string';
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
			isPrimaryKey:
				col.primary || config.primaryKeys.some((pk) => pk.columns.some((c) => c.name === col.name))
		}));
	},

	createTenantTable(table, tenant) {
		const builders = getTableBuilders(table);
		if (!builders) {
			throw new Error(
				`No column builders registered for table. ` +
					`Use pgTable() from '@elysiumjs/mnemosyne-drizzle' for tenant support.`
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
// DrizzleModel Options
// ============================================================================

/**
 * Options for creating a DrizzleModel.
 */
export interface DrizzleModelOptions {
	/**
	 * Enable tenant schema support for this model.
	 * @default false
	 */
	supportTenancy?: boolean;
}

// ============================================================================
// DrizzleModel Function
// ============================================================================

/**
 * Creates a model class backed by a Drizzle pgTable.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @param table The Drizzle table (created with enhanced pgTable).
 * @param options Model configuration options.
 * @returns A model class with Drizzle-backed static metadata.
 */
export const DrizzleModel = <TTable extends PgTableWithColumns<any>>(
	table: TTable,
	options?: DrizzleModelOptions
) => {
	const config = getTableConfig(table);
	const builders = getTableBuilders(table);

	type TSelect = TTable['$inferSelect'];
	type TInsert = TTable['$inferInsert'];

	const Base = AbstractModel(config.name, builders ?? {}, drizzleAdapter, table);

	// Override supportTenancy if specified
	if (options?.supportTenancy !== undefined) {
		(Base as any).supportTenancy = options.supportTenancy;
	}

	return Base as typeof Base & {
		readonly $inferSelect: TSelect;
		readonly $inferInsert: TInsert;
		readonly $inferUpdate: Partial<TInsert>;
		readonly table: TTable;
	};
};
