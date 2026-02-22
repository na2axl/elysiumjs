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
import type { PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { DrizzleConnection } from './database';

import { AbstractRepository } from '@elysiumjs/mnemosyne';
import { eq } from 'drizzle-orm';

import { Database } from './database';

// ============================================================================
// DrizzleRepository Mixin
// ============================================================================

/**
 * Drizzle-specific repository mixin with concrete CRUD operations.
 *
 * Extends the abstract repository with Drizzle query builder calls
 * for all standard CRUD methods.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TModel The model class type.
 * @param model The model class to create the repository for.
 * @returns A concrete repository class with CRUD methods.
 */
export const DrizzleRepository = <
	TModel extends ModelClass<any, any, any, PgTableWithColumns<any>>
>(
	model: TModel
) => {
	type TSelect = TModel['$inferSelect'];
	type TInsert = TModel['$inferInsert'];
	type TUpdate = TModel['$inferUpdate'];

	class R extends AbstractRepository<TModel, DrizzleConnection>(model, Database) {
		public async all(): Promise<TSelect[]> {
			return await this.db.select().from(model.table);
		}

		public async paginate(
			count: number,
			page: number = 1
		): Promise<{ page: number; data: TSelect[]; total: number }> {
			const total = await this.db.$count(model.table);
			const offset = Math.max(page - 1, 0) * count;
			return {
				page,
				total,
				data: await this.db.select().from(model.table).offset(offset).limit(count)
			};
		}

		public async find(id: IdType): Promise<TSelect | null> {
			const [row] = await this.db.select().from(model.table).where(eq(model.table.id, id));
			return (row ?? null) as TSelect | null;
		}

		public async findBy<TKey extends keyof TSelect>(
			column: TKey,
			value: TSelect[TKey]
		): Promise<TSelect | null> {
			const [row] = await this.db.select().from(model.table).where(eq(model.table[column], value));
			return (row ?? null) as TSelect | null;
		}

		public async insert(data: TInsert): Promise<TSelect> {
			const [row] = await this.db.insert(model.table).values(data).returning();
			return row as TSelect;
		}

		public async update(id: IdType, data: TUpdate): Promise<TSelect> {
			const [row] = await this.db
				.update(model.table)
				.set(data)
				.where(eq(model.table.id, id))
				.returning();
			return row as TSelect;
		}

		public async updateAll(data: TUpdate): Promise<TSelect[]> {
			return await this.db.update(model.table).set(data).returning();
		}

		public async delete(id: IdType): Promise<TSelect> {
			const [row] = await this.db.delete(model.table).where(eq(model.table.id, id)).returning();
			return row as TSelect;
		}

		public async deleteAll(): Promise<TSelect[]> {
			return await this.db.delete(model.table).returning();
		}

		public async exists(id: IdType): Promise<boolean> {
			const count = await this.db.$count(model.table, eq(model.table.id, id));
			return count > 0;
		}
	}

	return R;
};
