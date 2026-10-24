// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import type { Class } from 'type-fest';
import type { ModuleNode } from './module-graph';
import type { ServiceDefinition, ServiceFactoryDefinition } from './service';

import {
	DuplicateGlobalServiceError,
	ElysiumError,
	EnvironmentSkippedModuleError,
	ServiceNotFoundError,
	ServiceNotReadyError,
	ServiceNotVisibleError
} from './errors';
import { ModuleContext } from './module-context';
import { ServiceScope } from './service';
import { Symbols } from './utils';

/**
 * A service registered in the container.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ContainerEntry = {
	/** The name the service is registered under. */
	name: string;

	/** The service's scope. */
	scope: ServiceScope;

	/** Whether the service is visible from every scope. */
	global: boolean;

	/** The module that declared the service, or `null` for services registered imperatively. */
	owner: ModuleNode | null;

	/** Builds a new instance of the service. */
	create: () => unknown;

	/** The singleton instance, once built. */
	instance?: unknown;

	/** Whether the instance has been built and its `onInit` has completed. */
	initialised: boolean;

	/** Pending `onInit` of a singleton, when it is asynchronous. */
	initPromise?: Promise<void>;

	/** The error thrown by a singleton's `onInit`, once it has failed. */
	initFailure?: { error: unknown };

	/** The service class, when the entry was registered from one. Used to await its dependencies. */
	cls?: Class<any>;
};

/**
 * Supplies the visibility rules of the module graph to the container.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type VisibilityResolver = {
	/** The modules whose exports `node` can see. */
	visibleOwners(node: ModuleNode): readonly ModuleNode[];

	/** The service names `owner` exports, or `true` when it exports all its services. */
	exportsOf(owner: ModuleNode): readonly string[] | true;
};

type InjectedService = { name: string; index: number };

type Instantiation = { instance: unknown; ready: Promise<void> | undefined };

const GLOBAL_OWNER = '<global>';

const globalScope = new Map<string, ContainerEntry>();
const moduleScopes = new Map<string, Map<string, ContainerEntry>>();
const constructedEntries: { entry: ContainerEntry; instance: unknown }[] = [];

let visibility: VisibilityResolver | null = null;
let moduleInitHook: ((owner: ModuleNode) => Promise<void> | void) | null = null;
let skippedLookup: ((name: string) => { module: string; environment: string } | null) | null = null;

const isPromise = (value: unknown): value is Promise<unknown> =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as { then?: unknown }).then === 'function';

const ownerId = (owner: ModuleNode | null): string => owner?.id ?? GLOBAL_OWNER;

const inOwnerContext = <T>(owner: ModuleNode | null, fn: () => T): T =>
	owner ? ModuleContext.run(owner, fn) : fn();

/**
 * Runs the `onInit` hook of an instance in its owner's context.
 * @returns A promise when the hook is asynchronous.
 */
const runOnInit = (entry: ContainerEntry, instance: unknown): Promise<void> | undefined => {
	const onInit = (instance as { onInit?: () => Promise<void> | void } | null)?.onInit;
	if (typeof onInit !== 'function') return undefined;

	const result = inOwnerContext(entry.owner, () => onInit.call(instance));
	return isPromise(result) ? result.then(() => undefined) : undefined;
};

/**
 * Builds (or reuses) the instance of an entry. Singletons are recorded once.
 */
const instantiate = (entry: ContainerEntry): Instantiation => {
	if (entry.scope === ServiceScope.FACTORY) {
		const instance = inOwnerContext(entry.owner, entry.create);
		return { instance, ready: runOnInit(entry, instance) };
	}

	if (entry.initFailure) throw entry.initFailure.error;

	if ('instance' in entry) {
		return { instance: entry.instance, ready: entry.initialised ? undefined : entry.initPromise };
	}

	const instance = inOwnerContext(entry.owner, entry.create);
	entry.instance = instance;
	constructedEntries.push({ entry, instance });

	let ready: Promise<void> | undefined;
	try {
		ready = runOnInit(entry, instance);
	} catch (error) {
		entry.initFailure = { error };
		throw error;
	}
	if (ready) {
		entry.initPromise = ready.then(
			() => {
				entry.initialised = true;
			},
			(error) => {
				entry.initFailure = { error };
				throw error;
			}
		);
		entry.initPromise.catch(() => {});
	} else {
		entry.initialised = true;
	}

	return { instance, ready: entry.initPromise };
};

