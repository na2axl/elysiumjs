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

import './channels/inbox.channel.js';
import './channels/mail.channel.js';
import './channels/broadcast.channel.js';
import './channels/log.channel.js';

export type {
	ChannelContext,
	ChannelEntry,
	ChannelName,
	NotificationChannel,
	NotificationChannels
} from './channel.js';
export type { NotificationDelivery, NotificationEvent } from './delivery.js';
export type { SentNotification } from './fake.js';
export type { NotificationRun, QueuedRecipient } from './queued.js';
export type {
	MailEnvelope,
	MailReceipt,
	MailRenderContext,
	MailRendererDriver,
	MailTransportDriver,
	RenderedMail
} from './mail.js';
export type { MailAddress, MailMessageContent, MailPart } from './messages.js';
export type { Notifiable, NotifiableResolver } from './notifiable.js';
export type { NotificationOptions } from './registry.js';
export type {
	InboxOwner,
	InboxPage,
	InboxQuery,
	NotificationStoreDriver,
	StoredNotification
} from './store.js';
export type { HermesModuleConfig } from './hermes.module.js';
export type { BroadcastEvent } from './channels/broadcast.channel.js';

export { BroadcastChannel, HERMES_BROADCAST } from './channels/broadcast.channel.js';
export { InboxChannel } from './channels/inbox.channel.js';
export { LogChannel } from './channels/log.channel.js';
export { MailChannel } from './channels/mail.channel.js';
export {
	HERMES_MAIL_RENDERER,
	HERMES_MAIL_TRANSPORT,
	HERMES_NOTIFICATION_JOB,
	HERMES_NOTIFICATION_STORE,
	HERMES_OPTIONS
} from './config.js';
export { HERMES_FAILED, HERMES_SENDING, HERMES_SENT } from './delivery.js';
export {
	ChannelRejected,
	DuplicateChannelError,
	DuplicateNotificationTypeError,
	HermesAssertionError,
	HermesServiceMissingError,
	InvalidChannelMessageError,
	MailViewUnsupportedError,
	MissingChannelMessageError,
	MissingHermesServiceError,
	NotificationDeliveryError,
	QueuedNotificationDataError,
	QueuedNotificationsUnavailableError,
	UnknownChannelError,
	UnknownNotificationError,
	UnregisteredNotificationError
} from './errors.js';
export { NotificationFake } from './fake.js';
export { HermesModule } from './hermes.module.js';
export {
	BasicMailRenderer,
	LogMailTransport,
	Mail,
	MailFake,
	MailRenderer,
	MailTransport
} from './mail.js';
export { BroadcastMessage, InboxMessage, LogMessage, MailMessage } from './messages.js';
export type { ChannelMethods } from './notification.js';
export { AnonymousNotifiable, Notification } from './notification.js';
export { DEFAULT_INBOX_LIMIT, MemoryNotificationStore, NotificationStore } from './store.js';
