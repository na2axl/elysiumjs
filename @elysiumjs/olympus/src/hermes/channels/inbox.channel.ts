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

import { Clock } from '../../clock';
import { uuidv7 } from '../../moirai/ids';
import { InboxMessage } from '../messages';
import { Notification } from '../notification';

/**
 * Keeps notifications in the notification store, for the inbox of the app. It reaches only
 * notifiables with an id.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Notification.channel('inbox', { message: InboxMessage })
export class InboxChannel implements NotificationChannel<InboxMessage> {
	public isAvailable(notifiable: Notifiable): boolean {
		return notifiable.notifiableId !== undefined;
	}

	public async send(
		notifiable: Notifiable,
		message: InboxMessage,
		context: ChannelContext
	): Promise<{ id: string }> {
		// The id is made at delivery, so that pages, which sort by id, keep the order of delivery.
		const id = uuidv7();
		await Notification.store().save({
			id,
			deliveryId: context.id,
			notifiableType: notifiable.notifiableType ?? null,
			notifiableId: notifiable.notifiableId!,
			type: context.type,
			data: message.data,
			readAt: null,
			createdAt: Clock.now()
		});
		return { id };
	}
}
