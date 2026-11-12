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

import type { Environment, ModuleGraph, ModuleNode } from '../index';
import type { TransactionRunner } from './unit-of-work';

import {
	DATABASE_TRANSACTION_SERVICE,
	ElysiumError,
	Environments,
	InteractsWithConsole,
	Metadata,
	ModuleContext,
	Service
} from '../index';

declare module '../index' {
	interface ModuleCollections {
		/** The seeders provided by the module, run by `styx db:seed`. */
		seeders?: SeederClass[];
	}
}

const SEEDER = Symbol('elysium:mnemosyne:seeder');

/**
 * A seeder class.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SeederClass = abstract new () => Seeder;

/** The seeders that must run before a seeder, or a function returning them. */
type SeederList = readonly SeederClass[] | (() => readonly SeederClass[]);

/**
 * Properties of `@Seeder.register()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SeederProps = {
	/**
	 * The name of the seeder, used to pick it with `--only`. Defaults to the module name and the
	 * class name without its `Seeder` suffix, in kebab case: `CountriesSeeder` declared by
	 * `CoreModule` is `core.countries`.
	 */
	name?: string;

	/**
	 * The seeders that run before this one when both run. A function returning them can be given
	 * when an import cycle leaves a class undefined while the decorator runs.
	 */
	after?: SeederList;

	/** When `true`, the seeder runs only when it is named with `--only`. */
	manual?: boolean;

	/** The connection of the transaction the seeder runs in. Defaults to `default`. */
	connection?: string;

	/** The environments (`NODE_ENV` values) in which the seeder is available. */
	env?: readonly Environment[];
};

/**
 * The options given to `styx db:seed`, read by seeders through `this.input`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SeederInput = {
	/** The file given with `--file`, if any. */
	readonly file?: string;

	/** The `--arg key=value` pairs. */
	readonly args: Readonly<Record<string, string>>;
};

type SeederMetadata = Omit<SeederProps, 'after'> & { after: () => readonly SeederClass[] };

/**
 * A seeder, as `styx db:seed` plans it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type PlannedSeeder = {
	/** The name of the seeder. */
	readonly name: string;

	/** The seeder class. */
	readonly seeder: SeederClass;

	/** The module that declares it. */
	readonly module: ModuleNode;

	/** The connection of its transaction. */
	readonly connection: string;

	/** Whether it runs only when named. */
	readonly manual: boolean;
};

/**
 * Thrown when two seeders have the same name.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DuplicateSeederError extends ElysiumError {
	constructor(name: string, modules: readonly string[]) {
		super(`Seeder ${name} is declared more than once (in ${modules.join(' and ')}).`);
	}
}

/**
 * Thrown when a seeder is named, or listed in `after`, but no active module declares it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnknownSeederError extends ElysiumError {
	constructor(name: string, from?: string) {
		super(
			from
				? `Seeder ${from} runs after ${name}, which no active module lists in its seeders.`
				: `No active module lists a seeder named ${name}.`
		);
	}
}

/**
 * Thrown when seeders run after each other in a cycle.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class SeederCycleError extends ElysiumError {
	constructor(names: readonly string[]) {
		super(`Seeders run after each other in a cycle: ${names.join(' → ')}.`);
	}
}

/** `CountriesSeeder` → `countries`, `CoreModule` → `core`, `PaymentRoutes` → `payment-routes`. */
const kebab = (name: string, suffix: string): string =>
	(name.endsWith(suffix) && name.length > suffix.length ? name.slice(0, -suffix.length) : name)
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
		.toLowerCase();

const metadataOf = (seeder: SeederClass): SeederMetadata | undefined =>
	Metadata.get(SEEDER, seeder);

