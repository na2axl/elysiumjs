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

import type { ChannelEntry } from './channel';
import type { Notifiable } from './notifiable';
import type { Notification } from './notification';

import { HermesAssertionError } from './errors';

/**
 * A notification recorded by `Notification.fake()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SentNotification = {
	readonly notifiable: Notifiable;
	readonly notification: Notification<any>;
	/** What `channels()` answered for the notifiable. */
	readonly channels: readonly ChannelEntry[];
};

type NotificationClass<T extends Notification<any>> = abstract new (...args: any[]) => T;

/** Whether a recorded notifiable is the one asked for: the same object, or the same id. */
const matches = (sent: Notifiable, target: Notifiable | string): boolean =>
	typeof target === 'string'
		? sent.notifiableId === target
		: sent === target ||
			(target.notifiableId !== undefined && sent.notifiableId === target.notifiableId);

/**
 * Records the notifications sent while `Notification.fake()` is on, instead of delivering them,
 * with assertions for tests.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * const notifications = Notification.fake();
 * await Moirai.execute(PayInvoice, { invoiceId });
 * notifications.assertSentTo(user, InvoicePaid, (n) => n.data.invoiceId === invoiceId);
 * notifications.restore();
 * ```
 */
export class NotificationFake {
	/** The notifications sent, in order. */
	public readonly sent: SentNotification[] = [];

	/**
	 * The notifications sent to a notifiable (the object, or its id), of a class when one is given.
	 */
	public sentTo<T extends Notification<any>>(
		notifiable: Notifiable | string,
		notification?: NotificationClass<T>
	): (SentNotification & { readonly notification: T })[] {
		return this.sent.filter(
			(item): item is SentNotification & { readonly notification: T } =>
				matches(item.notifiable, notifiable) &&
				(!notification || item.notification instanceof notification)
		);
	}

	/**
	 * Throws unless a notification of the class went to the notifiable, and passes the check.
	 * @throws {HermesAssertionError}
	 */
	public assertSentTo<T extends Notification<any>>(
		notifiable: Notifiable | string,
		notification: NotificationClass<T>,
		check: (notification: T, channels: readonly ChannelEntry[]) => boolean = () => true
	): void {
		const found = this.sentTo(notifiable, notification).some((item) =>
			check(item.notification, item.channels)
		);
		if (!found) {
			throw new HermesAssertionError(`No ${notification.name} was sent to the notifiable.`);
		}
	}

	/**
	 * Throws if a notification of the class went to the notifiable.
	 * @throws {HermesAssertionError}
	 */
	public assertNotSentTo<T extends Notification<any>>(
		notifiable: Notifiable | string,
		notification: NotificationClass<T>
	): void {
		if (this.sentTo(notifiable, notification).length > 0) {
			throw new HermesAssertionError(`${notification.name} was sent to the notifiable.`);
		}
	}

	/**
	 * Throws unless notifications of the class were sent this many times, to anyone.
	 * @throws {HermesAssertionError}
	 */
	public assertSentTimes<T extends Notification<any>>(
		notification: NotificationClass<T>,
		times: number
	): void {
		const count = this.sent.filter((item) => item.notification instanceof notification).length;
		if (count !== times) {
			throw new HermesAssertionError(
				`${notification.name} was sent ${count} time(s), not ${times}.`
			);
		}
	}

	/**
	 * Throws if any notification was sent.
	 * @throws {HermesAssertionError}
	 */
	public assertNothingSent(): void {
		if (this.sent.length > 0) {
			throw new HermesAssertionError(`${this.sent.length} notification(s) were sent.`);
		}
	}

	/** Delivers notifications again. */
	public restore(): void {
		if (current === this) current = null;
	}

	/** Restores, for `using notifications = Notification.fake()`. */
	public [Symbol.dispose](): void {
		this.restore();
	}
}

let current: NotificationFake | null = null;

/** The fake that is on, if any. */
export const currentNotificationFake = (): NotificationFake | null => current;

/** Turns a new fake on. */
export const startNotificationFake = (): NotificationFake => {
	current = new NotificationFake();
	return current;
};

/** Turns `Notification.fake()` off, such as when the application stops. */
export const restoreNotificationFake = (): void => {
	current = null;
};
