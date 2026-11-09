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

import type { DomainError } from '@elysiumjs/core';
import type { StoredEventClass } from './stored-event';

import { DuplicateStreamNameError, UnregisteredStreamClassError } from './errors';
import { deepFreeze, freezes, StoredEvent, StoredEvents } from './stored-event';

/**
 * The options of an aggregate.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type AggregateOptions = {
	/**
	 * The name of the aggregate, kept with each event of its streams. Defaults to the class name.
	 * Keep it when the class is renamed.
	 */
	name?: string;
};

/**
 * An aggregate class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type AggregateClass<A extends Aggregate = Aggregate> = (new () => A) & {
	initialState: unknown;
};

/** The state of an aggregate class. */
export type StateOf<A extends Aggregate> = A extends Aggregate<infer S> ? S : never;

type Internals = {
	id: string;
	state: unknown;
	version: number;
	recorded: StoredEvent[];
};

const NAMES = new Map<string, object>();
const BY_CLASS = new WeakMap<object, string>();
const EVOLVERS = new WeakMap<object, Map<object, string | symbol>>();
const INTERNALS = new WeakMap<Aggregate, Internals>();

const internals = (aggregate: Aggregate): Internals => {
	const found = INTERNALS.get(aggregate);
	if (!found) throw new TypeError('This aggregate was not loaded by moirai.');
	return found;
};

/** The evolve handlers of a class and its parents, the nearest first. */
const evolverOf = (target: object, event: object): string | symbol | undefined => {
	for (
		let current = target;
		current && current !== Aggregate;
		current = Object.getPrototypeOf(current)
	) {
		const method = EVOLVERS.get(current)?.get(event);
		if (method !== undefined) return method;
	}
	return undefined;
};

/** Applies an event to a state with the evolve handler of its class, if any. */
const evolve = (aggregate: Aggregate, state: unknown, event: StoredEvent): unknown => {
	const method = evolverOf(aggregate.constructor, event.constructor);
	// An event without a handler leaves the state as it is.
	if (method === undefined) return state;
	const next = (aggregate as unknown as Record<PropertyKey, Function>)[method]!(state, event);
	return freezes() ? deepFreeze(next) : next;
};

/**
 * An event-sourced aggregate: its state is the fold of the events of its stream. Its public
 * methods are the commands: they check the rules against the current state, then record events
 * with `record()`, or return the DomainError that refuses the command. Methods marked with
 * `@Aggregate.evolve()` give the next state from the state and an event; the state is a value,
 * frozen in `development` and `test`, so a handler gives a new one instead of changing it.
 *
 * Run commands with {@link Streams.act}, which loads the stream, runs the command, and appends what
 * it records; test them with {@link Aggregate.given}.
 * @author Axel Nana <axel.nana@workbud.com>
 * @example
 * ```ts
 * @Aggregate.register({ name: 'wallet' })
 * class Wallet extends Aggregate<{ klaps: bigint }> {
 * 	static override initialState = { klaps: 0n };
 *
 * 	spend(spendId: string, klaps: bigint) {
 * 		if (klaps > this.state.klaps) return new InsufficientKlaps(klaps - this.state.klaps);
 * 		this.record(new KlapsSpent({ spendId, klaps }));
 * 	}
 *
 * 	@Aggregate.evolve(KlapsSpent)
 * 	protected spent(state: { klaps: bigint }, event: KlapsSpent) {
 * 		return { klaps: state.klaps - event.data.klaps };
 * 	}
 * }
 * ```
 */
export abstract class Aggregate<TState = unknown> {
	/** The state of a new stream, before its first event. */
	public static initialState: unknown = {};

	/**
	 * Marks a class as an aggregate.
	 * @param options The name of the aggregate.
	 * @throws {DuplicateStreamNameError} When another aggregate has the same name.
	 */
	public static register(options: AggregateOptions = {}) {
		return <T extends AggregateClass>(target: T): void => {
			const name = options.name ?? target.name;
			if (NAMES.has(name)) throw new DuplicateStreamNameError('aggregate', name);
			NAMES.set(name, target);
			BY_CLASS.set(target, name);
		};
	}

	/**
	 * Marks a method as the evolve handler of a stored event: it takes the current state and the
	 * event, and gives the next state. The method may be protected or private.
	 * @param event The stored event class.
	 */
	public static evolve<E extends StoredEvent>(event: StoredEventClass<E>) {
		return <S>(
			target: object,
			method: string | symbol,
			_descriptor: TypedPropertyDescriptor<(state: S, event: E) => S>
		): void => {
			const owner = target.constructor;
			let methods = EVOLVERS.get(owner);
			if (!methods) EVOLVERS.set(owner, (methods = new Map()));
			methods.set(event, method);
		};
	}

