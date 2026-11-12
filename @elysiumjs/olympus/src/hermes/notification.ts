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

import type {
	ChannelEntry,
	ChannelName,
	NotificationChannel,
	NotificationChannels
} from './channel';
import type { NotificationDelivery } from './delivery';
import type { NotificationFake } from './fake';
import type { Notifiable, NotifiableResolver } from './notifiable';
import type { Instantiable, NotificationOptions } from './registry';
import type { NotificationStoreDriver } from './store';

import { UnitOfWork } from '../mnemosyne/unit-of-work';
import { uuidv7 } from '../moirai/ids';
import { Service } from '../service';
import { HERMES_NOTIFICATION_STORE } from './config';
import { deliverChain } from './delivery';
import {
	DuplicateChannelError,
	HermesServiceMissingError,
	UnregisteredNotificationError
} from './errors';
import { currentNotificationFake, startNotificationFake } from './fake';
import { queueNotification } from './job';
import {
	channelRegistry,
	notificationOptions,
	notificationTypes,
	resolverRegistry
} from './registry';

/**
 * The method a notification declares for each channel, named after it: it answers the message
 * the channel accepts. `@Notification.register()` checks them.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ChannelMethods = {
	[K in ChannelName]?: (
		notifiable: Notifiable
	) => NotificationChannels[K] | Promise<NotificationChannels[K]>;
};

/** Whether a value is one notifiable rather than a list of them. */
const isNotifiable = (value: unknown): value is Notifiable =>
	typeof (value as Notifiable | undefined)?.routeNotificationFor === 'function';

/** The options of a notification, from its class. */
const optionsOf = (notification: Notification<any>): NotificationOptions => {
	const options = notificationOptions.get(notification.constructor);
	if (!options) throw new UnregisteredNotificationError(notification.constructor.name);
	return options;
};

/**
 * A notification: built with its data, it says which channels it goes by for each notifiable,
 * and declares one method per channel, named after it, that answers the message of that channel.
 * Register it with `@Notification.register({ type })`.
 *
 * A queued notification is rebuilt from its type and data in the job, so its constructor must
 * take its data only, and the data must be plain JSON data or dates.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TData The data of the notification.
 * @example
 * ```ts
 * @Notification.register({ type: 'invoice.paid', queue: 'notifications' })
 * class InvoicePaid extends Notification<{ invoiceId: string; amount: number }> {
 * 	public channels() {
 * 		// Keep it in the inbox, and send a mail, or an SMS when the mail is refused.
 * 		return ['inbox', ['mail', 'sms']] as const;
 * 	}
 *
 * 	public inbox() {
 * 		return new InboxMessage({ invoiceId: this.data.invoiceId, amount: this.data.amount });
 * 	}
 *
 * 	public mail(notifiable: Notifiable) {
 * 		return new MailMessage()
 * 			.subject('Your invoice is paid')
 * 			.line(`We received ${this.data.amount}.`)
 * 			.action('See the invoice', `https://example.com/invoices/${this.data.invoiceId}`);
 * 	}
 * }
 *
 * await Notification.send(user, new InvoicePaid({ invoiceId, amount: 1200 }));
 * ```
 */
export abstract class Notification<TData = void> {
	/** The data of the notification. */
	public readonly data: TData;

	constructor(...args: [TData] extends [void] ? [] : [data: TData]) {
		this.data = args[0] as TData;
	}

	/**
	 * The channels the notification goes by for a notifiable: each entry is a channel, or a
	 * fallback chain of channels tried in order until one delivers.
	 * @param notifiable The notifiable.
	 */
	public abstract channels(
		notifiable: Notifiable
	): readonly ChannelEntry[] | Promise<readonly ChannelEntry[]>;

	/**
	 * Whether the notification may go to a notifiable on a channel, such as the preferences of a
	 * user. A refused channel is passed over, and the next one of its chain is tried. Omitted means
	 * always.
	 * @param notifiable The notifiable.
	 * @param channel The channel.
	 */
	public canSend?(notifiable: Notifiable, channel: ChannelName): boolean | Promise<boolean>;

	/**
	 * Registers a notification class under its type.
	 * @param options The type, and how it is queued.
	 */
	public static register(options: NotificationOptions) {
		return (target: abstract new (...args: any[]) => Notification<any> & ChannelMethods): void => {
			notificationOptions.set(target, options);
			notificationTypes.set(options.type, target);
		};
	}

	/**
	 * Registers a channel class under a name, with the message class it accepts. Declare the name
	 * and the message in `NotificationChannels`.
	 * @param name The channel name.
	 * @param options The message class the channel accepts, which each message is checked against.
	 * @throws {DuplicateChannelError} When another class has the name.
	 */
	public static channel<K extends ChannelName>(
		name: K,
		options: { readonly message?: abstract new (...args: any[]) => NotificationChannels[K] } = {}
	) {
		return <C extends Instantiable<NotificationChannel<NotificationChannels[K]>>>(target: C): C => {
			const existing = channelRegistry.get(name);
			if (existing && existing.channel !== target) throw new DuplicateChannelError(name);
			channelRegistry.set(name, { channel: target, message: options.message });
			return target;
		};
	}

