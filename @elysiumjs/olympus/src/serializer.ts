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

import { ElysiumError } from './errors';

/**
 * How a serializer is registered.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SerializerOptions = {
	/**
	 * The name written with each value: unique, and stable across deploys, since stored values
	 * carry it.
	 */
	readonly name: string;

	/**
	 * The order in which serializers are asked whether they support a value, highest first. The
	 * built-in serializers have priority 0, so a serializer with a higher priority replaces them.
	 * Defaults to 0.
	 */
	readonly priority?: number;
};

/**
 * Thrown when two serializer classes register the same name.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DuplicateSerializerError extends ElysiumError {
	constructor(public readonly serializer: string) {
		super(`A serializer is already registered with the name "${serializer}".`);
	}
}

/**
 * Thrown when a value names a serializer that is not registered, such as a value written by a
 * process that loaded more serializers.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnknownSerializerError extends ElysiumError {
	constructor(public readonly serializer: string) {
		super(
			`No serializer is registered with the name "${serializer}": import the module that ` +
				'registers it with @Serializer.register().'
		);
	}
}

/**
 * A registered serializer: its name, priority and instance.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RegisteredSerializer = {
	readonly name: string;
	readonly priority: number;
	readonly serializer: Serializer<any, any>;
};

const registry: RegisteredSerializer[] = [];

/**
 * Turns values that JSON does not keep, such as dates or the instances of a class, into values it
 * keeps, and back. `Json` asks the registered serializers, highest priority first, whether they
 * support each value it writes, and writes the first match as
 * `{ "$type": "<name>", "$value": <serialized> }`. What `serialize()` answers is written with
 * `Json` again, so it may hold other serializable values; `deserialize()` receives it read back.
 *
 * Register a class with `@Serializer.register({ name })`; it is built once, without arguments.
 * Dates, maps, sets, bigints and byte arrays are supported out of the box.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TIn The values the serializer supports.
 * @template TOut What it turns them into.
 * @example
 * ```ts
 * @Serializer.register({ name: 'money' })
 * export class MoneySerializer extends Serializer<Money, { amount: string; currency: string }> {
 * 	public supports(value: unknown): boolean {
 * 		return value instanceof Money;
 * 	}
 *
 * 	public serialize(money: Money) {
 * 		return { amount: money.amount.toString(), currency: money.currency };
 * 	}
 *
 * 	public deserialize(value: { amount: string; currency: string }) {
 * 		return new Money(BigInt(value.amount), value.currency);
 * 	}
 * }
 *
 * Json.parse<{ price: Money }>(Json.stringify({ price })).price instanceof Money; // true
 * ```
 */
export abstract class Serializer<TIn = unknown, TOut = unknown> {
	/**
	 * Whether the serializer handles a value.
	 * @param value Any value `Json` writes.
	 */
	public abstract supports(value: unknown): boolean;

	/**
	 * Turns a supported value into one `Json` can write.
	 * @param value The value.
	 */
	public abstract serialize(value: TIn): TOut;

	/**
	 * Turns what {@link serialize} answered, read back, into the value.
	 * @param value What `serialize()` answered.
	 */
	public abstract deserialize(value: TOut): TIn;

	/**
	 * Registers a serializer class under a name.
	 * @param options The name and the priority.
	 * @throws {DuplicateSerializerError} When another class has the name.
	 */
	public static register(options: SerializerOptions) {
		return (target: new () => Serializer<any, any>): void => {
			const index = registry.findIndex((entry) => entry.name === options.name);
			const existing = registry[index];
			if (existing) {
				if (existing.serializer.constructor !== target) {
					throw new DuplicateSerializerError(options.name);
				}
				registry.splice(index, 1);
			}
			registry.push({
				name: options.name,
				priority: options.priority ?? 0,
				serializer: new target()
			});
			// A stable sort: the same priority keeps the order of registration.
			registry.sort((a, b) => b.priority - a.priority);
		};
	}

	/** The registered serializers, highest priority first. */
	public static all(): readonly RegisteredSerializer[] {
		return registry;
	}

