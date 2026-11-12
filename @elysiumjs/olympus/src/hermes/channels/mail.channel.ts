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
import type { MailReceipt, MailRendererDriver } from '../mail';
import type { MailAddress } from '../messages';
import type { Notifiable } from '../notifiable';

import { Service } from '../../service';
import { HERMES_MAIL_RENDERER, HERMES_OPTIONS } from '../config';
import { HermesServiceMissingError } from '../errors';
import { Mail } from '../mail';
import { MailMessage } from '../messages';
import { Notification } from '../notification';

/** Whether a route is a mail address or a list of them. */
const addressesOf = (route: unknown): MailAddress[] => {
	const list = Array.isArray(route) ? route : [route];
	return list.filter(
		(item): item is MailAddress =>
			(typeof item === 'string' && item !== '') ||
			(typeof item === 'object' &&
				item !== null &&
				typeof (item as { address?: unknown }).address === 'string')
	);
};

/**
 * Sends a `MailMessage` to the mail route of the notifiable: drawn by the mail renderer, and sent
 * through the mail transport. The route is an address, an address with a name, or a list of them.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Notification.channel('mail', { message: MailMessage })
export class MailChannel implements NotificationChannel<MailMessage> {
	public isAvailable(notifiable: Notifiable, context: ChannelContext): boolean {
		return addressesOf(notifiable.routeNotificationFor('mail', context.notification)).length > 0;
	}

	public async send(
		notifiable: Notifiable,
		message: MailMessage,
		context: ChannelContext
	): Promise<MailReceipt> {
		const renderer = Service.get<MailRendererDriver>(HERMES_MAIL_RENDERER);
		if (!renderer) throw new HermesServiceMissingError('mail renderer');
		const options = Service.get<{ from?: MailAddress }>(HERMES_OPTIONS) ?? {};
		const content = message.toJSON();
		const rendered = await renderer.render(message, {
			locale: notifiable.preferredLocale?.(),
			notifiable,
			type: context.type
		});
		return Mail.send({
			to: addressesOf(notifiable.routeNotificationFor('mail', context.notification)),
			from: content.from ?? options.from,
			replyTo: content.replyTo,
			cc: content.cc,
			bcc: content.bcc,
			subject: content.subject ?? context.type,
			text: rendered.text,
			html: rendered.html,
			headers: content.headers
		});
	}
}
