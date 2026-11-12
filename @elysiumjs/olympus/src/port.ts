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
 * The driver type of every port, by port name. A package that makes a port adds it by
 * declaration merging; `Port(name)` reads the driver type from it.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * declare module '@elysiumjs/olympus' {
 * 	interface Ports {
 * 		search: SearchDriver;
 * 	}
 * }
 * ```
 */
export interface Ports {}

/** The driver type of a port, from {@link Ports}. */
export type PortDriverType<N extends string> = N extends keyof Ports ? Ports[N] : object;

/**
 * The drivers of every port, keyed by `<port>:<driver>`. Each package that provides a driver adds
 * it by declaration merging, so that `.for()` and `.driver()` only take known names. A driver is
 * given by its class, so that `.for()` also types its options, or by its instance type.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * declare module '@elysiumjs/olympus' {
 * 	interface PortDrivers {
 * 		'search:meilisearch': typeof MeiliSearchDriver;
 * 	}
 * }
 * ```
 */
export interface PortDrivers {}

/** The drivers declared for a port, by driver name. */
type DriversOf<N extends string> = {
	[K in keyof PortDrivers as K extends `${N}:${infer D}` ? D : never]: PortDrivers[K];
};

/**
 * The names of the drivers declared for a port. A port with no declared driver takes any name.
 */
export type PortDriverName<N extends string> = [keyof DriversOf<N>] extends [never]
	? string
	: keyof DriversOf<N> & string;

/** The instance a driver entry of {@link PortDrivers} stands for. */
type InstanceOfEntry<E, D> = E extends abstract new (...args: any[]) => infer I
	? I
	: unknown extends E
		? D
		: E;

/** The options a driver entry of {@link PortDrivers} takes, when it is given by its class. */
type OptionsOfEntry<E> = E extends abstract new (options: infer O, ...args: any[]) => unknown
	? O
	: Record<string, unknown>;

/** The entry of {@link PortDrivers} for a port and a driver name, or `unknown`. */
type EntryOf<N extends string, K extends string> = `${N}:${K}` extends keyof PortDrivers
	? PortDrivers[`${N}:${K}`]
	: unknown;

/** The driver `.for()` answers for a port and a driver name. */
export type PortDriver<N extends string, K extends string, D> = InstanceOfEntry<EntryOf<N, K>, D> &
	D;

/** The options `.for()` takes for a port and a driver name. */
export type PortDriverOptions<N extends string, K extends string> =
	unknown extends EntryOf<N, K> ? Record<string, unknown> : OptionsOfEntry<EntryOf<N, K>>;

/**
 * A driver class: built with the options given to `.for()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type PortDriverClass<D> = new (options?: any) => D;

/**
 * Thrown by `.for()` when no driver is registered under the name.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnknownPortDriverError extends ElysiumError {
	constructor(
		public readonly port: string,
		public readonly driver: string,
		known: readonly string[]
	) {
		super(
			`The port "${port}" has no driver named "${driver}". ` +
				(known.length > 0 ? `Known drivers: ${known.join(', ')}. ` : '') +
				'Import the package that provides it, or register a class with ' +
				`@<Port>.driver('${driver}').`
		);
	}
}

/**
 * Thrown when two classes register under the same driver name of a port.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DuplicatePortDriverError extends ElysiumError {
	constructor(
		public readonly port: string,
		public readonly driver: string
	) {
		super(`The port "${port}" already has a driver named "${driver}".`);
	}
}

/**
 * The static side of a port made with {@link Port}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface PortClass<N extends string, D> {
	/** The name of the port. */
	readonly port: N;

	/**
	 * Registers a class as the driver of this port under a name.
	 * @param name The driver name, as declared in {@link PortDrivers}.
	 * @throws {DuplicatePortDriverError} When another class has the name.
	 */
	driver<K extends PortDriverName<N>>(name: K): <C extends PortDriverClass<D>>(target: C) => C;

	/**
	 * Builds the driver registered under a name, with its options.
	 * @param name The driver name.
	 * @param options The options of the driver.
	 * @throws {UnknownPortDriverError} When no class is registered under the name.
	 */
	for<K extends PortDriverName<N>>(name: K, options?: PortDriverOptions<N, K>): PortDriver<N, K, D>;

	/** Whether a driver is registered under a name. */
	has(name: string): boolean;

	/** The names of the registered drivers. */
	drivers(): string[];
}

/**
 * Makes a port: a named extension point whose drivers register by name and are built with
 * `.for(name, options)`. Every port of the framework is made with it, and any package can make
 * its own. Declare the driver type of the port in {@link Ports}, its drivers in
 * {@link PortDrivers}, and extend the result with a class.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param name The name of the port, as declared in {@link Ports}.
 * @example
 * ```ts
 * // A package makes a port.
 * export interface SearchDriver {
 * 	query(index: string, text: string): Promise<object[]>;
 * }
 * declare module '@elysiumjs/olympus' {
 * 	interface Ports {
 * 		search: SearchDriver;
 * 	}
 * }
 * export class Search extends Port('search') {}
 *
 * // Another package provides a driver.
 * declare module '@elysiumjs/olympus' {
 * 	interface PortDrivers {
 * 		'search:meilisearch': typeof MeiliSearchDriver;
 * 	}
 * }
 * @Search.driver('meilisearch')
 * export class MeiliSearchDriver implements SearchDriver {
 * 	constructor(private readonly options: { url: string }) {}
 * 	// ...
 * }
 *
 * // The app picks it.
 * const search = Search.for('meilisearch', { url: 'http://localhost:7700' });
 * ```
 */
export const Port = <N extends string, D extends object = PortDriverType<N>>(
	name: N
): PortClass<N, D> & (abstract new () => object) => {
	const registry = new Map<string, PortDriverClass<D>>();

	abstract class PortBase {
		public static readonly port: N = name;

		public static driver(driverName: string) {
			return <C extends PortDriverClass<D>>(target: C): C => {
				const existing = registry.get(driverName);
				if (existing && existing !== target) throw new DuplicatePortDriverError(name, driverName);
				registry.set(driverName, target);
				return target;
			};
		}

		public static for(driverName: string, options?: unknown): D {
			const driver = registry.get(driverName);
			if (!driver) throw new UnknownPortDriverError(name, driverName, [...registry.keys()]);
			return new driver(options);
		}

		public static has(driverName: string): boolean {
			return registry.has(driverName);
		}

		public static drivers(): string[] {
			return [...registry.keys()];
		}
	}

	return PortBase as unknown as PortClass<N, D> & (abstract new () => object);
};
