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

import type { MailRendererDriver, MailTransportDriver } from './mail';
import type { MailAddress } from './messages';
import type { NotificationStoreDriver } from './store';

import { Module } from '../module';
import {
	HERMES_MAIL_RENDERER,
	HERMES_MAIL_TRANSPORT,
	HERMES_NOTIFICATION_STORE,
	HERMES_OPTIONS
} from './config';
import { NotificationJob } from './job';
import { MailRenderer, MailTransport } from './mail';
import { NotificationStore } from './store';

type Option<T> = T | (() => T);

const build = <T>(option: Option<T>): T =>
	typeof option === 'function' ? (option as () => T)() : option;

/**
 * The configuration of {@link HermesModule}: each driver is an instance or a function that builds
 * it once.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HermesModuleConfig = {
	/** Where the `inbox` channel keeps notifications. Defaults to the `memory` store. */
	store?: Option<NotificationStoreDriver>;

	mail?: {
		/** How mails are sent. Defaults to the `log` transport. */
		transport?: Option<MailTransportDriver>;
		/** How mail messages are drawn. Defaults to the `basic` renderer. */
		renderer?: Option<MailRendererDriver>;
		/** The sender of mails that name none. */
		from?: MailAddress;
	};
};

/**
 * Provides the notification store, the mail transport and the mail renderer to the whole
 * application, and runs queued notifications when `HeraclesModule` is loaded too.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * HermesModule.with({
 * 	store: () => new DrizzleNotificationStore(notifications),
 * 	mail: { transport: () => new SmtpTransport(), from: 'Example <hello@example.com>' }
 * });
 * ```
 */
@Module.register<HermesModuleConfig>({
	services: (config) => [
		{
			name: HERMES_NOTIFICATION_STORE,
			global: true,
			factory: () => build(config.store ?? (() => NotificationStore.for('memory')))
		},
		{
			name: HERMES_MAIL_TRANSPORT,
			global: true,
			factory: () => build(config.mail?.transport ?? (() => MailTransport.for('log')))
		},
		{
			name: HERMES_MAIL_RENDERER,
			global: true,
			factory: () => build(config.mail?.renderer ?? (() => MailRenderer.for('basic')))
		},
		{ name: HERMES_OPTIONS, global: true, factory: () => ({ from: config.mail?.from }) }
	],
	jobs: [NotificationJob]
})
export class HermesModule extends Module.configurable<HermesModuleConfig>() {}
