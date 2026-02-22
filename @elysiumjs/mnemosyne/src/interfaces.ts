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

import type { TSchema } from 'elysia';

// ============================================================================
// Driver
// ============================================================================

/**
 * Contract for ORM drivers.
 *
 * A database driver is responsible for creating connections, managing
 * transactions, and exposing the raw underlying client.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TConnection The connection type managed by the driver.
 * @template TConnectionConfig The configuration used to create a connection.
 */
export interface DatabaseDriver<TConnection, TConnectionConfig> {
	/**
	 * Creates a new database connection from the given configuration.
	 * @param config The connection configuration.
	 * @returns A new database connection.
	 */
	createConnection(config: TConnectionConfig): TConnection;

	/**
	 * Executes a callback within a database transaction.
	 * @param connection The connection to use for the transaction.
	 * @param callback The function to execute within the transaction.
	 * @returns The return value of the callback.
	 */
	withTransaction<T>(connection: TConnection, callback: (tx: TConnection) => Promise<T>): Promise<T>;

	/**
	 * Returns the raw underlying client from a connection.
	 * @param connection The connection to extract the raw client from.
	 * @returns The raw client instance.
	 */
	getRawClient(connection: TConnection): unknown;
}

// ============================================================================
// Model Adapter
// ============================================================================

/**
 * Normalized column metadata for a table.
 *
 * Provides an ORM-agnostic description of a column's name, type,
 * nullability, default status, and primary key status.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface ColumnMetadata {
	/**
	 * The column name.
	 */
	name: string;

	/**
	 * The normalized data type of the column.
	 */
	dataType: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'json' | 'array' | 'bigint' | 'buffer' | 'uuid';

	/**
	 * Whether the column allows `NULL` values.
	 */
	nullable: boolean;

	/**
	 * Whether the column has a default value.
	 */
	hasDefault: boolean;

	/**
	 * Whether the column is a primary key.
	 */
	isPrimaryKey: boolean;
}

/**
 * Bridges ORM-specific table schemas to framework metadata.
 *
 * A model adapter translates between the ORM's internal table
 * representation and the normalized metadata used by the framework.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TTable The ORM-specific table type.
 */
export interface ModelAdapter<TTable> {
	/**
	 * Returns the name of the given table.
	 * @param table The table to get the name of.
	 * @returns The table name.
	 */
	getTableName(table: TTable): string;

	/**
	 * Returns the normalized column metadata for the given table.
	 * @param table The table to extract columns from.
	 * @returns An array of column metadata.
	 */
	getColumns(table: TTable): ColumnMetadata[];

	/**
	 * Creates a tenant-scoped copy of the given table.
	 * @param table The original table.
	 * @param tenant The tenant identifier.
	 * @returns A new table scoped to the given tenant.
	 */
	createTenantTable(table: TTable, tenant: string): TTable;
}

// ============================================================================
// Tenancy
// ============================================================================

/**
 * Contract for tenancy strategies.
 *
 * A tenancy strategy determines how tables and connections are
 * scoped to a specific tenant.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TTable The ORM-specific table type.
 * @template TConnection The connection type used by the strategy.
 */
export interface TenancyStrategy<TTable, TConnection> {
	/**
	 * The tenancy mode identifier (e.g. `'schema'`, `'rls'`).
	 */
	readonly mode: string;

	/**
	 * Resolves a table to its tenant-scoped equivalent.
	 * @param table The original table.
	 * @param tenant The tenant identifier.
	 * @returns The tenant-scoped table.
	 */
	resolveTable(table: TTable, tenant: string): TTable;

	/**
	 * Executes a callback with tenant-level isolation applied to the connection.
	 * @param connection The database connection.
	 * @param tenant The tenant identifier.
	 * @param callback The function to execute within the isolated context.
	 * @returns The return value of the callback.
	 */
	withIsolation<T>(connection: TConnection, tenant: string, callback: () => Promise<T>): Promise<T>;
}

// ============================================================================
// Cache
// ============================================================================

/**
 * Contract for database query cache strategies.
 *
 * Implementations are responsible for storing, retrieving, and
 * invalidating cached query results.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface DatabaseCacheStrategy {
	/**
	 * Retrieves a cached query result by key.
	 * @param key The cache key.
	 * @returns The cached result, or `undefined` if not found.
	 */
	get(key: string): Promise<unknown[] | undefined>;

	/**
	 * Stores a query result in the cache.
	 * @param key The cache key.
	 * @param response The query result to cache.
	 * @param tables The tables involved in the query.
	 * @param config Optional cache configuration.
	 */
	put(key: string, response: unknown[], tables: string[], config?: { ttl?: number }): Promise<void>;

	/**
	 * Invalidates cached entries affected by a mutation.
	 * @param params The tables and/or tags affected by the mutation.
	 */
	onMutate(params: { tables?: string[]; tags?: string[] }): Promise<void>;
}

