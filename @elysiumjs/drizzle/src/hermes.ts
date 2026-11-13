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
	InboxOwner,
	InboxPage,
	InboxQuery,
	NotificationStoreDriver,
	StoredNotification
} from '@elysiumjs/olympus/hermes';
import type { SQL } from 'drizzle-orm';
import type { BuiltPgTable } from './built-table';
import type { DrizzleStoreOptions, StoreTable } from './moirai';

import { Clock } from '@elysiumjs/olympus';
import { DEFAULT_INBOX_LIMIT, NotificationStore } from '@elysiumjs/olympus/hermes';
import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { index, jsonb, pgSchema, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { Database } from './database';

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'notification-store:drizzle': typeof DrizzleNotificationStore;
	}
}

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** The columns of the notifications table. */
const notificationColumns = () => ({
	id: text('id').primaryKey(),
	deliveryId: text('delivery_id').notNull(),
	notifiableType: text('notifiable_type'),
	notifiableId: text('notifiable_id').notNull(),
	type: text('type').notNull(),
	data: jsonb('data').$type<Record<string, unknown>>().notNull(),
	readAt: at('read_at'),
	createdAt: at('created_at').notNull()
});

/**
 * Builds the table of the notification store, in a schema when one is given. Export it from the
 * Drizzle schema so that `migration:generate` creates it.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param name The name of the table. Defaults to `notifications`.
 * @param schema The Postgres schema of the table. Defaults to the search path.
 * @example
 * ```ts
 * export const notifications = notificationsTable();
 *
 * HermesModule.with({ store: () => new DrizzleNotificationStore({ table: notifications }) });
 * ```
 */
export const notificationsTable = (name = 'notifications', schema?: string): NotificationsTable => {
	const table = (schema ? pgSchema(schema).table : pgTable) as typeof pgTable;
	return table(name, notificationColumns(), (t) => [
		uniqueIndex(`${name}_delivery_uq`).on(t.deliveryId),
		index(`${name}_notifiable_idx`).on(t.notifiableId, t.notifiableType, t.id),
		index(`${name}_unread_idx`).on(t.notifiableId, t.notifiableType).where(isNull(t.readAt))
	]);
};

/** The table `notificationsTable()` builds. */
export type NotificationsTable = BuiltPgTable<
	string,
	undefined,
	ReturnType<typeof notificationColumns>
>;

/**
 * Keeps the notifications of the `inbox` channel in a Postgres table, built with
 * `notificationsTable()` or any table with its columns.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@NotificationStore.driver('drizzle')
export class DrizzleNotificationStore implements NotificationStoreDriver {
	constructor(private readonly options: DrizzleStoreOptions<StoreTable<NotificationsTable>>) {}

	/** The table, read through the columns of the notifications table, which it has. */
	private get table(): NotificationsTable {
		return this.options.table as unknown as NotificationsTable;
	}

	/** The rows of an owner: its id, and its type or none. */
	private owned(owner: InboxOwner): SQL {
		const t = this.table;
		return and(
			eq(t.notifiableId, owner.notifiableId),
			owner.notifiableType === undefined
				? isNull(t.notifiableType)
				: eq(t.notifiableType, owner.notifiableType)
		)!;
	}

	private get db() {
		return Database.getConnection(this.options.connection);
	}

	public async save(notification: StoredNotification): Promise<void> {
		await this.db.insert(this.table).values(notification).onConflictDoNothing();
	}

	public async list(owner: InboxOwner, query: InboxQuery = {}): Promise<InboxPage> {
		const t = this.table;
		const limit = query.limit ?? DEFAULT_INBOX_LIMIT;
		const rows = await this.db
			.select()
			.from(t)
			.where(
				and(
					this.owned(owner),
					query.unread ? isNull(t.readAt) : undefined,
					query.cursor === undefined ? undefined : lt(t.id, query.cursor)
				)
			)
			.orderBy(desc(t.id))
			.limit(limit + 1);
		const items = rows.slice(0, limit);
		return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.id : null };
	}

	public async unreadCount(owner: InboxOwner): Promise<number> {
		const t = this.table;
		const [row] = await this.db
			.select({ total: count() })
			.from(t)
			.where(and(this.owned(owner), isNull(t.readAt)));
		return Number(row?.total ?? 0);
	}

	public async markAsRead(owner: InboxOwner, ids: readonly string[]): Promise<number> {
		if (ids.length === 0) return 0;
		return this.read(inArray(this.table.id, [...ids]), owner);
	}

	public async markAllAsRead(owner: InboxOwner): Promise<number> {
		return this.read(undefined, owner);
	}

	public async delete(owner: InboxOwner, ids: readonly string[]): Promise<number> {
		if (ids.length === 0) return 0;
		const t = this.table;
		const removed = await this.db
			.delete(t)
			.where(and(this.owned(owner), inArray(t.id, [...ids])))
			.returning({ id: t.id });
		return removed.length;
	}

	private async read(filter: SQL | undefined, owner: InboxOwner) {
		const t = this.table;
		const changed = await this.db
			.update(t)
			.set({ readAt: Clock.now() })
			.where(and(this.owned(owner), isNull(t.readAt), filter))
			.returning({ id: t.id });
		return changed.length;
	}
}