/** Whether building this entry requires its owning module to be initialised first. */
const needsOwnerInit = (entry: ContainerEntry): boolean =>
	entry.owner !== null && (entry.scope === ServiceScope.FACTORY || !('instance' in entry));

const entryValue = (entry: ContainerEntry): unknown => {
	if (needsOwnerInit(entry) && moduleInitHook) {
		const pending = moduleInitHook(entry.owner!);
		if (isPromise(pending)) {
			pending.catch(() => {});
			throw new ServiceNotReadyError(entry.name);
		}
	}

	const { instance, ready } = instantiate(entry);
	if (ready) throw new ServiceNotReadyError(entry.name);
	return instance;
};

/**
 * Awaits everything an entry needs before it can be built synchronously: its owning
 * module's initialisation and, recursively, its injected dependencies.
 */
const prepare = async (entry: ContainerEntry): Promise<void> => {
	if (needsOwnerInit(entry) && moduleInitHook) {
		await moduleInitHook(entry.owner!);
	}
	if (!entry.cls || ('instance' in entry && entry.scope !== ServiceScope.FACTORY)) return;

	const dependencies: InjectedService[] = Reflect.getMetadata(Symbols.services, entry.cls) ?? [];
	// Look dependencies up synchronously, in the owner's context.
	const found = inOwnerContext(entry.owner, () =>
		dependencies.map((dependency) => Container.lookup(dependency.name, ModuleContext.current()))
	);
	for (const dependency of found) {
		if (!dependency) continue;
		if (dependency.entry.scope === ServiceScope.FACTORY) await prepare(dependency.entry);
		else await entryValueAsync(dependency.entry);
	}
};

const entryValueAsync = async (entry: ContainerEntry): Promise<unknown> => {
	await prepare(entry);
	const { instance, ready } = instantiate(entry);
	await ready;
	return instance;
};

