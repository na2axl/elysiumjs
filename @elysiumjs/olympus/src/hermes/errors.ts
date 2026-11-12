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

import { ElysiumError } from '../errors';

/**
 * Thrown by a channel when the provider refuses a message for good, such as an unknown number or
 * a template it does not know. The next channel of the fallback chain is tried, and the same
 * channel is not retried with it. Any other error fails the delivery, which a queued notification
 * retries.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * if (response.status === 400) throw new ChannelRejected('Unknown number');
 * ```
 */
export class ChannelRejected extends ElysiumError {}

/**
 * Thrown when a notification class is sent without `@Notification.register()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnregisteredNotificationError extends ElysiumError {
	constructor(name: string) {
		super(`${name} is not registered: decorate it with @Notification.register({ type }).`);
	}
}

/**
 * Thrown when a queued notification names a type that no loaded class registers.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnknownNotificationError extends ElysiumError {
	constructor(public readonly type: string) {
		super(`No notification is registered with the type "${type}".`);
	}
}

/**
 * Thrown when two notification classes register the same type, which a queued notification
 * needs to find its class.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DuplicateNotificationTypeError extends ElysiumError {
	constructor(public readonly type: string) {
		super(`Two notification classes are registered with the type "${type}".`);
	}
}

/**
 * Thrown when a notification goes to a channel that no class registers.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnknownChannelError extends ElysiumError {
	constructor(public readonly channel: string) {
		super(
			`No notification channel is named "${channel}": register a class with ` +
				`@Notification.channel('${channel}').`
		);
	}
}

/**
 * Thrown when two classes register the same channel name.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DuplicateChannelError extends ElysiumError {
	constructor(public readonly channel: string) {
		super(`The notification channel "${channel}" is already registered.`);
	}
}

/**
 * Thrown when a notification goes to a channel it has no method for.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MissingChannelMessageError extends ElysiumError {
	constructor(
		public readonly notification: string,
		public readonly channel: string
	) {
		super(`${notification} goes to the "${channel}" channel but has no ${channel}() method.`);
	}
}

/**
 * Thrown when the method of a notification answers another message than its channel accepts.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class InvalidChannelMessageError extends ElysiumError {
	constructor(notification: string, channel: string, expected: string) {
		super(`${notification}.${channel}() must answer a ${expected}.`);
	}
}

/**
 * Thrown when a queued notification carries data or routes that do not survive JSON.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class QueuedNotificationDataError extends ElysiumError {
	constructor(type: string, what: string) {
		super(
			`The ${what} of the queued notification "${type}" does not survive JSON: pass plain data.`
		);
	}
}

/**
 * Thrown when a notification is queued while no loaded module runs its job: import
 * `HeraclesModule` and `HermesModule` in the application.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class QueuedNotificationsUnavailableError extends ElysiumError {
	constructor(type: string) {
		super(
			`The notification "${type}" is queued, but no job runs queued notifications. ` +
				'Import HeraclesModule and HermesModule in the application.'
		);
	}
}

/**
 * Thrown when a channel or `Mail` needs a service that `HermesModule` provides and no loaded
 * module provides it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class HermesServiceMissingError extends ElysiumError {
	constructor(what: string) {
		super(`The ${what} is not configured: import HermesModule in the application.`);
	}
}

/**
 * Thrown when a resolver or a channel class is declared as a service that no loaded module lists.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MissingHermesServiceError extends ElysiumError {
	constructor(name: string) {
		super(`${name} is a service, but no loaded module lists it in its services.`);
	}
}

/**
 * Thrown by the basic mail renderer for a message with a view, which needs the renderer of the
 * application.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MailViewUnsupportedError extends ElysiumError {
	constructor(view: string) {
		super(
			`The mail view "${view}" needs a mail renderer: give HermesModule one with mail.renderer.`
		);
	}
}

/**
 * Thrown by the assertions of `Notification.fake()` and `Mail.fake()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class HermesAssertionError extends ElysiumError {}
