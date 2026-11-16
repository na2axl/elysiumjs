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

import type { ChannelContext, NotificationChannel } from '../channel.js';
import type { Notifiable } from '../notifiable.js';

import { getLogger } from '../../logger.js';
import { LogMessage } from '../messages.js';
import { Notification } from '../notification.js';

/**
 * Writes a `LogMessage` to the application log, with the type of the notification and the id of
 * the notifiable.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Notification.channel('log', { message: LogMessage })
export class LogChannel implements NotificationChannel<LogMessage> {
	public send(notifiable: Notifiable, message: LogMessage, context: ChannelContext): void {
		getLogger()[message.severity](message.text, {
			...message.context,
			notification: context.type,
			notifiableId: notifiable.notifiableId
		});
	}
}
