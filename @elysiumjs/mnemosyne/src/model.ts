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

import type { TSchema } from 'elysia';
import type { ColumnMetadata, ModelAdapter } from './interfaces';

import { Application } from '@elysiumjs/core';
import { t } from 'elysia';

import { getCurrentTenant, getTenancyStrategy } from './tenancy';

/**
 * Creates a validation schema from normalized column metadata.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param columns The column metadata to create the schema from.
 * @param options The schema generation options.
 * @returns A validation schema based on the given columns.
 */
export const createSchemaFromModel = (
	columns: ColumnMetadata[],
	{ mode = 'select' }: { mode?: 'create' | 'update' | 'select' } = {}
) => {
	if (columns === undefined || columns.length === 0) return t.Object({});

	const properties: { [key: string]: TSchema } = {};

	for (const column of columns) {
		if (['create', 'update'].includes(mode) && column.isPrimaryKey) {
			continue;
		}

		properties[column.name] = parseColumnType(column);

		if (column.nullable) {
			properties[column.name] = t.Nullable(properties[column.name]);
		}

		if (mode === 'update' || column.hasDefault || column.nullable) {
			properties[column.name] = t.Optional(properties[column.name]);
		}
	}

	return t.Object(properties);
};

/**
 * Creates a validation schema from a column's metadata.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param column The column metadata.
 * @returns A validation schema based on the given column.
 */
const parseColumnType = (column: ColumnMetadata) => {
	switch (column.dataType) {
		case 'string':
			return t.String();
		case 'uuid':
			return t.String({ format: 'uuid' });
		case 'number':
			return t.Number();
		case 'boolean':
			return t.Boolean();
		case 'array':
			return t.Array(t.Any());
		case 'json':
			return t.Object({});
		case 'date':
			return t
				.Transform(t.String({ format: 'date' }))
				.Decode((date) => new Date(date))
				.Encode((date) => date.toISOString());
		case 'datetime':
			return t
				.Transform(t.String({ format: 'date-time' }))
				.Decode((date) => new Date(date))
				.Encode((date) => date.toISOString());
		case 'bigint':
			return t.BigInt();
		case 'buffer':
			return t.File();
		default:
			return t.Never();
	}
};

/**
 * Mixin used to create a new abstract model class.
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TTable The ORM-specific table type.
 * @template TColumns The table columns configuration type.
 * @param tableName The name of the table.
 * @param columns The table columns configuration.
 * @param adapter The model adapter for the ORM.
 * @param baseTable The base ORM table instance.
 */
export const AbstractModel = <TTable, TColumns extends Record<string, unknown>>(
	tableName: string,
	columns: TColumns,
	adapter: ModelAdapter<TTable>,
	baseTable: TTable
) => {
	const columnMetadata = adapter.getColumns(baseTable);

	class M {
		/**
		 * The data type returned by the select queries.
		 */
		public static readonly $inferSelect: unknown = undefined;

		/**
		 * The data type needed by the insert queries.
		 */
		public static readonly $inferInsert: unknown = undefined;

		/**
		 * The data type needed by the update queries.
		 */
		public static readonly $inferUpdate: unknown = undefined;

		/**
		 * The ORM-specific table schema wrapped by this model.
		 * Will be automatically resolved to a tenant-scoped table when tenancy is active.
		 */
		public static get table(): TTable {
			// If we are not inside an Application context, we can't use the tenancy system
			if (!Application.instance || !Application.context.getStore) {
				return baseTable;
			}

			if (this.supportTenancy) {
				const tenant = getCurrentTenant() ?? 'public';
				if (tenant !== 'public') {
					const strategy = getTenancyStrategy();
					if (strategy) {
						return strategy.resolveTable(baseTable, tenant) as TTable;
					}
					return adapter.createTenantTable(baseTable, tenant);
				}
			}

			return baseTable;
		}

		/**
		 * The name of the table wrapped by the model.
		 */
		public static readonly tableName: string = tableName;

		/**
		 * The table columns configuration.
		 */
		public static readonly columns: TColumns = columns;

		/**
		 * The validation schema for creating records.
		 */
		public static readonly insertSchema = createSchemaFromModel(columnMetadata, { mode: 'create' });

		/**
		 * The validation schema for updating records.
		 */
		public static readonly updateSchema = createSchemaFromModel(columnMetadata, { mode: 'update' });

		/**
		 * The validation schema for selecting records.
		 */
		public static readonly selectSchema = createSchemaFromModel(columnMetadata, { mode: 'select' });

		/**
		 * Whether the model supports tenancy.
		 *
		 * Set it to `true` if the model supports tenancy. This means that the model will be
		 * wrapped by the tenancy strategy when the current tenant is not `public`.
		 */
		public static readonly supportTenancy: boolean = false;
	}

	return M;
};
