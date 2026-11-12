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

import type { TSchema } from 'typebox';

import Value from 'typebox/value';

import { Environments } from '../index';
import {
	DuplicateStreamNameError,
	UnknownStoredEventError,
	UnregisteredStreamClassError
} from './errors';

/**
 * The options of a stored event.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StoredEventOptions = {
	/**
	 * The name of the event in its stream. Defaults to the class name. Keep it when the class is
	 * renamed, so that the stored events still load.
	 */
	name?: string;
	/** The version of the data. Bump it when the data changes, with an upcaster. Defaults to 1. */
	version?: number;
	/**
	 * The schema of the data. The data is encoded with it when it is appended (codecs, such as a
	 * bigint kept as a string, run then) and decoded with it when it loads; data that does not
	 * match it is refused. Without a schema, the data is kept as it is and must be JSON-safe.
	 */
	schema?: TSchema;
};

/**
 * What projections and reactors receive besides the event.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StoredEventMeta = {
	/** The id of the aggregate whose stream holds the event. */
	aggregateId: string;
	/** The name of the aggregate class. */
	aggregateType: string;
	/** The version of the stream this event makes. */
	version: number;
	/** When the event happened. */
	occurredAt: Date;
	/** Who caused the event and why. */
	metadata: Record<string, unknown>;
	/** Whether the event is replayed, such as by a projection rebuild, instead of just recorded. */
	replay: boolean;
};

/**
 * A stored event class.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StoredEventClass<E extends StoredEvent = StoredEvent> = new (data: any) => E;

/** The data of a stored event class. */
export type DataOf<C extends StoredEventClass> = InstanceType<C>['data'];

type Definition = {
	name: string;
	version: number;
	schema?: TSchema;
	upcasters: Map<number, (data: any) => unknown>;
	target: StoredEventClass;
};

const BY_CLASS = new WeakMap<object, Definition>();
const BY_NAME = new Map<string, Definition>();
const UPCASTERS = new WeakMap<object, Map<number, string | symbol>>();

/** Freezes a value and everything it holds, so that a mutation throws. */
export const deepFreeze = <T>(value: T): T => {
	if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
	for (const key of Reflect.ownKeys(value))
		deepFreeze((value as Record<PropertyKey, unknown>)[key]);
	return Object.freeze(value);
};

/** Whether values are frozen to catch mutations: in `development` and `test`. */
export const freezes = (): boolean => Environments.includes(Environments.local);

/**
 * A fact recorded in the stream of an aggregate. Each kind of event is a class extending
 * `StoredEvent` with its data, marked with `@StoredEvent.register()`. The data of a stored event
 * changes shape with upcasters, so the events already stored keep loading: bump `version`, and
 * give the class a static method marked with `@StoredEvent.upcast()` for the version before.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * const CreditsSpentData = t.Object({ spendId: t.String(), credits: t.String(), sellerId: t.String() });
 *
 * @StoredEvent.register({ name: 'CreditsSpent', version: 2, schema: CreditsSpentData })
 * class CreditsSpent extends StoredEvent<Static<typeof CreditsSpentData>> {
 * 	// Version 1 kept the seller in `ref`.
 * 	@StoredEvent.upcast(1)
 * 	static fromV1({ ref, ...data }: { spendId: string; credits: string; ref: { sellerId: string } }) {
 * 		return { ...data, sellerId: ref.sellerId };
 * 	}
 * }
 * ```
 */
export abstract class StoredEvent<TData = unknown> {
	/** The data of the event, frozen in `development` and `test`. */
	public readonly data: TData;

	constructor(data: TData) {
		this.data = freezes() ? deepFreeze(data) : data;
	}

	/**
	 * Marks a class as a stored event.
	 * @param options The name, version and schema of the event.
	 * @throws {DuplicateStreamNameError} When another stored event has the same name.
	 */
	public static register(options: StoredEventOptions = {}) {
		return <T extends StoredEventClass>(target: T): void => {
			const name = options.name ?? target.name;
			if (BY_NAME.has(name)) throw new DuplicateStreamNameError('stored event', name);
			const methods = UPCASTERS.get(target) ?? new Map();
			const upcasters = new Map(
				[...methods].map(([from, method]) => [
					from,
					(data: unknown) => (target as unknown as Record<PropertyKey, Function>)[method]!(data)
				])
			);
			const definition: Definition = {
				name,
				version: options.version ?? 1,
				schema: options.schema,
				upcasters,
				target
			};
			BY_CLASS.set(target, definition);
			BY_NAME.set(name, definition);
		};
	}

	/**
	 * Marks a static method as the upcaster of a version: it takes the stored data of that version
	 * and gives the data of the next one. Upcasters chain, from the stored version up to the
	 * current one.
	 * @param from The version the method reads.
	 */
	public static upcast(from: number) {
		return (target: object, method: string | symbol, _descriptor: PropertyDescriptor): void => {
			if (typeof target !== 'function')
				throw new TypeError(`@StoredEvent.upcast(${from}) marks a static method.`);
			let methods = UPCASTERS.get(target);
			if (!methods) UPCASTERS.set(target, (methods = new Map()));
			methods.set(from, method);
		};
	}
}

/**
 * @internal Reads and writes stored events.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export namespace StoredEvents {
	/** The definition of a stored event class. */
	export const definitionOf = (target: object): Definition => {
		const definition = BY_CLASS.get(target);
		if (!definition)
			throw new UnregisteredStreamClassError(
				(target as { name?: string }).name ?? String(target),
				'@StoredEvent.register()'
			);
		return definition;
	};

	/** The name of a stored event class. */
	export const nameOf = (target: object): string => definitionOf(target).name;

	/** The stored form of an event: its name, version and JSON data. */
	export const encode = (
		event: StoredEvent
	): { type: string; schemaVersion: number; data: unknown } => {
		const { name, version, schema } = definitionOf(event.constructor);
		const data = schema ? Value.Encode(schema, event.data) : event.data;
		return { type: name, schemaVersion: version, data: JSON.parse(JSON.stringify(data ?? null)) };
	};

	/**
	 * The event a stored record holds, upcast to the current version of its class.
	 * @throws {UnknownStoredEventError} When no class reads the record.
	 */
	export const decode = (type: string, schemaVersion: number, data: unknown): StoredEvent => {
		const definition = BY_NAME.get(type);
		if (!definition || schemaVersion > definition.version)
			throw new UnknownStoredEventError(type, schemaVersion);
		let current = structuredClone(data);
		for (let version = schemaVersion; version < definition.version; version++) {
			const upcast = definition.upcasters.get(version);
			if (!upcast) throw new UnknownStoredEventError(type, version);
			current = upcast(current);
		}
		const value = definition.schema ? Value.Decode(definition.schema, current) : current;
		return new definition.target(value);
	};

	/** @internal Forgets the registered stored events, for tests. */
	export const clear = (): void => BY_NAME.clear();
}
