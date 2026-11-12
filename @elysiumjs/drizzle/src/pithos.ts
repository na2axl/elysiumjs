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

import type {
	FileCondition,
	FilePatch,
	FileRecord,
	FileStatus,
	FileStoreDriver
} from '@elysiumjs/olympus/pithos';
import type { DrizzleStoreOptions, StoreTable } from './moirai';

import { FileStore } from '@elysiumjs/olympus/pithos';
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { bigint, index, pgSchema, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { Database } from './database';

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'file-store:drizzle': typeof DrizzleFileStore;
	}
}

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Builds the table of the file store, in a schema when one is given. Export it from the Drizzle
 * schema so that `migration:generate` creates it.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param name The name of the table. Defaults to `files`.
 * @param schema The Postgres schema of the table. Defaults to the search path.
 * @example
 * ```ts
 * export const files = filesTable();
 *
 * PithosModule.with({ disks, files: { store: () => FileStore.for('drizzle', { table: files }) } });
 * ```
 */
export const filesTable = (name = 'files', schema?: string) => {
	const table = (schema ? pgSchema(schema).table : pgTable) as typeof pgTable;
	return table(
		name,
		{
			id: text('id').primaryKey(),
			purpose: text('purpose').notNull(),
			disk: text('disk').notNull(),
			key: text('key').notNull(),
			contentType: text('content_type').notNull(),
			size: bigint('size', { mode: 'number' }).notNull(),
			ownerType: text('owner_type').notNull(),
			ownerId: text('owner_id').notNull(),
			createdBy: text('created_by'),
			status: text('status').$type<FileStatus>().notNull(),
			createdAt: at('created_at').notNull(),
			readyAt: at('ready_at'),
			claimedAt: at('claimed_at'),
			releasedAt: at('released_at'),
			expiresAt: at('expires_at'),
			deletedAt: at('deleted_at'),
			rejection: text('rejection')
		},
		(t) => [
			index(`${name}_owner_idx`).on(t.ownerType, t.ownerId),
			// The cap on uploads in progress reads the pending files of one person.
			index(`${name}_pending_idx`)
				.on(t.createdBy, t.expiresAt)
				.where(sql`${t.status} = 'pending'`),
			// Pruning reads the files whose time is over.
			index(`${name}_due_idx`)
				.on(t.expiresAt)
				.where(sql`${t.status} in ('pending', 'ready') and ${t.expiresAt} is not null`)
		]
	);
};

/** The table `filesTable()` builds. */
export type FilesTable = ReturnType<typeof filesTable>;

type FileRow = FilesTable['$inferSelect'];

const toRecord = ({ ownerType, ownerId, ...row }: FileRow): FileRecord => ({
	...row,
	owner: { type: ownerType, id: ownerId }
});

/**
 * Keeps file records in a Postgres table, built with `filesTable()` or any table with its
 * columns. Each transition is one conditional `UPDATE`, so only one of two racing requests wins.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@FileStore.driver('drizzle')
export class DrizzleFileStore implements FileStoreDriver {
	constructor(private readonly options: DrizzleStoreOptions<StoreTable<FilesTable>>) {}

	/** The table, read through the columns of the files table, which it has. */
	private get table(): FilesTable {
		return this.options.table as unknown as FilesTable;
	}

	private get db() {
		return Database.getConnection(this.options.connection);
	}

	public async insert({ owner, ...record }: FileRecord): Promise<void> {
		await this.db
			.insert(this.table)
			.values({ ...record, ownerType: owner.type, ownerId: owner.id });
	}

	public async find(id: string): Promise<FileRecord | null> {
		const [row] = await this.db.select().from(this.table).where(eq(this.table.id, id)).limit(1);
		return row ? toRecord(row) : null;
	}

	public async transition(
		id: string,
		when: FileCondition,
		patch: FilePatch
	): Promise<FileRecord | null> {
		const t = this.table;
		const condition = and(
			eq(t.id, id),
			inArray(t.status, [...when.status]),
			when.due === undefined ? undefined : lte(t.expiresAt, when.due),
			when.live === undefined ? undefined : or(isNull(t.expiresAt), gt(t.expiresAt, when.live))
		);
		// An empty patch changes nothing: it answers whether the record meets the condition.
		const [row] =
			Object.keys(patch).length === 0
				? await this.db.select().from(t).where(condition).limit(1)
				: await this.db.update(t).set(patch).where(condition).returning();
		return row ? toRecord(row) : null;
	}

	public async countPending(createdBy: string, now: Date): Promise<number> {
		const t = this.table;
		const [row] = await this.db
			.select({ total: count() })
			.from(t)
			.where(and(eq(t.createdBy, createdBy), eq(t.status, 'pending'), gt(t.expiresAt, now)));
		return Number(row?.total ?? 0);
	}

	public async due(now: Date, limit: number): Promise<FileRecord[]> {
		const t = this.table;
		const rows = await this.db
			.select()
			.from(t)
			.where(
				and(inArray(t.status, ['pending', 'ready']), isNotNull(t.expiresAt), lte(t.expiresAt, now))
			)
			.orderBy(asc(t.expiresAt))
			.limit(limit);
		return rows.map(toRecord);
	}
}
