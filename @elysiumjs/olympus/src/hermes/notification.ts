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
	DuplicateNotificationTypeError,
	HermesServiceMissingError,
	MissingChannelMessageError,
	NotificationDeliveryError,
	QueuedNotificationsUnavailableError,
	UnknownChannelError,
	UnregisteredNotificationError
} from './errors';
import { currentNotificationFake, startNotificationFake } from './fake';
import { prepareRun } from './queued';
import {
	channelRegistry,
	getNotificationQueue,
	notificationOptions,
	notificationTypes,
	resolverRegistry
} from './registry';

/** The channel names an entry list holds: each channel, and each channel of each chain. */
type ChannelsIn<E> = E extends readonly (infer I)[]
	? I extends readonly (infer C)[]
		? C
		: I
	: never;

/** The channel names a notification's `channels()` answers. */
type ChannelsOf<T> = T extends { channels(...args: any[]): infer R }
	? ChannelsIn<Awaited<R>>
	: never;

/**
 * The method each channel a notification goes by requires, named after it: it answers the
 * message the channel accepts. `@Notification.register()` checks them.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ChannelMethods<T> = {
	[K in ChannelsOf<T> & ChannelName]: (
		notifiable: any
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

/** A delivery to make: a notifiable, a channel entry, and the id of the delivery. */
type Planned = {
	readonly notifiable: Notifiable;
	readonly chain: readonly ChannelName[];
	readonly id: string;
};

/**
 * The deliveries of a notification: each notifiable and each entry of its `channels()`, with the
 * channels checked, so that a mistake fails the call instead of a later delivery.
 */
const plan = async (
	notifiables: Notifiable | Iterable<Notifiable>,
	notification: Notification<any>
): Promise<{ planned: Planned[]; entries: Map<Notifiable, readonly ChannelEntry[]> }> => {
	const list = isNotifiable(notifiables) ? [notifiables] : [...notifiables];
	const planned: Planned[] = [];
	const entries = new Map<Notifiable, readonly ChannelEntry[]>();
	for (const notifiable of list) {
		const answered = await notification.channels(notifiable);
		entries.set(notifiable, answered);
		for (const entry of answered) {
			const chain: readonly ChannelName[] = typeof entry === 'string' ? [entry] : entry;
			for (const channel of chain) {
				if (!channelRegistry.has(channel)) throw new UnknownChannelError(channel);
				if (typeof (notification as unknown as Record<string, unknown>)[channel] !== 'function') {
					throw new MissingChannelMessageError(notification.constructor.name, channel);
				}
			}
			if (chain.length > 0) planned.push({ notifiable, chain, id: uuidv7() });
		}
	}
	return { planned, entries };
};

/**
 * Delivers each planned delivery; one that fails does not stop the others.
 * @throws {NotificationDeliveryError} When some deliveries failed.
 */
const deliverAll = async (
	planned: readonly Planned[],
	notification: Notification<any>,
	type: string
): Promise<NotificationDelivery[]> => {
	const deliveries: NotificationDelivery[] = [];
	const failures: { id: string; notifiableId?: string; error: unknown }[] = [];
	for (const { notifiable, chain, id } of planned) {
		try {
			deliveries.push(await deliverChain(notifiable, notification, type, chain, id));
		} catch (error) {
			failures.push({ id, notifiableId: notifiable.notifiableId, error });
		}
	}
	if (failures.length > 0) throw new NotificationDeliveryError(deliveries, failures);
	return deliveries;
};

