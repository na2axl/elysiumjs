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

import { Clock } from '../clock';
import { Port } from '../port';

/**
 * A notification kept by the `inbox` channel.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StoredNotification = {
	/** Its id: sortable by the time it was kept. */
	readonly id: string;
	/** The id of the delivery that kept it: keeping the same delivery again changes nothing. */
	readonly deliveryId: string;
	/** The `notifiableType` of who it belongs to, or `null`. */
	readonly notifiableType: string | null;
	/** Who it belongs to. */
	readonly notifiableId: string;
	/** The type of the notification. */
	readonly type: string;
	/** The data of its `InboxMessage`. */
	readonly data: Record<string, unknown>;
	/** When it was read, or `null`. */
	readonly readAt: Date | null;
	/** When it was kept. */
	readonly createdAt: Date;
};

/**
 * Whose inbox: a `notifiableId`, and the `notifiableType` when notifiables have one, since two
 * types may share ids. A notifiable with an id fits.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type InboxOwner = { readonly notifiableId: string; readonly notifiableType?: string };

/** The `notifiableType` of an owner, as it is stored. */
export const ownerType = (owner: InboxOwner): string | null => owner.notifiableType ?? null;

/**
 * A page of an inbox, newest first.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type InboxPage = {
	readonly items: StoredNotification[];
	/** The cursor of the next page, or `null` on the last one. */
	readonly nextCursor: string | null;
};

/**
 * What an inbox page is asked with.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type InboxQuery = {
	/** Only the unread notifications. */
	readonly unread?: boolean;
	/** The `nextCursor` of the previous page. */
	readonly cursor?: string;
	/** The size of a page. Defaults to 20. */
	readonly limit?: number;
};

/**
 * Keeps the notifications of the `inbox` channel. `memory` is built in; `@elysiumjs/drizzle`
 * provides a PostgreSQL store.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface NotificationStoreDriver {
	/** Keeps a notification; keeping the same delivery id again changes nothing. */
	save(notification: StoredNotification): Promise<void>;

	/** A page of the notifications of an owner, newest first. */
	list(owner: InboxOwner, query?: InboxQuery): Promise<InboxPage>;

	/** How many notifications of an owner are unread. */
	unreadCount(owner: InboxOwner): Promise<number>;

	/** Marks notifications of an owner as read, and answers how many changed. */
	markAsRead(owner: InboxOwner, ids: readonly string[]): Promise<number>;

	/** Marks every notification of an owner as read, and answers how many changed. */
	markAllAsRead(owner: InboxOwner): Promise<number>;

	/** Deletes notifications of an owner, and answers how many were deleted. */
	delete(owner: InboxOwner, ids: readonly string[]): Promise<number>;
}

declare module '../port' {
	interface Ports {
		'notification-store': NotificationStoreDriver;
	}

	interface PortDrivers {
		'notification-store:memory': typeof MemoryNotificationStore;
	}
}

/**
 * The notification store port. `memory` is built in, and is the default of `HermesModule`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * HermesModule.with({ store: () => NotificationStore.for('memory') });
 * ```
 */
export class NotificationStore extends Port('notification-store') {}

/** The default size of an inbox page. */
export const DEFAULT_INBOX_LIMIT = 20;

/**
 * Keeps notifications in memory, for tests and development: they are lost when the process ends.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@NotificationStore.driver('memory')
export class MemoryNotificationStore implements NotificationStoreDriver {
	readonly #rows = new Map<string, StoredNotification>();

	public async save(notification: StoredNotification): Promise<void> {
		const kept = [...this.#rows.values()].some((row) => row.deliveryId === notification.deliveryId);
		if (!kept && !this.#rows.has(notification.id)) {
			this.#rows.set(notification.id, { ...notification });
		}
	}

	public async list(owner: InboxOwner, query: InboxQuery = {}): Promise<InboxPage> {
		const limit = query.limit ?? DEFAULT_INBOX_LIMIT;
		const rows = this.#of(owner)
			.filter((row) => !query.unread || row.readAt === null)
			.filter((row) => query.cursor === undefined || row.id < query.cursor)
			.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
		const items = rows.slice(0, limit).map((row) => ({ ...row }));
		return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.id : null };
	}

	public async unreadCount(owner: InboxOwner): Promise<number> {
		return this.#of(owner).filter((row) => row.readAt === null).length;
	}

	public async markAsRead(owner: InboxOwner, ids: readonly string[]): Promise<number> {
		const wanted = new Set(ids);
		return this.#read(this.#of(owner).filter((row) => wanted.has(row.id)));
	}

	public async markAllAsRead(owner: InboxOwner): Promise<number> {
		return this.#read(this.#of(owner));
	}

	public async delete(owner: InboxOwner, ids: readonly string[]): Promise<number> {
		const wanted = new Set(ids);
		const rows = this.#of(owner).filter((row) => wanted.has(row.id));
		for (const row of rows) this.#rows.delete(row.id);
		return rows.length;
	}

	#of(owner: InboxOwner): StoredNotification[] {
		const type = ownerType(owner);
		return [...this.#rows.values()].filter(
			(row) => row.notifiableId === owner.notifiableId && row.notifiableType === type
		);
	}

	#read(rows: StoredNotification[]): number {
		const now = Clock.now();
		const unread = rows.filter((row) => row.readAt === null);
		for (const row of unread) this.#rows.set(row.id, { ...row, readAt: now });
		return unread.length;
	}
}
