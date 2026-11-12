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

import type { ChannelContext, ChannelName, NotificationChannel } from './channel';
import type { Notifiable } from './notifiable';
import type { Notification } from './notification';

import { Lifecycle } from '../lifecycle';
import { getLogger } from '../logger';
import {
	ChannelRejected,
	InvalidChannelMessageError,
	MissingChannelMessageError,
	UnknownChannelError
} from './errors';
import { channelRegistry, withInstance } from './registry';

/** Emitted before a channel sends a message. */
export const HERMES_SENDING = 'elysium:hermes:sending';

/** Emitted once a channel has sent a message. */
export const HERMES_SENT = 'elysium:hermes:sent';

/** Emitted when a channel fails to send a message, or refuses it. */
export const HERMES_FAILED = 'elysium:hermes:failed';

/**
 * The data of the `elysium:hermes:*` lifecycle events.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type NotificationEvent = ChannelContext & {
	readonly notifiable: Notifiable;
	readonly message: unknown;
	/** What the channel answered, on `sent`. */
	readonly result?: unknown;
	/** The error, on `failed`. */
	readonly error?: unknown;
};

/**
 * What became of a notification for one notifiable and one channel entry.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type NotificationDelivery = {
	/** The id of the delivery. */
	readonly id: string;
	/** The type of the notification. */
	readonly type: string;
	/** The notifiable, when it has an id. */
	readonly notifiableId?: string;
	/** The channel that delivered it, or `null` when none of the entry could. */
	readonly channel: ChannelName | null;
	/** What the channel answered. */
	readonly result?: unknown;
};

const SKIPPED = Symbol('skipped');

/** Emits an event; a listener that throws is logged, and does not fail the delivery. */
const emit = (event: string, data: NotificationEvent): void => {
	try {
		Lifecycle.emit<NotificationEvent>(event, data);
	} catch (error) {
		getLogger().error('A notification event listener failed', {
			event,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};

/**
 * Delivers a notification to a notifiable on the first channel of a chain that can: a channel the
 * notification refuses with `canSend`, that is not available, or that rejects the message is
 * passed over.
 * @throws The error of a channel, other than `ChannelRejected`.
 */
export const deliverChain = async (
	notifiable: Notifiable,
	notification: Notification<any>,
	type: string,
	chain: readonly ChannelName[],
	id: string
): Promise<NotificationDelivery> => {
	const base = { id, type, notifiableId: notifiable.notifiableId };
	for (const channel of chain) {
		const registration = channelRegistry.get(channel);
		if (!registration) throw new UnknownChannelError(channel);
		if (notification.canSend && !(await notification.canSend(notifiable, channel))) continue;
		const context: ChannelContext = { id, type, channel, notification };
		const outcome = await withInstance(
			registration.channel,
			async (instance: NotificationChannel<unknown>) => {
				if (instance.isAvailable && !(await instance.isAvailable(notifiable, context))) {
					return SKIPPED;
				}
				const method = (notification as unknown as Record<string, unknown>)[channel];
				if (typeof method !== 'function') {
					throw new MissingChannelMessageError(notification.constructor.name, channel);
				}
				const message: unknown = await method.call(notification, notifiable);
				if (registration.message && !(message instanceof registration.message)) {
					throw new InvalidChannelMessageError(
						notification.constructor.name,
						channel,
						registration.message.name
					);
				}
				const event = { ...context, notifiable, message };
				emit(HERMES_SENDING, event);
				try {
					const result = await instance.send(notifiable, message, context);
					emit(HERMES_SENT, { ...event, result });
					return { result };
				} catch (error) {
					emit(HERMES_FAILED, { ...event, error });
					if (error instanceof ChannelRejected) return SKIPPED;
					throw error;
				}
			}
		);
		if (outcome !== SKIPPED) return { ...base, channel, result: outcome.result };
	}
	return { ...base, channel: null };
};
