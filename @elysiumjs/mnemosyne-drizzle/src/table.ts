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

import type { PgColumnBuilderBase, PgTableWithColumns } from 'drizzle-orm/pg-core';

import { pgTable as drizzlePgTable } from 'drizzle-orm/pg-core';

// ============================================================================
// Column Builder Registry
// ============================================================================

/**
 * Maps tables to their original column builder definitions.
 *
 * When `pgTable()` is called, column builders are consumed and turned into
 * built `PgColumn` instances. This registry preserves the original builder
 * objects so that tenant tables can be re-created in different schemas.
 */
const tableRegistry = new WeakMap<PgTableWithColumns<any>, Record<string, PgColumnBuilderBase>>();

/**
 * Retrieves the original column builders for a table.
 * @param table The table created with enhanced pgTable.
 * @returns The original column builder definitions, or `undefined`.
 */
export const getTableBuilders = (
	table: PgTableWithColumns<any>
): Record<string, PgColumnBuilderBase> | undefined => {
	return tableRegistry.get(table);
};

// ============================================================================
// Enhanced pgTable Function
// ============================================================================

/**
 * Creates a PostgreSQL table with automatic column builder registration.
 *
 * This is an enhanced version of Drizzle's `pgTable` that automatically
 * registers column builders for tenancy support. It has the exact same
 * signature and behavior as the original.
 *
 * @param tableName The name of the database table.
 * @param columns The column definitions.
 * @param extraConfig Optional extra Drizzle table configuration.
 * @returns A Drizzle PostgreSQL table with registered column builders.
 */
export const pgTable = <
	TTableName extends string,
	TColumns extends Record<string, PgColumnBuilderBase>
>(
	tableName: TTableName,
	columns: TColumns,
	extraConfig?: (table: any) => any
): PgTableWithColumns<{
	[K in keyof TColumns]: TColumns[K] extends PgColumnBuilderBase<infer T> ? T : never;
}> => {
	const table = drizzlePgTable(tableName, columns, extraConfig);
	tableRegistry.set(table, columns);
	return table as any;
};