/**
 * The scoped service container: a global scope plus one scope per module.
 * Visibility between module scopes is supplied by the module graph.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace Container {
	/**
	 * Registers a service definition.
	 * @param owner The declaring module, or `null` for a service registered outside any module.
	 * @param def A service class or factory definition.
	 * @param config The owning module's resolved config, handed to factory definitions.
	 * @returns The name the service was registered under.
	 * @throws {DuplicateGlobalServiceError} If a global service with that name already exists.
	 */
	export function register(
		owner: ModuleNode | null,
		def: ServiceDefinition,
		config: unknown
	): string {
		const isClass = typeof def === 'function';
		const options: Partial<ServiceFactoryDefinition> = isClass
			? (Reflect.getMetadata(Symbols.serviceOptions, def) ?? {})
			: def;
		const name = options.name ?? (isClass ? def.name : '');

		add({
			name,
			scope: options.scope ?? ServiceScope.SINGLETON,
			global: options.global ?? owner === null,
			owner,
			cls: isClass ? def : undefined,
			create: isClass
				? () => make(def)
				: () => def.factory(config, (service) => require(service, def.name)),
			initialised: false
		});

		return name;
	}

	/**
	 * Adds a prebuilt entry. A global entry goes to the global scope, any other to its owner's scope.
	 * @throws {DuplicateGlobalServiceError} If the name is already taken in the global scope.
	 */
	export function add(entry: ContainerEntry): void {
		if (entry.global || !entry.owner) {
			const existing = globalScope.get(entry.name);
			if (existing) {
				throw new DuplicateGlobalServiceError(entry.name, [
					ownerId(existing.owner),
					ownerId(entry.owner)
				]);
			}
			globalScope.set(entry.name, entry);
			return;
		}

		let scope = moduleScopes.get(entry.owner.id);
		if (!scope) {
			scope = new Map();
			moduleScopes.set(entry.owner.id, scope);
		}
		if (scope.has(entry.name)) {
			throw new ElysiumError(
				`Service "${entry.name}" is declared twice in module ${entry.owner.id}.`
			);
		}
		scope.set(entry.name, entry);
	}

	/**
	 * Sets the module graph's visibility rules. Without a resolver, a module only sees
	 * its own services and the global ones.
	 */
	export function setVisibility(resolver: VisibilityResolver | null): void {
		visibility = resolver;
	}

	/**
	 * Sets the hook called before building a service whose owning module may not be initialised.
	 * It returns `void` when the module is ready, or a promise while initialisation is pending.
	 */
	export function setModuleInitHook(
		hook: ((owner: ModuleNode) => Promise<void> | void) | null
	): void {
		moduleInitHook = hook;
	}

	/**
	 * Sets the lookup consulted when a name isn't found, to report services
	 * that belong to modules skipped for the current environment.
	 */
	export function setSkippedLookup(
		lookup: ((name: string) => { module: string; environment: string } | null) | null
	): void {
		skippedLookup = lookup;
	}

	/**
	 * Finds a service visible from `from`: its own scope, then the exports of the modules
	 * it can see, then the global scope. Without `from`, only the global scope is searched.
	 */
	export function lookup(
		name: string,
		from: ModuleNode | undefined
	): { entry: ContainerEntry; owner: ModuleNode | null } | null {
		const found = (entry: ContainerEntry | undefined) =>
			entry ? { entry, owner: entry.owner } : null;

		if (from) {
			const own = moduleScopes.get(from.id)?.get(name);
			if (own) return found(own);

			for (const imported of visibility?.visibleOwners(from) ?? []) {
				const exported = visibility!.exportsOf(imported);
				if (exported === true || exported.includes(name)) {
					const entry = moduleScopes.get(imported.id)?.get(name);
					if (entry) return found(entry);
				}
			}
		}

		return found(globalScope.get(name));
	}

	/**
	 * Gets a service visible from the current module context.
	 * @returns The service, or `null` if none is visible.
	 * @throws {ServiceNotReadyError} If the service or its module is still initialising.
	 */
	export function get(name: string): unknown {
		const found = lookup(name, ModuleContext.current());
		return found ? entryValue(found.entry) : null;
	}

	/**
	 * Like {@link get}, but awaits the `onInit` of the service and of its owning module.
	 * @throws {ServiceNotFoundError | ServiceNotVisibleError | EnvironmentSkippedModuleError}
	 */
	export async function resolve(name: string, requester: string): Promise<unknown> {
		const found = lookup(name, ModuleContext.current());
		if (!found) throw notFound(name, requester);
		return entryValueAsync(found.entry);
	}

	/**
	 * Builds `cls` with its injected dependencies, resolved from the current module context.
	 * @throws {ServiceNotFoundError | ServiceNotVisibleError | EnvironmentSkippedModuleError}
	 */
	export function make<T>(cls: Class<T>): T {
		const dependencies: InjectedService[] = Reflect.getMetadata(Symbols.services, cls) ?? [];
		const params: unknown[] = [];
		for (const dependency of dependencies) {
			params[dependency.index] = require(dependency.name, cls.name);
		}
		return new cls(...params);
	}

	/** Gets a visible service, throwing rather than returning `null`. */
	function require(service: string | Class<any>, requester: string): any {
		const name = typeof service === 'string' ? service : service.name;
		const found = lookup(name, ModuleContext.current());
		if (!found) throw notFound(name, requester);
		return entryValue(found.entry);
	}

	/** Explains why `name` can't be resolved from the current context. */
	function notFound(name: string, requester: string): ElysiumError {
		const skipped = skippedLookup?.(name);
		if (skipped) {
			return new EnvironmentSkippedModuleError(
				name,
				requester,
				skipped.module,
				skipped.environment
			);
		}

		const hidden = [...moduleScopes.values()]
			.map((scope) => scope.get(name))
			.find((entry) => entry !== undefined);
		return hidden
			? new ServiceNotVisibleError(
					name,
					requester,
					ModuleContext.current()?.id ?? null,
					hidden.owner?.id ?? null
				)
			: new ServiceNotFoundError(name);
	}

	/** Whether the global scope has a service with that name. */
	export const hasGlobal = (name: string): boolean => globalScope.has(name);

	/** The names registered in the global scope. */
	export const globalNames = (): string[] => [...globalScope.keys()];

	/** Removes a service from the global scope. */
	export const removeGlobal = (name: string): void => {
		globalScope.delete(name);
	};

	/** Clears the global scope. */
	export const clearGlobal = (): void => {
		globalScope.clear();
	};

	/** The live singletons, in construction order (those whose `onInit` failed are left out). Returns a snapshot. */
	export const constructed = (): readonly {
		name: string;
		instance: unknown;
		owner: ModuleNode | null;
	}[] =>
		constructedEntries
			.filter(({ entry }) => !entry.initFailure)
			.map(({ entry, instance }) => ({ name: entry.name, instance, owner: entry.owner }));

	/** Clears every scope and the construction record. */
	export function reset(): void {
		globalScope.clear();
		moduleScopes.clear();
		constructedEntries.length = 0;
	}
}