/**
 * A notification: built with its data, it says which channels it goes by for each notifiable,
 * and declares one method per channel, named after it, that answers the message of that channel.
 * Register it with `@Notification.register({ type })`.
 *
 * A queued notification is rebuilt from its type and data in the job, so its constructor must
 * take its data only, and the data must pass `Json.survives()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TData The data of the notification.
 * @example
 * ```ts
 * @Notification.register({ type: 'invoice.paid', queue: 'notifications' })
 * class InvoicePaid extends Notification<{ invoiceId: string; amount: number }> {
 * 	public channels() {
 * 		// Keep it in the inbox, and send a mail, or write to the log when no mail can go.
 * 		return ['inbox', ['mail', 'log']] as const;
 * 	}
 *
 * 	public inbox() {
 * 		return new InboxMessage({ invoiceId: this.data.invoiceId, amount: this.data.amount });
 * 	}
 *
 * 	public mail() {
 * 		return new MailMessage()
 * 			.subject('Your invoice is paid')
 * 			.line(`We received ${this.data.amount}.`)
 * 			.action('See the invoice', `https://example.com/invoices/${this.data.invoiceId}`);
 * 	}
 *
 * 	public log() {
 * 		return new LogMessage('An invoice was paid without a mail address');
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
	 * Registers a notification class under its type. The class must declare a method for each
	 * channel its `channels()` names, and take its data as its only constructor argument.
	 * @param options The type, and how it is queued.
	 * @throws {DuplicateNotificationTypeError} When another class has the type.
	 */
	public static register(options: NotificationOptions) {
		return <C extends abstract new (data?: any) => Notification<any>>(
			target: C & (abstract new (data?: any) => ChannelMethods<InstanceType<C>>)
		): void => {
			const existing = notificationTypes.get(options.type);
			if (existing && existing !== target) throw new DuplicateNotificationTypeError(options.type);
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
	 * Its channels, and for a queued notification its data and routes, are checked first, so that
	 * a mistake throws here.
	 *
	 * In a unit of work, it waits for the commit, and is dropped on rollback, unless it is
	 * registered with `afterCommit: false`. A queued notification is then stored in the outbox of
	 * moirai when there is one; a delivery that fails after the commit is logged, not thrown.
	 * @param notifiables Who it goes to.
	 * @param notification The notification.
	 * @throws {NotificationDeliveryError} When deliveries made right away failed; the others went.
	 * @throws {QueuedNotificationsUnavailableError} When it is queued and
	 * `@elysiumjs/olympus/hermes/heracles` is not loaded.
	 */
	public static async send(
		notifiables: Notifiable | Iterable<Notifiable>,
		notification: Notification<any>
	): Promise<void> {
		const options = optionsOf(notification);
		const { planned, entries } = await plan(notifiables, notification);
		const queue = options.queue;
		if (queue !== undefined) {
			if (currentNotificationFake()) {
				// A faked notification is checked as its job would be, without a queue.
				for (const { notifiable, chain, id } of planned) {
					await prepareRun(notifiable, notification, options.type, chain, id);
				}
				record(entries, notification);
				return;
			}
			const hook = getNotificationQueue();
			if (!hook) throw new QueuedNotificationsUnavailableError(options.type);
			const prepared = await Promise.all(
				planned.map(({ notifiable, chain, id }) =>
					hook.prepare(notifiable, notification, { ...options, queue }, chain, id)
				)
			);
			await hook.dispatch(prepared, options);
			return;
		}
		if (record(entries, notification)) return;
		const work = () => deliverAll(planned, notification, options.type);
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
	 * @throws {NotificationDeliveryError} When some deliveries failed; the others went.
	 */
	public static async sendNow(
		notifiables: Notifiable | Iterable<Notifiable>,
		notification: Notification<any>
	): Promise<NotificationDelivery[]> {
		const options = optionsOf(notification);
		const { planned, entries } = await plan(notifiables, notification);
		if (record(entries, notification)) return [];
		return deliverAll(planned, notification, options.type);
	}

	/**
	 * Someone reached at an address only, with no account behind it.
	 * @param channel The channel.
	 * @param route Where it reaches them.
	 * @example
	 * ```ts
	 * await Notification.route('mail', 'ada@example.com').notify(new Welcome({ name: 'Ada' }));
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

/** Records the notification while `Notification.fake()` is on, and answers whether it did. */
const record = (
	entries: Map<Notifiable, readonly ChannelEntry[]>,
	notification: Notification<any>
): boolean => {
	const fake = currentNotificationFake();
	if (!fake) return false;
	for (const [notifiable, channels] of entries)
		fake.sent.push({ notifiable, notification, channels });
	return true;
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
