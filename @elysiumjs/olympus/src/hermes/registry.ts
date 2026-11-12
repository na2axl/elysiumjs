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

import type { ChannelName, NotificationChannel } from './channel';
import type { Notifiable, NotifiableResolver } from './notifiable';
import type { Notification } from './notification';

import { Metadata } from '../metadata';
import { ModuleContext } from '../module-context';
import { Service } from '../service';
import { Symbols } from '../utils';
import { MissingHermesServiceError } from './errors';

/**
 * How a notification class is registered.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type NotificationOptions = {
	/** The type, unique and stable: stored in the inbox and used to rebuild queued notifications. */
	readonly type: string;

	/**
	 * The Heracles queue that delivers it: each notifiable and each channel entry becomes a job.
	 * Without a queue, `Notification.send()` delivers it right away.
	 */
	readonly queue?: string;

	/**
	 * Whether a notification sent in a unit of work waits for it to commit, and is dropped when it
	 * rolls back. Defaults to `true`.
	 */
	readonly afterCommit?: boolean;

	/**
	 * How long a queued notification waits before it is delivered, in milliseconds: one delay, or
	 * one per channel, read from the first channel of each entry.
	 */
	readonly delay?: number | Readonly<Record<string, number>>;

	/** The priority of its jobs on the queue. */
	readonly priority?: number;

	/** How many times its jobs are retried, instead of the `maxRetries` of the queue. */
	readonly maxRetries?: number;
};

/** A class that is built without arguments or by the container. */
export type Instantiable<T> = new (...args: any[]) => T;

/** The options of each registered notification class. */
export const notificationOptions = new WeakMap<Function, NotificationOptions>();

/** The notification classes, by type: the last registered for each type. */
export const notificationTypes = new Map<string, Function>();

/** A registered channel: its class and the message class it accepts. */
export type ChannelRegistration = {
	readonly channel: Instantiable<NotificationChannel<any>>;
	readonly message?: abstract new (...args: any[]) => unknown;
};

/** The registered channels, by name. */
export const channelRegistry = new Map<string, ChannelRegistration>();

/** The registered resolvers, by notifiable type. */
export const resolverRegistry = new Map<string, Instantiable<NotifiableResolver>>();

const instances = new WeakMap<Function, object>();

/**
 * Runs work with the instance of a channel or resolver class: resolved in the module that lists
 * it when there is one, so that it uses that module's services; from the container when it is a
 * global service; else built once without arguments.
 * @throws {MissingHermesServiceError} When the class is a service that no loaded module lists.
 */
export const withInstance = async <T extends object, R>(
	cls: Instantiable<T>,
	work: (instance: T) => R | Promise<R>
): Promise<R> => {
	const [owner] = Service.ownersOf(cls);
	if (owner) {
		return ModuleContext.run(owner, async () => work((await Service.resolve(cls)) as T));
	}
	if (Service.exists(cls)) return work((await Service.resolve(cls)) as T);
	if (Metadata.get(Symbols.serviceOptions, cls)) throw new MissingHermesServiceError(cls.name);
	let instance = instances.get(cls) as T | undefined;
	if (!instance) {
		instance = new cls();
		instances.set(cls, instance);
	}
	return work(instance);
};

/**
 * How notifications are queued, installed by `@elysiumjs/olympus/hermes/heracles`.
 * @internal
 */
export type NotificationQueue = {
	/**
	 * Checks that the delivery can be queued and records what its job carries, before any unit of
	 * work is waited for.
	 */
	prepare(
		notifiable: Notifiable,
		notification: Notification<any>,
		options: NotificationOptions & { readonly queue: string },
		chain: readonly ChannelName[],
		id: string
	): Promise<unknown>;

	/** Dispatches the prepared jobs: once the unit of work commits, unless `afterCommit` is off. */
	dispatch(prepared: readonly unknown[], options: NotificationOptions): Promise<void>;
};

let notificationQueue: NotificationQueue | undefined;

/**
 * Installs how notifications are queued.
 * @internal
 */
export const setNotificationQueue = (queue: NotificationQueue): void => {
	notificationQueue = queue;
};

/** How notifications are queued, when `@elysiumjs/olympus/hermes/heracles` is loaded. */
export const getNotificationQueue = (): NotificationQueue | undefined => notificationQueue;