	/**
	 * Runs a command on an aggregate built from past events, without a store, for tests.
	 * @param events The past events of the stream.
	 * @param id The id of the aggregate. Defaults to `aggregate`.
	 * @example
	 * ```ts
	 * Wallet.given([new KlapsToppedUp({ klaps: 100n })])
	 * 	.when((wallet) => wallet.spend('s-1', 30n))
	 * 	.assertRecorded(new KlapsSpent({ spendId: 's-1', klaps: 30n }));
	 * ```
	 */
	public static given<A extends Aggregate>(
		this: AggregateClass<A>,
		events: readonly StoredEvent[] = [],
		id = 'aggregate'
	): { when: <R>(command: (aggregate: A) => R) => AggregateScenario<A, R> } {
		return {
			when: (command) => {
				const aggregate = Aggregates.hydrate(this, id, events, events.length);
				const outcome = command(aggregate);
				return new AggregateScenario(aggregate, outcome);
			}
		};
	}

	/** The id of the aggregate. */
	public get id(): string {
		return internals(this).id;
	}

	/** The version of the stream, the recorded events included. */
	public get version(): number {
		const own = internals(this);
		return own.version + own.recorded.length;
	}

	/** The current state, the recorded events included. */
	protected get state(): TState {
		return internals(this).state as TState;
	}

	/**
	 * Records an event: it is applied to the state at once, and appended to the stream when the
	 * command ends.
	 * @param event The stored event.
	 */
	protected record(event: StoredEvent): void {
		// Fails early on a class without @StoredEvent.register().
		StoredEvents.definitionOf(event.constructor);
		const own = internals(this);
		own.state = evolve(this, own.state, event);
		own.recorded.push(event);
	}
}

/**
 * The outcome of a command run by {@link Aggregate.given}, with assertions that throw an `Error`
 * when they fail.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class AggregateScenario<A extends Aggregate, R> {
	constructor(
		/** The aggregate after the command. */
		public readonly aggregate: A,
		/** What the command gave, such as the DomainError that refused it. */
		public readonly outcome: R
	) {}

	/** The events the command recorded. */
	public get recorded(): readonly StoredEvent[] {
		return Aggregates.recorded(this.aggregate);
	}

	/**
	 * Asserts that the command recorded these events, in this order: an instance must match the
	 * class and the data of the recorded event, a class only its class.
	 * @param expected The events, or their classes.
	 */
	public assertRecorded(...expected: (StoredEvent | StoredEventClass)[]): this {
		const recorded = this.recorded;
		const describe = (event: StoredEvent | StoredEventClass) =>
			typeof event === 'function'
				? event.name
				: `${event.constructor.name} ${stringify(event.data)}`;
		const matches =
			recorded.length === expected.length &&
			expected.every((event, i) =>
				typeof event === 'function'
					? recorded[i] instanceof event
					: recorded[i]?.constructor === event.constructor &&
						stringify(recorded[i]!.data) === stringify(event.data)
			);
		if (!matches)
			throw new Error(
				`Expected the events [${expected.map(describe).join(', ')}], ` +
					`recorded [${recorded.map(describe).join(', ')}].`
			);
		return this;
	}

	/** Asserts that the command recorded no event. */
	public assertNothingRecorded(): this {
		return this.assertRecorded();
	}

	/**
	 * Asserts that the command returned a DomainError of this class, and recorded no event.
	 * @param error The DomainError class.
	 */
	public assertRefused(error: abstract new (...args: any[]) => DomainError): this {
		if (!(this.outcome instanceof error))
			throw new Error(`Expected the command to be refused with ${error.name}.`);
		return this.assertNothingRecorded();
	}
}

/** JSON with bigints, in a stable key order, to compare event data. */
const stringify = (value: unknown): string =>
	JSON.stringify(value, (_key, v: unknown) =>
		typeof v === 'bigint'
			? `${v}n`
			: v && typeof v === 'object' && !Array.isArray(v)
				? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
				: v
	);

/**
 * @internal Builds aggregates and reads what they recorded.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace Aggregates {
	/** The name of an aggregate class. */
	export const nameOf = (target: object): string => {
		const name = BY_CLASS.get(target);
		if (name === undefined)
			throw new UnregisteredStreamClassError(
				(target as { name?: string }).name ?? String(target),
				'@Aggregate.register()'
			);
		return name;
	};

	/** An aggregate whose state is the fold of past events. */
	export const hydrate = <A extends Aggregate>(
		target: AggregateClass<A>,
		id: string,
		events: readonly StoredEvent[],
		version: number
	): A => {
		nameOf(target);
		const aggregate = new target();
		const initial = structuredClone(target.initialState);
		INTERNALS.set(aggregate, {
			id,
			state: freezes() ? deepFreeze(initial) : initial,
			version: 0,
			recorded: []
		});
		const own = internals(aggregate);
		for (const event of events) own.state = evolve(aggregate, own.state, event);
		own.version = version;
		return aggregate;
	};

	/** The events recorded since the aggregate loaded. */
	export const recorded = (aggregate: Aggregate): readonly StoredEvent[] => [
		...internals(aggregate).recorded
	];

	/** The version the aggregate loaded at, before what it recorded. */
	export const loadedVersion = (aggregate: Aggregate): number => internals(aggregate).version;

	/** Marks the recorded events as appended. */
	export const committed = (aggregate: Aggregate): void => {
		const own = internals(aggregate);
		own.version += own.recorded.length;
		own.recorded = [];
	};

	/** @internal Forgets the registered aggregate names, for tests. */
	export const clear = (): void => NAMES.clear();
}