	/**
	 * Registers the resolver that reads the notifiables of a type again, for queued notifications.
	 * @param type The `notifiableType`.
	 */
	public static resolver(type: string) {
		return <C extends Instantiable<NotifiableResolver>>(target: C): C => {
			resolverRegistry.set(type, target);
			return target;
		};
	}

	/**
	 * Sends a notification: queued when it is registered with a queue, else delivered right away.
	 * In a unit of work, it waits for the commit unless it is registered with `afterCommit: false`;
	 * an error then is logged, not thrown.
	 * @param notifiables Who it goes to.
	 * @param notification The notification.
	 */
	public static async send(
		notifiables: Notifiable | Iterable<Notifiable>,
		notification: Notification<any>
	): Promise<void> {
		const options = optionsOf(notification);
		const work = () => dispatch(notifiables, notification, options, true);
		if (options.afterCommit !== false && UnitOfWork.active()) {
			await UnitOfWork.afterCommit(async () => {
				await work();
			});
			return;
		}
		await work();
	}

	/**
	 * Delivers a notification right away, without its queue or waiting for a unit of work, and
	 * answers what became of each notifiable and channel entry.
	 * @param notifiables Who it goes to.
	 * @param notification The notification.
	 * @throws The error of a channel, other than `ChannelRejected`.
	 */
	public static sendNow(
		notifiables: Notifiable | Iterable<Notifiable>,
		notification: Notification<any>
	): Promise<NotificationDelivery[]> {
		return dispatch(notifiables, notification, optionsOf(notification), false);
	}

	/**
	 * Someone reached at an address only, with no account behind it.
	 * @param channel The channel.
	 * @param route Where it reaches them.
	 * @example
	 * ```ts
	 * await Notification.route('mail', 'ada@example.com').route('sms', '+15550100').notify(n);
	 * ```
	 */
	public static route(channel: ChannelName, route: unknown): AnonymousNotifiable {
		return new AnonymousNotifiable().route(channel, route);
	}

	/** Records notifications instead of delivering them, until `restore()`. */
	public static fake(): NotificationFake {
		return startNotificationFake();
	}

	/**
	 * The notification store of the application, which the `inbox` channel writes to.
	 * @throws {HermesServiceMissingError} When no module provides it.
	 */
	public static store(): NotificationStoreDriver {
		const store = Service.get<NotificationStoreDriver>(HERMES_NOTIFICATION_STORE);
		if (!store) throw new HermesServiceMissingError('notification store');
		return store;
	}
}

/** Delivers, queues or records a notification for each notifiable and channel entry. */
const dispatch = async (
	notifiables: Notifiable | Iterable<Notifiable>,
	notification: Notification<any>,
	options: NotificationOptions,
	queued: boolean
): Promise<NotificationDelivery[]> => {
	const list = isNotifiable(notifiables) ? [notifiables] : [...notifiables];
	const fake = currentNotificationFake();
	const deliveries: NotificationDelivery[] = [];
	for (const notifiable of list) {
		const entries = await notification.channels(notifiable);
		if (fake) {
			fake.sent.push({ notifiable, notification, channels: entries });
			continue;
		}
		for (const entry of entries) {
			const chain: readonly ChannelName[] = typeof entry === 'string' ? [entry] : entry;
			if (chain.length === 0) continue;
			const id = uuidv7();
			if (queued && options.queue !== undefined) {
				await queueNotification(
					notifiable,
					notification,
					{ ...options, queue: options.queue },
					chain,
					id
				);
			} else {
				deliveries.push(await deliverChain(notifiable, notification, options.type, chain, id));
			}
		}
	}
	return deliveries;
};

/**
 * Someone reached at the routes they were given, with no account behind them: no inbox and no
 * preferences. Made with `Notification.route()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class AnonymousNotifiable implements Notifiable {
	readonly #routes = new Map<string, unknown>();
	#locale?: string;

	/** Adds the route of a channel. */
	public route(channel: ChannelName, route: unknown): this {
		this.#routes.set(channel, route);
		return this;
	}

	/** Sets the locale messages are written in. */
	public locale(locale: string | undefined): this {
		this.#locale = locale;
		return this;
	}

	public routeNotificationFor(channel: ChannelName): unknown {
		return this.#routes.get(channel) ?? null;
	}

	public preferredLocale(): string | undefined {
		return this.#locale;
	}

	/** Sends a notification to them, as `Notification.send()` does. */
	public notify(notification: Notification<any>): Promise<void> {
		return Notification.send(this, notification);
	}

	/** Delivers a notification to them right away, as `Notification.sendNow()` does. */
	public notifyNow(notification: Notification<any>): Promise<NotificationDelivery[]> {
		return Notification.sendNow(this, notification);
	}
}
