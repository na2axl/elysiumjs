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

import type { TenancyStrategy } from '@elysiumjs/mnemosyne';
import type { PgColumnBuilderBase, PgSchema, PgTable, PgTransaction } from 'drizzle-orm/pg-core';
import type { DrizzleConnection } from './database';

import { getTenancyConfig } from '@elysiumjs/mnemosyne';
import { sql } from 'drizzle-orm';
import { getTableConfig, pgPolicy, pgSchema, pgTable } from 'drizzle-orm/pg-core';

import { Database } from './database';
import { getTableColumnBuilders } from './model';

// ============================================================================
// Internal State
// ============================================================================

const tenantSchemas: Map<string, PgTable> = new Map();
const schemaRegistry: Map<string, PgSchema> = new Map();

// ============================================================================
// Schema-based Tenancy Helpers
// ============================================================================

/**
 * Returns the Drizzle `PgSchema` for the given tenant, creating it if needed.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The tenant identifier.
 * @returns The tenant's PostgreSQL schema.
 */
export const getTenantSchema = (tenant: string): PgSchema => {
	return schemaRegistry.get(tenant) ?? registerTenantSchema(tenant);
};

/**
 * Registers a new tenant schema in the registry.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The tenant identifier.
 * @returns The newly registered (or existing) `PgSchema`.
 */
export const registerTenantSchema = (tenant: string): PgSchema => {
	if (schemaRegistry.has(tenant)) {
		return schemaRegistry.get(tenant)!;
	}
	const tenantSchema = pgSchema(tenant);
	schemaRegistry.set(tenant, tenantSchema);
	return tenantSchema;
};

/**
 * Wraps a table definition in a tenant-specific schema.
 *
 * For the `'public'` tenant, returns a standard `pgTable`.
 * For other tenants, creates a schema-qualified table and caches it.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The tenant identifier.
 * @param tableName The table name.
 * @param columns The column definitions.
 * @returns A tenant-scoped `PgTable`.
 */
export const wrapTenantSchema = <
	TTableName extends string,
	TColumnsMap extends Record<string, PgColumnBuilderBase>
>(
	tenant: string,
	tableName: TTableName,
	columns: TColumnsMap
): PgTable => {
	if (tenant === 'public') {
		return pgTable(tableName, columns);
	}

	const fullTableName = `${tenant}.${tableName}`;
	if (tenantSchemas.has(fullTableName)) {
		return tenantSchemas.get(fullTableName)!;
	}

	const tenantSchema = getTenantSchema(tenant);
	const schemaTable = tenantSchema.table(tableName, columns);
	tenantSchemas.set(fullTableName, schemaTable);

	return schemaTable;
};

// ============================================================================
// RLS-based Tenancy Helpers
// ============================================================================

/**
 * Executes a callback within an RLS-scoped transaction for the given tenant.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The tenant identifier (or `null` for 'public').
 * @param callback The function to execute within the transaction.
 * @param connectionName The database connection name.
 * @returns The return value of the callback.
 */
export const withRLS = async <T>(
	tenant: string | null,
	callback: (tx: PgTransaction<any, any, any>) => Promise<T>,
	connectionName: string = 'default'
): Promise<T> => {
	const db = Database.getConnection(connectionName);
	const config = getTenancyConfig();
	const varName = config.rls?.sessionVariable ?? 'app.current_tenant';
	const value = tenant ?? 'public';

	return (db as any).transaction(async (tx: PgTransaction<any, any, any>) => {
		await tx.execute(sql`SELECT set_config(${varName}, ${value}, true)`);
		return callback(tx);
	});
};

/**
 * Sets the current tenant on a persistent database connection (session-level).
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The tenant identifier (or `null` for 'public').
 * @param connectionName The database connection name.
 */
export const setConnectionTenant = async (
	tenant: string | null,
	connectionName: string = 'default'
): Promise<void> => {
	const db = Database.getConnection(connectionName);
	const config = getTenancyConfig();
	const varName = config.rls?.sessionVariable ?? 'app.current_tenant';
	const value = tenant ?? 'public';

	await (db as any).execute(sql`SELECT set_config(${varName}, ${value}, false)`);
};

/**
 * Reads the current tenant from the PostgreSQL session variable.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param connectionName The database connection name.
 * @returns The current tenant identifier, or `null`.
 */
export const getSessionTenant = async (
	connectionName: string = 'default'
): Promise<string | null> => {
	const db = Database.getConnection(connectionName);
	const config = getTenancyConfig();
	const varName = config.rls?.sessionVariable ?? 'app.current_tenant';

	const result = await (db as any).execute(sql`SELECT current_setting(${varName}, true) as tenant`);
	return (result as any)?.rows?.[0]?.tenant ?? null;
};

/**
 * Creates an RLS policy for tenant isolation on a table.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tableName The table name.
 * @param columnName The tenant column name (defaults to config or 'tenant_id').
 * @param policyName The policy name (defaults to `{tableName}_tenant_isolation`).
 * @returns A Drizzle `PgPolicy` instance.
 */
export const createRLSPolicy = (tableName: string, columnName?: string, policyName?: string) => {
	const config = getTenancyConfig();
	const varName = config.rls?.sessionVariable ?? 'app.current_tenant';
	const column = columnName ?? config.rls?.defaultColumn ?? 'tenant_id';
	const name = policyName ?? `${tableName}_tenant_isolation`;

	return pgPolicy(name, {
		for: 'all',
		to: 'public',
		using: sql`${sql.identifier(column)} = current_setting(${varName}, true)::text`,
		withCheck: sql`${sql.identifier(column)} = current_setting(${varName}, true)::text`
	});
};

// ============================================================================
// TenancyStrategy Implementations
// ============================================================================

/**
 * Schema-based tenancy strategy for Drizzle.
 *
 * Each tenant gets its own PostgreSQL schema. Table resolution maps
 * the base table to a schema-qualified equivalent.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DrizzleSchemaTenancy implements TenancyStrategy<PgTable, DrizzleConnection> {
	readonly mode = 'schema';

	resolveTable(table: PgTable, tenant: string): PgTable {
		const builders = getTableColumnBuilders(table);
		if (!builders) {
			throw new Error(
				`No column builders registered for table. ` +
					`Use DrizzleModel() to create models with tenant support.`
			);
		}
		const config = getTableConfig(table as any);
		return wrapTenantSchema(tenant, config.name, builders) as PgTable;
	}

	async withIsolation<T>(
		_connection: DrizzleConnection,
		_tenant: string,
		callback: () => Promise<T>
	): Promise<T> {
		// Schema-based isolation doesn't need transaction wrapping
		return callback();
	}
}

/**
 * Row-Level Security tenancy strategy for Drizzle.
 *
 * All tenants share the same schema. Isolation is achieved via
 * PostgreSQL RLS policies and a session variable set in each transaction.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DrizzleRLSTenancy implements TenancyStrategy<PgTable, DrizzleConnection> {
	readonly mode = 'rls';

	resolveTable(table: PgTable, _tenant: string): PgTable {
		// RLS doesn't modify the table - filtering is handled by policies
		return table;
	}

	async withIsolation<T>(
		connection: DrizzleConnection,
		tenant: string,
		callback: () => Promise<T>
	): Promise<T> {
		const config = getTenancyConfig();
		const varName = config.rls?.sessionVariable ?? 'app.current_tenant';

		return (connection as any).transaction(async (tx: PgTransaction<any, any, any>) => {
			await tx.execute(sql`SELECT set_config(${varName}, ${tenant}, true)`);
			return callback();
		});
	}
}
