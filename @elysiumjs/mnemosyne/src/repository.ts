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

import type { AbstractDatabase } from './database';
import type { IdType, ModelClass, RepositoryInterface } from './interfaces';

/**
 * Mixin used to create a new abstract repository class over a model.
 *
 * All CRUD methods are abstract and must be implemented by driver-specific
 * subclasses.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TModel The type of the model class wrapped by the repository.
 * @template TConnection The database connection type.
 * @param model The model class wrapped by the repository.
 * @param database The database manager instance.
 */
export const AbstractRepository = <TModel extends ModelClass, TConnection>(
	model: TModel,
	database: AbstractDatabase<TConnection, any>
) => {
	type TSelect = TModel['$inferSelect'];
	type TInsert = TModel['$inferInsert'];
	type TUpdate = TModel['$inferUpdate'];

	abstract class R implements RepositoryInterface<TSelect, TInsert, TUpdate> {
		/**
		 * The model class wrapped by this repository.
		 */
		public static readonly Model: TModel = model;

		/**
		 * The database connection name to use.
		 *
		 * Update this value to change the database connection used by this repository.
		 */
		public static readonly connection: string = 'default';

		/**
		 * The database connection used by this repository.
		 */
		public get db(): TConnection {
			return database.getConnection((this.constructor as typeof R).connection);
		}

		/**
		 * Retrieves all the records in the database.
		 * @returns All the records in the database.
		 */
		public abstract all(): Promise<TSelect[]>;

		/**
		 * Get a paginated subset of the records in the database.
		 * @param count The number of records to retrieve per page.
		 * @param page The page number to retrieve.
		 * @returns A paginated response containing the records and the total number of records.
		 */
		public abstract paginate(
			count: number,
			page?: number
		): Promise<{ page: number; data: TSelect[]; total: number }>;

		/**
		 * Retrieves a record by its id.
		 * @param id The id of the record to retrieve.
		 * @returns The record with the given id, or `null` if not found.
		 */
		public abstract find(id: IdType): Promise<TSelect | null>;

		/**
		 * Finds the first record with a column matching the given value.
		 * @param column The column to filter by.
		 * @param value The value the column should match.
		 * @returns The first record with a column matching the given value.
		 */
		public abstract findBy<TKey extends keyof TSelect>(
			column: TKey,
			value: TSelect[TKey]
		): Promise<TSelect | null>;

		/**
		 * Inserts a new record in the database.
		 * @param data The data to insert.
		 * @returns The inserted record.
		 */
		public abstract insert(data: TInsert): Promise<TSelect>;

		/**
		 * Updates a record in the database.
		 * @param id The id of the record to update.
		 * @param data The data to update.
		 * @returns The updated record.
		 */
		public abstract update(id: IdType, data: TUpdate): Promise<TSelect>;

		/**
		 * Updates all the records in the database.
		 * @param data The data to update.
		 * @returns The updated records.
		 */
		public abstract updateAll(data: TUpdate): Promise<TSelect[]>;

		/**
		 * Deletes a record from the database.
		 * @param id The ID of the record to delete.
		 * @returns The deleted record.
		 */
		public abstract delete(id: IdType): Promise<TSelect>;

		/**
		 * Deletes all the records from the database.
		 * @returns All the deleted records.
		 */
		public abstract deleteAll(): Promise<TSelect[]>;

		/**
		 * Checks if a record exists in the database.
		 * @param id The ID of the record to check.
		 * @returns True if the record exists, false otherwise.
		 */
		public abstract exists(id: IdType): Promise<boolean>;
	}

	return R;
};
