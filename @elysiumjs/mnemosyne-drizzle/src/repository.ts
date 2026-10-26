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

import type { IdType, ModelClass } from '@elysiumjs/mnemosyne';
import type { PgColumn, PgTable, PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { DrizzleConnection } from './database';

import {
	AbstractRepository,
	getCurrentTenant,
	getTenancyConfig,
	getTenancyStrategy
} from '@elysiumjs/mnemosyne';
import { eq } from 'drizzle-orm';

import { Database } from './database';
import { DrizzleRLSTenancy } from './tenancy';

// ============================================================================
// DrizzleRepository Mixin
// ============================================================================

/**
 * Drizzle-specific repository mixin with concrete CRUD operations.
 *
 * Extends the abstract repository with Drizzle query builder calls
 * for all standard CRUD methods. The model table must have an `id` column, used as the
 * primary key by `find`, `update`, `delete` and `exists`.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TModel The model class type.
 * @param model The model class to create the repository for.
 * @returns A concrete repository class with CRUD methods.
 */
export const DrizzleRepository = <
	TModel extends ModelClass<any, any, any, PgTable & { id: PgColumn }>
>(
	model: TModel
) => {
	type TSelect = TModel['$inferSelect'];
	type TInsert = TModel['$inferInsert'];
	type TUpdate = TModel['$inferUpdate'];

	/**
	 * Gets the model table, resolved for the current tenant on each call. Typed loosely for the
	 * query builders; the `id` column is guaranteed by the `TModel` constraint.
	 */
	const table = () => model.table as unknown as PgTableWithColumns<any>;

	class R extends AbstractRepository<TModel, DrizzleConnection>(model, Database) {
		/**
		 * Runs a database operation on the repository connection.
		 *
		 * In RLS tenancy mode, an operation that runs outside a transaction is wrapped in one
		 * scoped to the current tenant (through the tenancy strategy's `withIsolation`), so RLS
		 * policies apply to it. Inside an open transaction, the operation joins it, under the
		 * current tenant, and waits for tenant switches running on that transaction (see
		 * `DrizzleRLSTenancy.withIsolation`).
		 * @param operation The operation to run with the connection to use.
		 * @returns The return value of the operation.
		 */
		public async withConnection<T>(operation: (db: DrizzleConnection) => Promise<T>): Promise<T> {
			const name = (this.constructor as typeof R).connection;
			if (getTenancyConfig().mode !== 'rls') return operation(this.db);

			const strategy = getTenancyStrategy() ?? new DrizzleRLSTenancy();
			return strategy.withIsolation(
				Database.getBaseConnection(name),
				getCurrentTenant() ?? 'public',
				() => operation(this.db)
			);
		}

		public async all(): Promise<TSelect[]> {
			return this.withConnection((db) => db.select().from(table()));
		}

		public async paginate(
			count: number,
			page: number = 1
		): Promise<{ page: number; data: TSelect[]; total: number }> {
			const offset = Math.max(page - 1, 0) * count;
			return this.withConnection(async (db) => ({
				page,
				total: await db.$count(table()),
				data: await db.select().from(table()).offset(offset).limit(count)
			}));
		}

		public async find(id: IdType): Promise<TSelect | null> {
			const [row] = await this.withConnection((db) =>
				db.select().from(table()).where(eq(table().id, id))
			);
			return (row ?? null) as TSelect | null;
		}

		public async findBy<TKey extends keyof TSelect>(
			column: TKey,
			value: TSelect[TKey]
		): Promise<TSelect | null> {
			const [row] = await this.withConnection((db) =>
				db.select().from(table()).where(eq(table()[column], value))
			);
			return (row ?? null) as TSelect | null;
		}

		public async insert(data: TInsert): Promise<TSelect> {
			const [row] = await this.withConnection((db) => db.insert(table()).values(data).returning());
			return row as TSelect;
		}

		public async update(id: IdType, data: TUpdate): Promise<TSelect | null> {
			const [row] = await this.withConnection((db) =>
				db.update(table()).set(data).where(eq(table().id, id)).returning()
			);
			return (row ?? null) as TSelect | null;
		}

		public async updateAll(data: TUpdate): Promise<TSelect[]> {
			return this.withConnection((db) => db.update(table()).set(data).returning());
		}

		public async delete(id: IdType): Promise<TSelect | null> {
			const [row] = await this.withConnection((db) =>
				db.delete(table()).where(eq(table().id, id)).returning()
			);
			return (row ?? null) as TSelect | null;
		}

		public async deleteAll(): Promise<TSelect[]> {
			return this.withConnection((db) => db.delete(table()).returning());
		}

		public async exists(id: IdType): Promise<boolean> {
			const count = await this.withConnection((db) => db.$count(table(), eq(table().id, id)));
			return count > 0;
		}
	}

	return R;
};