/**
 * Configuration for database query caching.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface DatabaseCacheConfig {
	/**
	 * Whether caching is enabled.
	 */
	enabled?: boolean;

	/**
	 * The default TTL for cached data, in seconds.
	 */
	ttl?: number;

	/**
	 * The caching strategy.
	 * - `'explicit'`: Only cache queries that explicitly opt in.
	 * - `'all'`: Cache all queries automatically.
	 */
	strategy?: 'explicit' | 'all';

	/**
	 * The storage engine to use for the cache.
	 */
	storage?: 'redis' | 'memory';
}

// ============================================================================
// Repository
// ============================================================================

/**
 * Database primary column type.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type IdType = number | string;

/**
 * ORM-agnostic CRUD repository contract.
 *
 * Provides a standard interface for common database operations
 * regardless of the underlying ORM implementation.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TSelect The type returned by select queries.
 * @template TInsert The type needed by insert queries.
 * @template TUpdate The type needed by update queries.
 * @template TId The primary key type.
 */
export interface RepositoryInterface<TSelect, TInsert, TUpdate, TId extends IdType = string> {
	/**
	 * Retrieves all the records in the database.
	 * @returns All the records in the database.
	 */
	all(): Promise<TSelect[]>;

	/**
	 * Retrieves a paginated subset of the records in the database.
	 * @param count The number of records per page.
	 * @param page The page number to retrieve.
	 * @returns A paginated response containing the records and the total count.
	 */
	paginate(count: number, page: number): Promise<{ page: number; data: TSelect[]; total: number }>;

	/**
	 * Retrieves a record by its id.
	 * @param id The id of the record to retrieve.
	 * @returns The record with the given id, or `null` if not found.
	 */
	find(id: TId): Promise<TSelect | null>;

	/**
	 * Inserts a new record in the database.
	 * @param data The data to insert.
	 * @returns The inserted record.
	 */
	insert(data: TInsert): Promise<TSelect>;

	/**
	 * Updates a record in the database.
	 * @param id The id of the record to update.
	 * @param data The data to update.
	 * @returns The updated record.
	 */
	update(id: TId, data: TUpdate): Promise<TSelect>;

	/**
	 * Updates all the records in the database.
	 * @param data The data to update.
	 * @returns The updated records.
	 */
	updateAll(data: TUpdate): Promise<TSelect[]>;

	/**
	 * Deletes a record from the database.
	 * @param id The ID of the record to delete.
	 * @returns The deleted record.
	 */
	delete(id: TId): Promise<TSelect>;

	/**
	 * Deletes all the records from the database.
	 * @returns All the deleted records.
	 */
	deleteAll(): Promise<TSelect[]>;

	/**
	 * Checks if a record exists in the database.
	 * @param id The ID of the record to check.
	 * @returns `true` if the record exists, `false` otherwise.
	 */
	exists(id: TId): Promise<boolean>;
}

// ============================================================================
// Model Class
// ============================================================================

/**
 * Shape of a model class.
 *
 * Describes the static interface that a model class must expose,
 * including inferred types, table metadata, and validation schemas.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TSelect The type returned by select queries.
 * @template TInsert The type needed by insert queries.
 * @template TUpdate The type needed by update queries.
 * @template TTable The ORM-specific table type.
 */
export type ModelClass<
	TSelect = unknown,
	TInsert = unknown,
	TUpdate = unknown,
	TTable = unknown,
> = {
	/**
	 * The data type returned by select queries.
	 */
	readonly $inferSelect: TSelect;

	/**
	 * The data type needed by insert queries.
	 */
	readonly $inferInsert: TInsert;

	/**
	 * The data type needed by update queries.
	 */
	readonly $inferUpdate: TUpdate;

	/**
	 * The ORM-specific table schema wrapped by this model.
	 */
	readonly table: TTable;

	/**
	 * The name of the table wrapped by the model.
	 */
	readonly tableName: string;

	/**
	 * The table columns configuration.
	 */
	readonly columns: Record<string, unknown>;

	/**
	 * The validation schema for creating records.
	 */
	readonly insertSchema: TSchema;

	/**
	 * The validation schema for updating records.
	 */
	readonly updateSchema: TSchema;

	/**
	 * The validation schema for selecting records.
	 */
	readonly selectSchema: TSchema;

	/**
	 * Whether the model supports tenancy.
	 */
	readonly supportTenancy: boolean;

	/**
	 * Creates a new instance of the model.
	 * @param args The arguments to pass to the constructor.
	 * @returns A new instance of the model.
	 */
	new (...args: unknown[]): unknown;
};

// ============================================================================
// Repository Class
// ============================================================================

/**
 * Shape of a repository class.
 *
 * Describes the static interface that a repository class must expose,
 * including the associated model and connection name.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TModel The model class type wrapped by the repository.
 */
export type RepositoryClass<TModel extends ModelClass = ModelClass> = {
	/**
	 * The model class wrapped by this repository.
	 */
	readonly Model: TModel;

	/**
	 * The database connection name to use in the repository.
	 */
	readonly connection: string;

	/**
	 * Creates a new instance of the repository.
	 * @param args The arguments to pass to the constructor.
	 * @returns A new repository instance.
	 */
	new (...args: unknown[]): RepositoryInterface<
		TModel['$inferSelect'],
		TModel['$inferInsert'],
		TModel['$inferUpdate']
	>;
};
