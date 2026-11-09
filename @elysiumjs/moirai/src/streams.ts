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

import type { Aggregate, AggregateClass } from './aggregate';
import type { StoredEvent, StoredEventClass, StoredEventMeta } from './stored-event';
import type { StoredEventRecord } from './stores';

import { DATABASE_TRANSACTION_SERVICE, DomainError, Service } from '@elysiumjs/core';
import { UnitOfWork } from '@elysiumjs/mnemosyne';

import { Aggregates } from './aggregate';
import { eventStore, options } from './config';
import { runProjections } from './projection';
import { runReactors } from './reactor';
import { StoredEvents } from './stored-event';

/**
 * How {@link Streams.act} records events.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ActOptions = {
	/** Metadata added to the `eventMetadata` of the module, on each event of this command. */
	metadata?: Record<string, unknown>;
};

/**
 * What a command run by {@link Streams.act} gave, when it was not refused.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type Acted<A extends Aggregate, R> = {
	/** The aggregate after the command, at the version it appended. */
	aggregate: A;
	/** What the command returned. */
	value: R;
	/** The events the command appended. */
	recorded: readonly StoredEvent[];
	/** The events of a class the command appended. */
	of: <E extends StoredEvent>(event: StoredEventClass<E>) => E[];
};

/** What {@link Streams.act} gives: the outcome, or the DomainError the command returned. */
export type ActOutcome<A extends Aggregate, R> =
	Acted<A, Exclude<R, DomainError>> | Extract<R, DomainError>;

const load = async <A extends Aggregate>(target: AggregateClass<A>, id: string): Promise<A> => {
	const records = await eventStore().load(id);
	const events = records.map((record) =>
		StoredEvents.decode(record.type, record.schemaVersion, record.data)
	);
	return Aggregates.hydrate(target, id, events, records.at(-1)?.version ?? 0);
};

/** Runs work in a unit of work when the app has a database and none is open. */
const inUnitOfWork = <T>(work: () => Promise<T>): Promise<T> =>
	Service.exists(DATABASE_TRANSACTION_SERVICE) && !UnitOfWork.active()
		? UnitOfWork.run(work)
		: work();

/**
 * Event streams: load an aggregate from its stream and run its commands. The streams are kept by
 * the `events` store of the current module, else of `MoiraiModule`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace Streams {
	/**
	 * Loads an aggregate from its stream, to read its state.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param aggregate The aggregate class.
	 * @param id The id of the aggregate.
	 */
	export const retrieve = <A extends Aggregate>(
		aggregate: AggregateClass<A>,
		id: string
	): Promise<A> => load(aggregate, id);

	/**
	 * Runs a command on an aggregate, in the open unit of work (or a new one): loads the stream,
	 * runs the command, appends the events it recorded at the next versions, then runs the inline
	 * projections and the reactors of each event. A command that returns a DomainError appends
	 * nothing, and the error is returned. When another writer appended to the stream meanwhile,
	 * the append rejects with a `ConcurrencyConflictError`, which an action retries.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param aggregate The aggregate class.
	 * @param id The id of the aggregate.
	 * @param command Runs the command on the loaded aggregate.
	 * @param options The metadata of the events.
	 * @example
	 * ```ts
	 * const spent = await Streams.act(Wallet, userId, (wallet) => wallet.spend(spendId, 120n));
	 * if (isDomainError(spent)) return spent;
	 * ```
	 */
	export const act = <A extends Aggregate, R>(
		aggregate: AggregateClass<A>,
		id: string,
		command: (aggregate: A) => R | Promise<R>,
		options_: ActOptions = {}
	): Promise<ActOutcome<A, R>> =>
		inUnitOfWork(async () => {
			const loaded = await load(aggregate, id);
			const value = await command(loaded);
			if (value instanceof DomainError) return value as Extract<R, DomainError>;

			const recorded = Aggregates.recorded(loaded);
			if (recorded.length > 0) {
				const type = Aggregates.nameOf(aggregate);
				const from = Aggregates.loadedVersion(loaded);
				const occurredAt = new Date();
				const metadata = { ...options().eventMetadata?.(), ...options_.metadata };
				const records: StoredEventRecord[] = recorded.map((event, i) => ({
					...StoredEvents.encode(event),
					aggregateId: id,
					aggregateType: type,
					version: from + i + 1,
					metadata,
					occurredAt
				}));
				await eventStore().append(records);
				for (const [i, event] of recorded.entries()) {
					const meta: StoredEventMeta = {
						aggregateId: id,
						aggregateType: type,
						version: records[i]!.version,
						occurredAt,
						metadata,
						replay: false
					};
					await runProjections(event, meta);
					await runReactors(event, meta);
				}
				Aggregates.committed(loaded);
			}
			return {
				aggregate: loaded,
				value: value as Exclude<R, DomainError>,
				recorded,
				of: <E extends StoredEvent>(event: StoredEventClass<E>) =>
					recorded.filter((e): e is E => e instanceof event)
			};
		});
}
