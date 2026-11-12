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

import { Clock, DATABASE_TRANSACTION_SERVICE, Service } from '@elysiumjs/core';
import { UnitOfWork } from '@elysiumjs/mnemosyne';

import { eventStore, inOwnerModule, projectionStorage } from './config';
import { DuplicateStreamNameError } from './errors';
import { StoredEvents } from './stored-event';

/**
 * The options of a projection.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ProjectionOptions = {
	/** The name of the projection. Defaults to the class name. */
	name?: string;
	/** The version of the projection. Bump it when what it writes changes. Defaults to 1. */
	version?: number;
	/** The models the projection writes, which its rebuild resets. */
	models?: readonly object[];
};

type Owner = new (...args: any[]) => unknown;

type Handler = { event: object; method: string | symbol };

type Registered = ProjectionOptions & {
	name: string;
	version: number;
	target: Owner;
	handlers: Handler[];
};

const HANDLERS = new WeakMap<object, Handler[]>();
const PROJECTIONS = new Map<string, Registered>();

/** The instance of a projection or a reactor: the registered service, or a new one. */
export const handlerInstance = (owner: Owner): Record<PropertyKey, Function> =>
	(Service.get(owner) ?? Service.make(owner)) as Record<PropertyKey, Function>;

/**
 * Projections: read models written from stored events. An inline projection runs in the unit of
 * work that appends the events, so a read right after a command sees what it did, and its failure
 * rolls the command back. Its handlers, marked with `@Projection.on()`, run in the module that
 * registers the class, with its dependencies, and may be protected or private.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Projection.inline({ name: 'wallet-movements', models: [WalletMovementModel] })
 * class WalletMovements {
 * 	constructor(@Service.inject() private readonly movements: WalletMovementRepository) {}
 *
 * 	@Projection.on(KlapsSpent)
 * 	protected async spent(event: KlapsSpent, meta: StoredEventMeta) {
 * 		await this.movements.insert({ id: event.data.spendId, userId: meta.aggregateId });
 * 	}
 * }
 * ```
 */
export namespace Projection {
	/**
	 * Marks a class as an inline projection.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param options The name, version and models of the projection.
	 * @throws {DuplicateStreamNameError} When another projection has the same name.
	 */
	export const inline =
		(options: ProjectionOptions = {}) =>
		<T extends Owner>(target: T): void => {
			const name = options.name ?? target.name;
			if (PROJECTIONS.has(name)) throw new DuplicateStreamNameError('projection', name);
			PROJECTIONS.set(name, {
				...options,
				name,
				version: options.version ?? 1,
				target,
				handlers: HANDLERS.get(target) ?? []
			});
		};

	/**
	 * Marks a method of a projection as the handler of a stored event.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param event The stored event class.
	 */
	export const on =
		<E extends StoredEvent>(event: StoredEventClass<E>) =>
		<T extends (event: E, meta: StoredEventMeta) => unknown>(
			target: object,
			method: string | symbol,
			_descriptor: TypedPropertyDescriptor<T>
		): void => {
			const owner = target.constructor;
			let handlers = HANDLERS.get(owner);
			if (!handlers) HANDLERS.set(owner, (handlers = []));
			handlers.push({ event, method });
		};

	/**
	 * Rebuilds a projection, in one unit of work: resets its models, replays every event it
	 * handles through its handlers in the order of the log, then records its version. On a
	 * transactional storage, readers see the previous read model until the rebuild commits. The
	 * projection runs in the module that registers it, with the stores of that module.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param projection The projection class, or its name.
	 * @param options How many events a read gives, 500 by default.
	 * @returns The number of events replayed.
	 */
	export const rebuild = (
		projection: Owner | string,
		options: { batch?: number } = {}
	): Promise<number> => {
		const registered = find(projection);
		return inOwnerModule(registered.target, () =>
			inUnitOfWork(async () => {
				const storage = projectionStorage();
				const store = eventStore();
				await storage.reset(registered.models ?? []);
				const types = [
					...new Set(registered.handlers.map((handler) => StoredEvents.nameOf(handler.event)))
				];
				const limit = options.batch ?? 500;
				let replayed = 0;
				for (let after: bigint | undefined; ;) {
					const records = await store.readAll({ types, afterPosition: after, limit });
					for (const record of records) {
						const event = StoredEvents.decode(record.type, record.schemaVersion, record.data);
						await runProjection(registered, event, {
							aggregateId: record.aggregateId,
							aggregateType: record.aggregateType,
							version: record.version,
							occurredAt: record.occurredAt,
							metadata: record.metadata,
							replay: true
						});
					}
					replayed += records.length;
					if (records.length < limit) break;
					after = records.at(-1)!.position;
				}
				await storage.built(registered.name, registered.version);
				return replayed;
			})
		);
	};

	/**
	 * The projections whose `version` differs from the one they were last built with, or that
	 * were never built.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export const stale = async (): Promise<string[]> => {
		const names: string[] = [];
		for (const projection of PROJECTIONS.values()) {
			const built = await inOwnerModule(projection.target, () =>
				projectionStorage().version(projection.name)
			);
			if (built !== projection.version) names.push(projection.name);
		}
		return names;
	};

	/**
	 * The registered projections, with their name and version.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export const all = (): { name: string; version: number; target: Owner }[] =>
		[...PROJECTIONS.values()].map(({ name, version, target }) => ({ name, version, target }));

	/**
	 * Runs the handlers of a projection for events, without a store, such as in a test.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param projection The projection class.
	 * @param events The events, each with the meta its handler receives.
	 */
	export const project = async (
		projection: Owner,
		events: readonly (readonly [StoredEvent, Partial<StoredEventMeta>])[]
	): Promise<void> => {
		const registered = find(projection);
		for (const [event, meta] of events) {
			await runProjection(registered, event, {
				aggregateId: 'aggregate',
				aggregateType: 'aggregate',
				version: 1,
				occurredAt: Clock.now(),
				metadata: {},
				replay: false,
				...meta
			});
		}
	};
}

/** The registered projection of a class or a name. */
const find = (projection: Owner | string): Registered => {
	const registered =
		typeof projection === 'string'
			? PROJECTIONS.get(projection)
			: [...PROJECTIONS.values()].find((p) => p.target === projection);
	if (!registered)
		throw new TypeError(
			typeof projection === 'string'
				? `No projection is named "${projection}".`
				: `${projection.name} is not marked with @Projection.inline().`
		);
	return registered;
};

/** Runs work in a unit of work when the app has a database and none is open. */
const inUnitOfWork = <T>(work: () => Promise<T>): Promise<T> =>
	Service.exists(DATABASE_TRANSACTION_SERVICE) && !UnitOfWork.active()
		? UnitOfWork.run(work)
		: work();

const runProjection = (
	projection: Registered,
	event: StoredEvent,
	meta: StoredEventMeta
): Promise<void> =>
	inOwnerModule(projection.target, async () => {
		for (const handler of projection.handlers) {
			if (handler.event !== event.constructor) continue;
			await handlerInstance(projection.target)[handler.method]!(event, meta);
		}
	});

/**
 * @internal Runs the inline projections of an event, in the order they registered.
 */
export const runProjections = async (event: StoredEvent, meta: StoredEventMeta): Promise<void> => {
	for (const projection of PROJECTIONS.values()) {
		if (projection.handlers.some((handler) => handler.event === event.constructor))
			await runProjection(projection, event, meta);
	}
};

/** @internal Forgets the registered projections, for tests. */
export const clearProjections = (): void => PROJECTIONS.clear();
