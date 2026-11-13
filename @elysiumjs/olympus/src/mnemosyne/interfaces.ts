// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { TSchema } from '../index';
import type { RepositoryAdapter } from './repository';

// ============================================================================
// Driver
// ============================================================================

/**
 * Contract for ORM drivers.
 *
 * A database driver is responsible for creating connections, managing
 * transactions, and exposing the raw underlying client.
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TConnection The connection type managed by the driver.
 * @template TConnectionConfig The configuration used to create a connection.
 */
export interface DatabaseDriver<TConnection = unknown, TConnectionConfig = unknown> {
	/**
	 * Creates a new database connection from the given configuration.
	 * @param config The connection configuration.
	 * @param name The name of the connection, when the driver scopes resources by connection.
	 * @returns A new database connection.
	 */
	createConnection(config: TConnectionConfig, name?: string): TConnection;

	/**
	 * Executes a callback within a database transaction.
	 * @param connection The connection to use for the transaction.
	 * @param callback The function to execute within the transaction.
	 * @returns The return value of the callback.
	 */
	withTransaction<T>(
		connection: TConnection,
		callback: (tx: TConnection) => Promise<T>
	): Promise<T>;

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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface ColumnMetadata {
	/**
	 * The column name.
	 */
	name: string;

	/**
	 * The normalized data type of the column.
	 */
	dataType:
		| 'string'
		| 'number'
		| 'boolean'
		| 'date'
		| 'datetime'
		| 'json'
		| 'array'
		| 'bigint'
		| 'buffer'
		| 'uuid';

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
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TTable The ORM-specific table type.
 */
export interface ModelAdapter<TTable = unknown> {
	/**
	 * Returns the name of the given table.
	 * @param table The table to get the name of.
	 * @returns The table name.
	 */
	getTableName(table: TTable): string;

	/**
	 * Returns the default model name of the models over a table, such as the table name with
	 * its schema. Defaults to the table name.
	 * @param table The table.
	 */
	getModelName?(table: TTable): string;

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

	/**
	 * The repository adapter of the backend, which `Repository(Model)` sends its storage calls
	 * to.
	 */
	readonly repository?: RepositoryAdapter<TTable, any, any>;
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
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TTable The ORM-specific table type.
 * @template TConnection The connection type used by the strategy.
 */
export interface TenancyStrategy<TTable = unknown, TConnection = unknown> {
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface DatabaseCacheConfig {
	/**
	 * Whether caching is enabled.
	 */
	enabled?: boolean;

	/**
	 * The default TTL for cached data, in seconds. Drivers apply it to every cached result that
	 * does not set its own expiry.
	 * @default 60
	 */
	ttl?: number;

	/**
	 * The caching strategy.
	 * - `'explicit'`: Only cache queries that explicitly opt in.
	 * - `'all'`: Cache all queries automatically.
	 */
	strategy?: 'explicit' | 'all';

	/**
	 * The cache that holds the query results: `memory` (the default), or the name of a store given
	 * in `MnemosyneModule.with({ cache: { stores } })`, such as `redis`.
	 */
	storage?: 'memory' | (string & {});

	/**
	 * A prefix for every cache key, before the connection name. Set it when several applications
	 * or environments share one cache store, so that connections with the same name but different
	 * databases do not share results.
	 * @default ''
	 */
	prefix?: string;
}

// ============================================================================
// Repository
// ============================================================================

/**
 * Database primary column type.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type IdType = number | string;

/**
 * What identifies a row: the value of its primary key, or an object of the values of its key
 * columns when the key spans several columns.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RowKey = IdType | Readonly<Record<string, unknown>>;

/**
 * ORM-agnostic CRUD repository contract.
 *
 * Provides a standard interface for common database operations
 * regardless of the underlying ORM implementation.
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TSelect The type returned by select queries.
 * @template TInsert The type needed by insert queries.
 * @template TUpdate The type needed by update queries.
 * @template TId The primary key type: a value, or an object of the key columns.
 * @template TRow The column values of a record, which `findBy()` searches.
 */
export interface RepositoryInterface<TSelect, TInsert, TUpdate, TId = RowKey, TRow = TSelect> {
	/**
	 * Retrieves all the records in the database.
	 * @returns All the records in the database.
	 */
	all(): Promise<TSelect[]>;

	/**
	 * Retrieves a record by its id.
	 * @param id The id of the record to retrieve.
	 * @returns The record with the given id, or `null` if not found.
	 */
	find(id: TId): Promise<TSelect | null>;

	/**
	 * Finds the first record with a column matching the given value.
	 * @param column The column to filter by.
	 * @param value The value the column should match.
	 * @returns The first record with a column matching the given value, or `null`.
	 */
	findBy<TKey extends keyof TRow>(column: TKey, value: TRow[TKey]): Promise<TSelect | null>;

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
	 * @returns The updated record, or `null` if no record has that id.
	 */
	update(id: TId, data: TUpdate): Promise<TSelect | null>;

	/**
	 * Updates all the records in the database.
	 * @param data The data to update.
	 * @returns The updated records.
	 */
	updateAll(data: TUpdate): Promise<TSelect[]>;

	/**
	 * Deletes a record from the database.
	 * @param id The ID of the record to delete.
	 * @returns The deleted record, or `null` if no record has that id.
	 */
	delete(id: TId): Promise<TSelect | null>;

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
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TSelect The type returned by select queries.
 * @template TInsert The type needed by insert queries.
 * @template TUpdate The type needed by update queries.
 * @template TTable The ORM-specific table type.
 */
export type ModelClass<
	TSelect = unknown,
	TInsert = unknown,
	TUpdate = unknown,
	TTable = unknown
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
	 * The model adapter of the model's backend.
	 */
	readonly adapter?: ModelAdapter<TTable>;

	/**
	 * The name the model is known by in cached values and queued jobs.
	 */
	readonly modelName: string;

	/**
	 * A digest of the table's columns, part of the keys of cached rows.
	 */
	readonly schemaHash: string;

	/**
	 * The columns left out of the JSON form of the instances.
	 */
	readonly hidden: readonly string[];

	/**
	 * The getters written in the JSON form of the instances besides the columns.
	 */
	readonly appends: readonly string[];

	/**
	 * Creates an instance of the model from a row.
	 * @param row The row.
	 */
	hydrate(row: Record<string, unknown>): unknown;

	/**
	 * Creates a new instance of the model.
	 * @param args The arguments to pass to the constructor.
	 * @returns A new instance of the model.
	 */
	new (...args: any[]): unknown;
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
	new (
		...args: unknown[]
	): RepositoryInterface<InstanceType<TModel>, TModel['$inferInsert'], TModel['$inferUpdate']>;
};
