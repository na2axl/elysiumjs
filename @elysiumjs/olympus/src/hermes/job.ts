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

import type { ChannelName } from './channel';
import type { Notifiable } from './notifiable';
import type { Notification } from './notification';
import type { NotificationOptions } from './registry';

import { Clock } from '../clock';
import { ElysiumError } from '../errors';
import { Heracles, Job, JobRegistry, Queue, QUEUES_SERVICE } from '../heracles/index';
import { Json } from '../json';
import { getLogger } from '../logger';
import { Service } from '../service';
import { HERMES_NOTIFICATION_JOB } from './config';
import { deliverChain } from './delivery';
import {
	DuplicateNotificationTypeError,
	QueuedNotificationDataError,
	QueuedNotificationsUnavailableError,
	UnknownNotificationError
} from './errors';
import { notificationTypes, resolverRegistry, withInstance } from './registry';

/**
 * The recipient of a queued notification, as it was when it was queued.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type QueuedRecipient = {
	readonly id?: string;
	readonly type?: string;
	readonly locale?: string;
	/** The routes of the channels of the entry, written with `Json`. */
	readonly routes: unknown;
};

/**
 * What the job of a queued notification carries.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type NotificationRun = {
	readonly type: string;
	readonly id: string;
	/** The data of the notification, written with `Json`. */
	readonly data: unknown;
	readonly chain: readonly ChannelName[];
	readonly recipient: QueuedRecipient;
};

/** A notifiable rebuilt from what was recorded when its notification was queued. */
class RecordedNotifiable implements Notifiable {
	readonly #routes: Record<string, unknown>;

	constructor(private readonly recipient: QueuedRecipient) {
		this.#routes = (Json.decode(recipient.routes) ?? {}) as Record<string, unknown>;
	}

	public get notifiableId(): string | undefined {
		return this.recipient.id;
	}

	public get notifiableType(): string | undefined {
		return this.recipient.type;
	}

	public routeNotificationFor(channel: ChannelName): unknown {
		return this.#routes[channel] ?? null;
	}

	public preferredLocale(): string | undefined {
		return this.recipient.locale;
	}
}

/**
 * Delivers a queued notification: rebuilds it from its type and data, reads the notifiable again
 * through its resolver when one is registered, and runs the fallback chain.
 * @throws {UnknownNotificationError} When no class registers the type.
 */
export const runQueuedNotification = async (run: NotificationRun): Promise<void> => {
	const cls = notificationTypes.get(run.type) as
		(new (data: unknown) => Notification<unknown>) | undefined;
	if (!cls) throw new UnknownNotificationError(run.type);
	const notification = new cls(Json.decode(run.data));
	const { id, type } = run.recipient;
	const resolver = type === undefined ? undefined : resolverRegistry.get(type);
	let notifiable: Notifiable | null | undefined = new RecordedNotifiable(run.recipient);
	if (resolver && id !== undefined) {
		notifiable = await withInstance(resolver, (instance) => instance.resolve(id));
		if (!notifiable) {
			getLogger().info('A queued notification was dropped: its notifiable is gone', {
				type: run.type,
				notifiableType: type,
				notifiableId: id
			});
			return;
		}
	}
	await deliverChain(notifiable, notification, run.type, run.chain, run.id);
};

/**
 * The job that delivers queued notifications, one per notifiable and channel entry. A fallback
 * chain runs in order inside the job. `HermesModule` lists it in its jobs.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Job.register({ name: HERMES_NOTIFICATION_JOB })
export class NotificationJob extends Job {
	public static override readonly description: string = 'Delivers a queued notification.';

	constructor(private readonly delivery: NotificationRun) {
		super();
	}

	protected async execute(): Promise<void> {
		await runQueuedNotification(this.delivery);
	}
}

/**
 * Queues the delivery of a notification to a notifiable on a channel entry.
 * @throws {QueuedNotificationsUnavailableError} When no module runs the job.
 * @throws {QueuedNotificationDataError} When the data or the routes do not survive JSON.
 */
export const queueNotification = async (
	notifiable: Notifiable,
	notification: Notification<any>,
	options: NotificationOptions & { readonly queue: string },
	chain: readonly ChannelName[],
	id: string
): Promise<void> => {
	const { type, queue } = options;
	// Resolving the queues also initialises HeraclesModule, which fills the job registry.
	if (Service.exists(QUEUES_SERVICE)) await Service.resolve(QUEUES_SERVICE);
	if (!JobRegistry.all().some((entry) => entry.jobClass === NotificationJob)) {
		throw new QueuedNotificationsUnavailableError(type);
	}
	if (!Queue.exists(queue)) {
		throw new ElysiumError(`Queue ${queue} does not exist: configure it in HeraclesModule.`);
	}
	if (notificationTypes.get(type) !== notification.constructor) {
		throw new DuplicateNotificationTypeError(type);
	}
	const data: unknown = notification.data;
	if (data !== undefined && !Json.survives(data)) {
		throw new QueuedNotificationDataError(type, 'data');
	}
	const routes: Record<string, unknown> = {};
	for (const channel of chain) {
		routes[channel] = notifiable.routeNotificationFor(channel, notification) ?? null;
	}
	if (!Json.survives(routes)) throw new QueuedNotificationDataError(type, 'routes');
	const run: NotificationRun = {
		type,
		id,
		data: Json.encode(data),
		chain,
		recipient: {
			id: notifiable.notifiableId,
			type: notifiable.notifiableType,
			locale: notifiable.preferredLocale?.(),
			routes: Json.encode(routes)
		}
	};
	const delay =
		typeof options.delay === 'number' ? options.delay : options.delay?.[chain[0] as string];
	await Heracles.dispatch(NotificationJob, [run], {
		queue,
		...(delay ? { scheduledFor: new Date(Clock.now().getTime() + delay) } : {})
	});
};
