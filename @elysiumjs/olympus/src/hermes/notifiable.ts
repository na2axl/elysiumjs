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

import type { ChannelName } from './channel';
import type { Notification } from './notification';

/**
 * Someone a notification reaches: an id for the channels that keep notifications, such as the
 * inbox, the route of each other channel (an address, a phone number, a device token), and the
 * locale messages are written in.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * class UserRecipient implements Notifiable {
 * 	readonly notifiableType = 'user';
 *
 * 	constructor(private readonly user: User) {}
 *
 * 	get notifiableId() {
 * 		return this.user.id;
 * 	}
 *
 * 	routeNotificationFor(channel: ChannelName) {
 * 		return channel === 'mail' ? this.user.email : null;
 * 	}
 *
 * 	preferredLocale() {
 * 		return this.user.locale;
 * 	}
 * }
 * ```
 */
export interface Notifiable {
	/**
	 * Who is notified: the key of the inbox and of the preferences. Absent for someone reached at
	 * an address only.
	 */
	readonly notifiableId?: string;

	/**
	 * The kind of notifiable, such as `user`. A queued notification reads the notifiable again
	 * through the resolver registered for it with `@Notification.resolver()`; without one, it
	 * keeps the routes and locale it had when it was queued.
	 */
	readonly notifiableType?: string;

	/**
	 * Where a channel reaches them, or `null` when it cannot; a promise of it is awaited by the
	 * built-in channels and when the notification is queued.
	 * @param channel The channel.
	 * @param notification The notification being sent.
	 */
	routeNotificationFor(channel: ChannelName, notification?: Notification<any>): unknown;

	/** The locale messages are written in, such as `fr`. */
	preferredLocale?(): string | undefined;
}

/**
 * Reads a notifiable again by its id, for a queued notification, so that the job sees its current
 * routes and preferences. Register it with `@Notification.resolver(type)`; list it in a module's
 * `services` when it needs services.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Notification.resolver('user')
 * @Service.register()
 * class UserResolver implements NotifiableResolver {
 * 	constructor(@Service.inject() private readonly users: UserRepository) {}
 *
 * 	async resolve(id: string) {
 * 		const user = await this.users.find(id);
 * 		return user ? new UserRecipient(user) : null;
 * 	}
 * }
 * ```
 */
export interface NotifiableResolver {
	/**
	 * The notifiable with this id, or `null` when it is gone, which drops the notification.
	 * @param id The `notifiableId`.
	 */
	resolve(id: string): Notifiable | null | undefined | Promise<Notifiable | null | undefined>;
}
