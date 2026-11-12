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

import type { ChannelContext, NotificationChannel } from '../channel';
import type { Notifiable } from '../notifiable';

import { Lifecycle } from '../../lifecycle';
import { BroadcastMessage } from '../messages';
import { Notification } from '../notification';

/** Emitted by the `broadcast` channel, for a WebSocket or a stream of the app to forward. */
export const HERMES_BROADCAST = 'elysium:hermes:broadcast';

/**
 * The data of the `elysium:hermes:broadcast` lifecycle event.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type BroadcastEvent = {
	readonly id: string;
	readonly type: string;
	/** The name of the event: the one the message gives, or the type of the notification. */
	readonly event: string;
	readonly notifiableId?: string;
	readonly data: Record<string, unknown>;
};

/**
 * Emits a `BroadcastMessage` as the `elysium:hermes:broadcast` lifecycle event, which the app
 * forwards to its clients, such as over a WebSocket.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Lifecycle.on('elysium:hermes:broadcast')
 * public static forward({ data }: LifecycleEvent<BroadcastEvent>) {
 * 	sockets.publish(`users:${data.notifiableId}`, data);
 * }
 * ```
 */
@Notification.channel('broadcast', { message: BroadcastMessage })
export class BroadcastChannel implements NotificationChannel<BroadcastMessage> {
	public send(notifiable: Notifiable, message: BroadcastMessage, context: ChannelContext): void {
		Lifecycle.emit<BroadcastEvent>(HERMES_BROADCAST, {
			id: context.id,
			type: context.type,
			event: message.event ?? context.type,
			notifiableId: notifiable.notifiableId,
			data: message.data
		});
	}
}
