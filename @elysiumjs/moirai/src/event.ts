// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import type { OutboxRow } from './stores';

import { Service } from '@elysiumjs/core';

import { inOwnerModule } from './config';
import { DuplicateEventConsumerError, UnknownEventConsumerError } from './errors';
import { uuidv7 } from './ids';
import { Inbox, Outbox, registerEffect } from './outbox';

/**
 * The events of the application and their payloads. Extend it to type `Event.publish()` and
 * `@Event.on()`; while it is empty, any name and payload are accepted.
 * @author Axel Nana <axel.nana@workbud.com>
 * @example
 * ```ts
 * declare module '@elysiumjs/moirai' {
 * 	interface EventCatalogue {
 * 		'wallet.credited': { walletId: string; amount: number };
 * 	}
 * }
 * ```
 */
export interface EventCatalogue {}

/** The name of an event: a key of {@link EventCatalogue}, or any string while it is empty. */
export type EventName = [keyof EventCatalogue] extends [never]
	? string
	: keyof EventCatalogue & string;

/** The payload of an event: its type in {@link EventCatalogue}, else any. */
export type EventPayload<E extends string> = E extends keyof EventCatalogue
	? EventCatalogue[E]
	: any;

/**
 * What a handler receives besides the payload.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type EventMeta = {
	/** The id of the event, the same for every handler. */
	id: string;
	/** The name of the event. */
	event: string;
	/** When the event was published. */
	publishedAt: Date;
	/** The attempt of this handler, from 1. */
	attempt: number;
};

/**
 * Options of {@link Event.on}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type EventHandlerOptions = {
	/**
	 * The name of the handler, which records the events it handled. Defaults to `Class.method`.
	 * Keep it when the method is renamed, so that the handled events are not handled again.
	 */
	consumer?: string;
	/**
	 * The attempts of the handler, the first included. Defaults to the `maxRelayAttempts` of the
	 * module; `false` gives one attempt. A handler that fails them all is dead (`onDead`).
	 */
	retry?: false | { attempts?: number };
};

/** The kind of the outbox rows that deliver an event to one handler. */
export const MOIRAI_EVENT_EFFECT = 'moirai.event';

type Delivery = {
	id: string;
	event: string;
	consumer: string;
	payload: unknown;
	publishedAt: string;
};
type Registered = {
	event: string;
	attempts?: number;
	owner: object;
	run: (payload: unknown, meta: EventMeta) => unknown;
};

const CONSUMERS = new Map<string, Registered>();

registerEffect(
	MOIRAI_EVENT_EFFECT,
	async (payload, row) => {
		const delivery = payload as Delivery;
		const handler = CONSUMERS.get(delivery.consumer);
		if (!handler) throw new UnknownEventConsumerError(delivery.consumer, delivery.event);
		// The handler runs in its module: the inbox and outbox of that module record its work.
		await inOwnerModule(handler.owner, () =>
			Inbox.once({ messageId: delivery.id, consumer: delivery.consumer }, async () => {
				await handler.run(delivery.payload, {
					id: delivery.id,
					event: delivery.event,
					publishedAt: new Date(delivery.publishedAt),
					attempt: row.attempts + 1
				});
			})
		);
	},
	{
		attempts: (row: OutboxRow) =>
			CONSUMERS.get((row.payload as Delivery | null)?.consumer ?? '')?.attempts
	}
);

/** @internal Forgets the registered handlers, for tests. */
export const clearEventHandlers = (): void => CONSUMERS.clear();

/**
 * Domain events: what happened, published in the unit of work that made it happen, and handled
 * once by each handler, after it commits. Each handler gets its own delivery through the outbox,
 * so it retries and fails on its own, and records the events it handled in the inbox, in the
 * unit of work of its own writes. Delivery needs the `outbox` and `inbox` stores of
 * `MoiraiModule`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace Event {
	/**
	 * Marks a method as a handler of an event. Static methods are called on the class; instance
	 * methods run on the registered service, or on a new instance with its dependencies.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param event The name of the event.
	 * @param options The name of the handler and its attempts.
	 * @throws {DuplicateEventConsumerError} When another handler has the same `consumer`.
	 * @example
	 * ```ts
	 * class Receipts {
	 * 	@Event.on('wallet.credited', { consumer: 'billing.send-receipt', retry: { attempts: 5 } })
	 * 	public async send(payload: { walletId: string }, meta: EventMeta) {}
	 * }
	 * ```
	 */
	export const on =
		<const E extends EventName>(event: E, options: EventHandlerOptions = {}) =>
		<T extends (payload: EventPayload<E>, meta: EventMeta) => unknown>(
			target: object,
			method: string | symbol,
			_descriptor: TypedPropertyDescriptor<T>
		): void => {
			const isStatic = typeof target === 'function';
			const owner = (isStatic ? target : target.constructor) as new (...args: any[]) => unknown;
			const consumer = options.consumer ?? `${owner.name}.${String(method)}`;
			if (CONSUMERS.has(consumer)) throw new DuplicateEventConsumerError(consumer);
			const { retry } = options;
			CONSUMERS.set(consumer, {
				event,
				owner,
				attempts: retry === false ? 1 : retry?.attempts,
				run: (payload, meta) => {
					const self = (isStatic ? owner : (Service.get(owner) ?? Service.make(owner))) as Record<
						string | symbol,
						(payload: unknown, meta: EventMeta) => unknown
					>;
					return self[method]!(payload, meta);
				}
			});
		};

	/**
	 * Publishes an event in the open unit of work, through the outbox of the current module: each
	 * handler of the event gets it once the unit
	 * commits, and never when it rolls back.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param event The name of the event.
	 * @param payload The JSON-safe payload.
	 * @returns The id of the event.
	 */
	export const publish = async <const E extends EventName>(
		event: E,
		payload: EventPayload<E>
	): Promise<string> => {
		const publishedAt = new Date();
		const id = uuidv7(publishedAt.getTime());
		const deliveries = [...CONSUMERS]
			.filter(([, handler]) => handler.event === event)
			.map(([consumer]) => ({
				kind: MOIRAI_EVENT_EFFECT,
				payload: {
					id,
					event,
					consumer,
					payload,
					publishedAt: publishedAt.toISOString()
				} satisfies Delivery
			}));
		await Outbox.enqueue(...deliveries);
		return id;
	};

	/**
	 * The consumers of an event.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param event The name of the event.
	 */
	export const consumersOf = (event: string): string[] =>
		[...CONSUMERS].filter(([, handler]) => handler.event === event).map(([consumer]) => consumer);
}