	/** The serializer registered under a name, if any. */
	public static find(name: string): RegisteredSerializer | undefined {
		return registry.find((entry) => entry.name === name);
	}

	/** The first serializer that supports a value, if any. */
	public static for(value: unknown): RegisteredSerializer | undefined {
		return registry.find((entry) => entry.serializer.supports(value));
	}
}

/**
 * Writes valid dates as their ISO string. An invalid date is not supported, so that
 * `Json.survives()` refuses it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Serializer.register({ name: 'date' })
export class DateSerializer extends Serializer<Date, string> {
	public supports(value: unknown): boolean {
		return value instanceof Date && !Number.isNaN(value.getTime());
	}

	public serialize(value: Date): string {
		return value.toISOString();
	}

	public deserialize(value: string): Date {
		return new Date(value);
	}
}

/**
 * Writes a `Map` as the list of its entries, keys and values written with `Json` again. A
 * subclass of `Map` is not supported, since it would read back as a plain `Map`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Serializer.register({ name: 'map' })
export class MapSerializer extends Serializer<Map<unknown, unknown>, [unknown, unknown][]> {
	public supports(value: unknown): boolean {
		return value instanceof Map && Object.getPrototypeOf(value) === Map.prototype;
	}

	public serialize(value: Map<unknown, unknown>): [unknown, unknown][] {
		return [...value.entries()];
	}

	public deserialize(value: [unknown, unknown][]): Map<unknown, unknown> {
		return new Map(value);
	}
}

/**
 * Writes a `Set` as the list of its values, written with `Json` again. A subclass of `Set` is not
 * supported, since it would read back as a plain `Set`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Serializer.register({ name: 'set' })
export class SetSerializer extends Serializer<Set<unknown>, unknown[]> {
	public supports(value: unknown): boolean {
		return value instanceof Set && Object.getPrototypeOf(value) === Set.prototype;
	}

	public serialize(value: Set<unknown>): unknown[] {
		return [...value];
	}

	public deserialize(value: unknown[]): Set<unknown> {
		return new Set(value);
	}
}

/**
 * Writes a `bigint` as its decimal string.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Serializer.register({ name: 'bigint' })
export class BigIntSerializer extends Serializer<bigint, string> {
	public supports(value: unknown): boolean {
		return typeof value === 'bigint';
	}

	public serialize(value: bigint): string {
		return value.toString();
	}

	public deserialize(value: string): bigint {
		return BigInt(value);
	}
}

/** The `Buffer` class of the runtime, when it has one. */
const BufferClass = (globalThis as { Buffer?: { from(bytes: Uint8Array): Uint8Array } }).Buffer;

/**
 * Writes a `Uint8Array`, a Node.js `Buffer` included, as its bytes in base64. A `Buffer` reads
 * back as a `Buffer` on runtimes that have one, and as a `Uint8Array` elsewhere.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Serializer.register({ name: 'bytes' })
export class BytesSerializer extends Serializer<Uint8Array, { base64: string; buffer?: true }> {
	public supports(value: unknown): boolean {
		if (!(value instanceof Uint8Array)) return false;
		const prototype = Object.getPrototypeOf(value);
		return (
			prototype === Uint8Array.prototype ||
			(BufferClass !== undefined && prototype === (BufferClass as unknown as Function).prototype)
		);
	}

	public serialize(value: Uint8Array): { base64: string; buffer?: true } {
		let binary = '';
		for (let i = 0; i < value.length; i += 0x8000) {
			binary += String.fromCharCode(...value.subarray(i, i + 0x8000));
		}
		const isBuffer =
			BufferClass !== undefined &&
			Object.getPrototypeOf(value) === (BufferClass as unknown as Function).prototype;
		return isBuffer ? { base64: btoa(binary), buffer: true } : { base64: btoa(binary) };
	}

	public deserialize(value: { base64: string; buffer?: true }): Uint8Array {
		const binary = atob(value.base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return value.buffer && BufferClass ? BufferClass.from(bytes) : bytes;
	}
}
