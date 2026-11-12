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

import './channels/inbox.channel';
import './channels/mail.channel';
import './channels/broadcast.channel';
import './channels/log.channel';

export type {
	ChannelContext,
	ChannelEntry,
	ChannelName,
	NotificationChannel,
	NotificationChannels
} from './channel';
export type { NotificationDelivery, NotificationEvent } from './delivery';
export type { SentNotification } from './fake';
export type { NotificationRun, QueuedRecipient } from './queued';
export type {
	MailEnvelope,
	MailReceipt,
	MailRenderContext,
	MailRendererDriver,
	MailTransportDriver,
	RenderedMail
} from './mail';
export type { MailAddress, MailMessageContent, MailPart } from './messages';
export type { Notifiable, NotifiableResolver } from './notifiable';
export type { NotificationOptions } from './registry';
export type {
	InboxOwner,
	InboxPage,
	InboxQuery,
	NotificationStoreDriver,
	StoredNotification
} from './store';
export type { HermesModuleConfig } from './hermes.module';
export type { BroadcastEvent } from './channels/broadcast.channel';

export { BroadcastChannel, HERMES_BROADCAST } from './channels/broadcast.channel';
export { InboxChannel } from './channels/inbox.channel';
export { LogChannel } from './channels/log.channel';
export { MailChannel } from './channels/mail.channel';
export {
	HERMES_MAIL_RENDERER,
	HERMES_MAIL_TRANSPORT,
	HERMES_NOTIFICATION_JOB,
	HERMES_NOTIFICATION_STORE,
	HERMES_OPTIONS
} from './config';
export { HERMES_FAILED, HERMES_SENDING, HERMES_SENT } from './delivery';
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
} from './errors';
export { NotificationFake } from './fake';
export { HermesModule } from './hermes.module';
export {
	BasicMailRenderer,
	LogMailTransport,
	Mail,
	MailFake,
	MailRenderer,
	MailTransport
} from './mail';
export { BroadcastMessage, InboxMessage, LogMessage, MailMessage } from './messages';
export type { ChannelMethods } from './notification';
export { AnonymousNotifiable, Notification } from './notification';
export { DEFAULT_INBOX_LIMIT, MemoryNotificationStore, NotificationStore } from './store';
