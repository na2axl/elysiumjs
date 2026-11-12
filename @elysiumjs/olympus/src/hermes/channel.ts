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

import type { BroadcastMessage, InboxMessage, LogMessage, MailMessage } from './messages';
import type { Notifiable } from './notifiable';
import type { Notification } from './notification';

/**
 * The message class each channel accepts, by channel name. A package or an app that adds a
 * channel declares it here by declaration merging, so that the method of a notification named
 * after the channel is checked against its message.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * declare module '@elysiumjs/olympus/hermes' {
 * 	interface NotificationChannels {
 * 		sms: SmsMessage;
 * 	}
 * }
 * ```
 */
export interface NotificationChannels {
	inbox: InboxMessage;
	mail: MailMessage;
	broadcast: BroadcastMessage;
	log: LogMessage;
}

/** The name of a channel declared in {@link NotificationChannels}. */
export type ChannelName = keyof NotificationChannels & string;

/**
 * Where a notification goes: a channel, or a fallback chain of channels tried in order until one
 * delivers.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ChannelEntry = ChannelName | readonly ChannelName[];

/**
 * What a channel is given with each message.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ChannelContext = {
	/** The id of this delivery: the same for each channel of a chain, and across retries. */
	readonly id: string;

	/** The type of the notification. */
	readonly type: string;

	/** The channel. */
	readonly channel: ChannelName;

	/** The notification. */
	readonly notification: Notification<any>;
};

/**
 * A channel: it sends the messages of its kind. Register it with
 * `@Notification.channel(name, { message })`, and list it in a module's `services` when it needs
 * services.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TMessage The message the channel accepts.
 * @example
 * ```ts
 * @Notification.channel('sms', { message: SmsMessage })
 * class SmsChannel implements NotificationChannel<SmsMessage> {
 * 	isAvailable(notifiable: Notifiable) {
 * 		return notifiable.routeNotificationFor('sms') !== null;
 * 	}
 *
 * 	async send(notifiable: Notifiable, message: SmsMessage) {
 * 		await provider.send(notifiable.routeNotificationFor('sms') as string, message.text);
 * 	}
 * }
 * ```
 */
export interface NotificationChannel<TMessage = unknown> {
	/**
	 * Whether the channel can reach the notifiable now, such as a provider set up for its country.
	 * The next channel of the chain is tried when it cannot. Omitted means always.
	 */
	isAvailable?(notifiable: Notifiable, context: ChannelContext): boolean | Promise<boolean>;

	/**
	 * Sends the message. Throw `ChannelRejected` when the provider refuses it for good, so that
	 * the next channel of the chain is tried; any other error fails the delivery.
	 * @returns What the provider answers, such as its message id, given to the `sent` event.
	 */
	send(notifiable: Notifiable, message: TMessage, context: ChannelContext): unknown;
}
