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

import type { StoredEvent, StoredEventClass, StoredEventMeta } from './stored-event';

import { inOwnerModule } from './config';
import { handlerInstance } from './projection';

/**
 * Options of {@link Reactor.on}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ReactorOptions<E extends StoredEvent> = {
	/** Reacts only to the events it accepts. */
	when?: (event: E, meta: StoredEventMeta) => boolean;
};

type Owner = new (...args: any[]) => unknown;

type Registered = {
	event: object;
	owner: Owner;
	method: string | symbol;
	when?: (event: any, meta: StoredEventMeta) => boolean;
};

const REACTORS: Registered[] = [];

/**
 * Reactors: what a stored event causes besides the state of its aggregate, such as publishing a
 * domain event for other modules with `Event.publish()`, enqueueing a job, or running an action.
 * A reactor runs in the unit of work that appends the event, right after the inline projections,
 * so its effects commit with the event; it never runs when events are replayed. Reactor methods
 * belong to any service; they run in the module that registers it, and may be protected or
 * private.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Service.register()
 * class GiftReactor {
 * 	@Reactor.on(KlapsSpent, { when: (event) => event.data.purpose === 'gift' })
 * 	protected async gifted(event: KlapsSpent, meta: StoredEventMeta) {
 * 		await Event.publish('KlapsGifted', { buyerId: meta.aggregateId, klaps: event.data.klaps });
 * 	}
 * }
 * ```
 */
export namespace Reactor {
	/**
	 * Marks a method as a reactor to a stored event.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param event The stored event class.
	 * @param options The filter of the events it reacts to.
	 */
	export const on =
		<E extends StoredEvent>(event: StoredEventClass<E>, options: ReactorOptions<E> = {}) =>
		<T extends (event: E, meta: StoredEventMeta) => unknown>(
			target: object,
			method: string | symbol,
			_descriptor: TypedPropertyDescriptor<T>
		): void => {
			REACTORS.push({ event, owner: target.constructor as Owner, method, when: options.when });
		};
}

/**
 * @internal Runs the reactors of a recorded event, in the order they registered.
 */
export const runReactors = async (event: StoredEvent, meta: StoredEventMeta): Promise<void> => {
	if (meta.replay) return;
	for (const reactor of REACTORS) {
		if (reactor.event !== event.constructor) continue;
		if (reactor.when && !reactor.when(event, meta)) continue;
		await inOwnerModule(reactor.owner, () =>
			handlerInstance(reactor.owner)[reactor.method]!(event, meta)
		);
	}
};

/** @internal Forgets the registered reactors, for tests. */
export const clearReactors = (): void => void (REACTORS.length = 0);