/**
 * Base class for seeders: idempotent writes of the rows an application needs to run, such as
 * reference data, run by `styx db:seed`. Each seeder runs in its own transaction, inside the
 * module that lists it in its `seeders`, so its `run` method takes that module's services.
 * Seeders run on every call: write them as upserts.
 * @example
 * ```ts
 * @Seeder.register({ after: [CountriesSeeder] })
 * export class CitiesSeeder extends Seeder {
 * 	protected async run(@Service.inject() cities: CityRepository): Promise<void> {
 * 		await cities.upsertMany(await readCities(this.input.file));
 * 	}
 * }
 * ```
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export abstract class Seeder extends InteractsWithConsole {
	#input: SeederInput = { args: {} };

	/**
	 * Marks a class as a seeder. List it in the `seeders` of a module to make it run.
	 * @param props The seeder properties.
	 */
	public static register(props: SeederProps = {}) {
		return function (target: SeederClass) {
			const { after = [], ...rest } = props;
			Metadata.define(
				SEEDER,
				{ ...rest, after: typeof after === 'function' ? after : () => after },
				target
			);
			Environments.set(target, props.env);
		};
	}

	/**
	 * The name of a seeder: the one it was registered with, else derived from its module and class.
	 * @param seeder The seeder class.
	 * @param module The module that declares it.
	 */
	public static nameOf(seeder: SeederClass, module: ModuleNode): string {
		return (
			metadataOf(seeder)?.name ?? `${kebab(module.id, 'Module')}.${kebab(seeder.name, 'Seeder')}`
		);
	}

	/**
	 * Orders the seeders of the active modules so that each runs after the ones in its `after`.
	 * Without `only`, the manual seeders are left out; with it, only the named seeders are kept.
	 * Seeders in `after` that are not kept are not added: `after` sets an order, not a dependency.
	 * @param graph The module graph.
	 * @param only The names of the seeders to run.
	 * @returns The seeders, in the order they run.
	 * @throws {DuplicateSeederError} When two seeders have the same name.
	 * @throws {UnknownSeederError} When a name in `only` or a class in `after` is not declared.
	 * @throws {SeederCycleError} When seeders run after each other in a cycle.
	 */
	public static plan(graph: ModuleGraph, only: readonly string[] = []): PlannedSeeder[] {
		const all: PlannedSeeder[] = [];
		const byClass = new Map<SeederClass, PlannedSeeder>();
		const byName = new Map<string, PlannedSeeder>();
		for (const { item, module } of graph.collect('seeders')) {
			const seeder = item as SeederClass;
			const metadata = metadataOf(seeder);
			if (!metadata) {
				throw new ElysiumError(
					`${seeder.name}, listed in the seeders of ${module.id}, is not decorated with @Seeder.register().`
				);
			}
			const planned: PlannedSeeder = {
				name: Seeder.nameOf(seeder, module),
				seeder,
				module,
				connection: metadata.connection ?? 'default',
				manual: metadata.manual ?? false
			};
			const existing = byName.get(planned.name) ?? byClass.get(seeder);
			if (existing) throw new DuplicateSeederError(planned.name, [existing.module.id, module.id]);
			all.push(planned);
			byClass.set(seeder, planned);
			byName.set(planned.name, planned);
		}

		for (const name of only) if (!byName.has(name)) throw new UnknownSeederError(name);
		const kept = new Set(all.filter((s) => (only.length > 0 ? only.includes(s.name) : !s.manual)));

		const before = (planned: PlannedSeeder): PlannedSeeder[] =>
			metadataOf(planned.seeder)!
				.after()
				.map((cls) => {
					const found = byClass.get(cls);
					if (!found) throw new UnknownSeederError(cls?.name ?? String(cls), planned.name);
					return found;
				});

		// Depth-first, in declaration order, so that seeders without constraints keep it.
		const ordered: PlannedSeeder[] = [];
		const done = new Set<PlannedSeeder>();
		const stack: PlannedSeeder[] = [];
		const visit = (planned: PlannedSeeder): void => {
			if (done.has(planned)) return;
			const at = stack.indexOf(planned);
			if (at !== -1) {
				throw new SeederCycleError([...stack.slice(at), planned].map((s) => s.name));
			}
			stack.push(planned);
			for (const dependency of before(planned)) visit(dependency);
			stack.pop();
			done.add(planned);
			if (kept.has(planned)) ordered.push(planned);
		};
		for (const planned of all) visit(planned);
		return ordered;
	}

	/**
	 * Runs a planned seeder in its module, in a transaction on its connection.
	 * @param planned The seeder to run.
	 * @param input The options of the run.
	 */
	public static async execute(planned: PlannedSeeder, input: SeederInput): Promise<void> {
		const transaction = Service.get<TransactionRunner>(DATABASE_TRANSACTION_SERVICE);
		if (!transaction) {
			throw new ElysiumError(
				`Seeders run in a transaction, and no "${DATABASE_TRANSACTION_SERVICE}" service is registered: import a database module such as DrizzleModule.`
			);
		}
		await ModuleContext.run(planned.module, () =>
			transaction(async () => {
				const seeder = new (planned.seeder as unknown as new () => Seeder)();
				seeder.#input = input;
				await Service.invoke(seeder, 'run');
			}, planned.connection)
		);
	}

	/** The options of the run: `--file` and the `--arg` pairs. */
	protected get input(): SeederInput {
		return this.#input;
	}

	/**
	 * Writes the rows. Its parameters take services with `@Service.inject()` or
	 * `@Service.injectAll()`, resolved in the module that lists the seeder.
	 */
	protected abstract run(...services: any[]): Promise<void>;
}
