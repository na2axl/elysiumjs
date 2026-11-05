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
import type { ServiceToken } from './token';

import { AsyncLocalStorage } from 'node:async_hooks';

import {
	CircularDependencyError,
	DuplicateGlobalServiceError,
	ElysiumError,
	EnvironmentSkippedModuleError,
	OutsideRequestScopeError,
	ScopeMismatchError,
	ServiceNotFoundError,
	ServiceNotReadyError,
	ServiceNotVisibleError
} from './errors';
import { getLogger } from './logger';
import { Metadata } from './metadata';
import { ModuleContext } from './module-context';
import { ServiceScope } from './service';
import { tokenLabel, tokenOf } from './token';
import { Symbols } from './utils';

/**
 * A service registered in the container.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ContainerEntry = {
	/** The token the service is registered under: its name, or its class. */
	token: ServiceToken;

	/** A readable name for messages. Never used to look the service up. */
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

	/** The service tokens `owner` exports, or `true` when it exports all its services. */
	exportsOf(owner: ModuleNode): readonly ServiceToken[] | true;
};

type InjectedService = { token: ServiceToken; index: number };

/** The request-scoped instances of the request being handled. */
type RequestStore = Map<ContainerEntry, Instantiation>;

type Instantiation = { instance: unknown; ready: Promise<void> | undefined };

const GLOBAL_OWNER = '<global>';

const globalScope = new Map<ServiceToken, ContainerEntry>();
const moduleScopes = new Map<ModuleNode, Map<ServiceToken, ContainerEntry>>();
const requestStorage = new AsyncLocalStorage<RequestStore>();
const keyedRequestStores = new WeakMap<object, RequestStore>();
const building: ContainerEntry[] = [];
const constructedEntries: { entry: ContainerEntry; instance: unknown }[] = [];

let overridden: ReadonlySet<ServiceToken> = new Set();
let visibility: VisibilityResolver | null = null;
let moduleInitHook: ((owner: ModuleNode) => Promise<void> | void) | null = null;
let skippedLookup:
	((token: ServiceToken) => { module: string; environment: string } | null) | null = null;

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
 * Runs the entry's `create` in its owner's context, tracking the entries being built
 * so that a dependency cycle is reported rather than overflowing the stack.
 */
const construct = (entry: ContainerEntry): unknown => {
	const at = building.indexOf(entry);
	if (at !== -1) {
		throw new CircularDependencyError([...building.slice(at), entry].map((e) => e.name));
	}
	building.push(entry);
	try {
		return inOwnerContext(entry.owner, entry.create);
	} finally {
		building.pop();
	}
};

/**
 * Calls `onDestroy` on the instances of a request store, dependants first, each in its owner's
 * context. A failing hook is logged and does not stop the others.
 */
const destroyStore = async (store: RequestStore): Promise<void> => {
	const entries = [...store.entries()].reverse();
	store.clear();
	for (const [entry, { instance }] of entries) {
		const onDestroy = (instance as { onDestroy?: () => unknown } | null)?.onDestroy;
		if (typeof onDestroy !== 'function') continue;
		try {
			await inOwnerContext(entry.owner, () => onDestroy.call(instance));
		} catch (error) {
			getLogger().error('Error while destroying', { target: `service ${entry.name}`, error });
		}
	}
};

/**
 * Builds (or reuses) the instance of an entry. Singletons are recorded once.
 */
const instantiate = (entry: ContainerEntry): Instantiation => {
	if (entry.scope === ServiceScope.REQUEST) {
		// Checked first: a singleton built outside a request would otherwise report the
		// missing request instead of the dependency it must not keep.
		const captive = building.findLast((e) => e.scope !== ServiceScope.FACTORY);
		if (captive?.scope === ServiceScope.SINGLETON) {
			throw new ScopeMismatchError(captive.name, entry.name);
		}
		const store = requestStorage.getStore();
		if (!store) throw new OutsideRequestScopeError(entry.name);
		const existing = store.get(entry);
		if (existing) return existing;
		const instance = construct(entry);
		const instantiation: Instantiation = { instance, ready: undefined };
		const ready = runOnInit(entry, instance);
		if (ready) {
			// Once settled, the instance is served synchronously; a failure is forgotten, so that
			// the next resolution in the request builds it again.
			instantiation.ready = ready.then(
				() => {
					instantiation.ready = undefined;
				},
				(error) => {
					if (store.get(entry) === instantiation) store.delete(entry);
					throw error;
				}
			);
			instantiation.ready.catch(() => {});
		}
		store.set(entry, instantiation);
		return instantiation;
	}

	if (entry.scope === ServiceScope.FACTORY) {
		const instance = construct(entry);
		const ready = runOnInit(entry, instance);
		ready?.catch(() => {});
		return { instance, ready };
	}

	if (entry.initFailure) throw entry.initFailure.error;

	if ('instance' in entry) {
		return { instance: entry.instance, ready: entry.initialised ? undefined : entry.initPromise };
	}

	const instance = construct(entry);
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
	entry.owner !== null && (entry.scope !== ServiceScope.SINGLETON || !('instance' in entry));

const entryValue = (entry: ContainerEntry): unknown => {
	if (needsOwnerInit(entry) && moduleInitHook) {
		const pending = moduleInitHook(entry.owner!);
		if (isPromise(pending)) {
			pending.catch(() => {});
			throw new ServiceNotReadyError(entry.name, entry.owner?.id ?? null, entry.token);
		}
	}

	const { instance, ready } = instantiate(entry);
	if (ready) throw new ServiceNotReadyError(entry.name, entry.owner?.id ?? null, entry.token);
	return instance;
};

/**
 * Awaits everything an entry needs before it can be built synchronously: its owning
 * module's initialisation and, recursively, its injected dependencies.
 */
const prepare = async (entry: ContainerEntry, path: readonly ContainerEntry[]): Promise<void> => {
	const at = path.indexOf(entry);
	if (at !== -1) {
		throw new CircularDependencyError([...path.slice(at), entry].map((e) => e.name));
	}
	const trail = [...path, entry];
	if (needsOwnerInit(entry) && moduleInitHook) {
		await moduleInitHook(entry.owner!);
	}
	if (!entry.cls || ('instance' in entry && entry.scope === ServiceScope.SINGLETON)) return;

	const dependencies: InjectedService[] = Metadata.get(Symbols.services, entry.cls) ?? [];
	// Look dependencies up synchronously, in the owner's context.
	const found = inOwnerContext(entry.owner, () =>
		dependencies.map((dependency) => Container.lookup(dependency.token, ModuleContext.current()))
	);
	for (const dependency of found) {
		if (!dependency) continue;
		if (dependency.entry.scope === ServiceScope.SINGLETON) {
			await entryValueAsync(dependency.entry, trail);
		} else if (
			dependency.entry.scope === ServiceScope.REQUEST &&
			!trail.some((e) => e.scope === ServiceScope.SINGLETON) &&
			requestStorage.getStore()
		) {
			// Built ahead in the request store, so that the dependant finds it ready. Under a
			// singleton, it is left to fail with a ScopeMismatchError when it is built.
			await entryValueAsync(dependency.entry, trail);
		} else {
			await prepare(dependency.entry, trail);
		}
	}
};

const entryValueAsync = async (
	entry: ContainerEntry,
	path: readonly ContainerEntry[] = []
): Promise<unknown> => {
	await prepare(entry, path);
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
	 * @returns The token the service was registered under: its name, or its class.
	 * @throws {DuplicateGlobalServiceError} If a global service with that name already exists.
	 */
	export function register(
		owner: ModuleNode | null,
		def: ServiceDefinition,
		config: unknown
	): ServiceToken {
		const isClass = typeof def === 'function';
		const options: Partial<ServiceFactoryDefinition> = isClass
			? (Metadata.get(Symbols.serviceOptions, def) ?? {})
			: def;
		const token: ServiceToken = options.name ?? (isClass ? def : '');
		if (overridden.has(token)) return token;

		add({
			token,
			name: tokenLabel(token),
			scope: options.scope ?? ServiceScope.SINGLETON,
			global: options.global ?? owner === null,
			owner,
			cls: isClass ? def : undefined,
			create: isClass
				? () => make(def)
				: () => def.factory(config, (service) => require(service, tokenLabel(def.name))),
			initialised: false
		});

		return token;
	}

	/**
	 * Adds a prebuilt entry. A global entry goes to the global scope, any other to its owner's scope.
	 * @throws {DuplicateGlobalServiceError} If the name is already taken in the global scope.
	 */
	export function add(entry: ContainerEntry): void {
		if (entry.global || !entry.owner) {
			const existing = globalScope.get(entry.token);
			if (existing) {
				throw new DuplicateGlobalServiceError(entry.name, [
					ownerId(existing.owner),
					ownerId(entry.owner)
				]);
			}
			globalScope.set(entry.token, entry);
			return;
		}

		let scope = moduleScopes.get(entry.owner);
		if (!scope) {
			scope = new Map();
			moduleScopes.set(entry.owner, scope);
		}
		if (scope.has(entry.token)) {
			throw new ElysiumError(
				`Service "${entry.name}" is declared twice in module ${entry.owner.id}.`
			);
		}
		scope.set(entry.token, entry);
	}

	/**
	 * Declares global service names that win over module registrations: `register` skips
	 * any definition with one of these names, so lookups reach the global entry.
	 * Pass `null` to clear.
	 */
	export function setOverrides(tokens: Iterable<ServiceToken> | null): void {
		overridden = new Set([...(tokens ?? [])].map(tokenOf));
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
		lookup: ((token: ServiceToken) => { module: string; environment: string } | null) | null
	): void {
		skippedLookup = lookup;
	}

	/**
	 * Finds a service visible from `from`: its own scope, then the exports of the modules
	 * it can see, then the global scope. Without `from`, only the global scope is searched.
	 */
	export function lookup(
		service: ServiceToken,
		from: ModuleNode | undefined
	): { entry: ContainerEntry; owner: ModuleNode | null } | null {
		const name = tokenOf(service);
		const found = (entry: ContainerEntry | undefined) =>
			entry ? { entry, owner: entry.owner } : null;

		if (from) {
			const own = moduleScopes.get(from)?.get(name);
			if (own) return found(own);

			for (const imported of visibility?.visibleOwners(from) ?? []) {
				const exported = visibility!.exportsOf(imported);
				if (exported === true || exported.some((token) => tokenOf(token) === name)) {
					const entry = moduleScopes.get(imported)?.get(name);
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
	export function get(service: ServiceToken): unknown {
		const found = lookup(service, ModuleContext.current());
		return found ? entryValue(found.entry) : null;
	}

	/**
	 * Gets a service of the global scope, ignoring the services of the current module context.
	 * @returns The service, or `null` if there is no global service with that name.
	 * @throws {ServiceNotReadyError} If the service or its module is still initialising.
	 */
	export function getGlobal(service: ServiceToken): unknown {
		const entry = globalScope.get(tokenOf(service));
		return entry ? entryValue(entry) : null;
	}

	/**
	 * Like {@link get}, but awaits the `onInit` of the service and of its owning module.
	 * @throws {ServiceNotFoundError | ServiceNotVisibleError | EnvironmentSkippedModuleError}
	 */
	export async function resolve(service: ServiceToken, requester: string): Promise<unknown> {
		const found = lookup(service, ModuleContext.current());
		if (!found) throw notFound(service, requester);
		return entryValueAsync(found.entry);
	}

	/**
	 * Awaits everything `cls` injects, so that {@link make} can then build it synchronously:
	 * module initialisation, singletons and, inside a request scope, request-scoped services
	 * with an asynchronous `onInit`.
	 * @param cls The class about to be built from the current module context.
	 */
	export function prepareClass(cls: Class<unknown>): Promise<void> {
		return prepare(
			{
				token: cls,
				name: cls.name,
				scope: ServiceScope.FACTORY,
				global: false,
				owner: ModuleContext.current() ?? null,
				create: () => undefined,
				initialised: false,
				cls
			},
			[]
		);
	}

	/**
	 * Awaits a service like {@link resolve}, but returns `null` when it is not visible from the
	 * current module context, like {@link get}. A factory service is built once, with its `onInit` done.
	 * @param service The service token.
	 */
	export async function resolveVisible(service: ServiceToken): Promise<unknown> {
		const found = lookup(service, ModuleContext.current());
		return found ? entryValueAsync(found.entry) : null;
	}

	/**
	 * Builds `cls` with its injected dependencies, resolved from the current module context.
	 * @throws {ServiceNotFoundError | ServiceNotVisibleError | EnvironmentSkippedModuleError}
	 */
	export function make<T>(cls: Class<T>): T {
		const dependencies: InjectedService[] = Metadata.get(Symbols.services, cls) ?? [];
		const params: unknown[] = [];
		for (const dependency of dependencies) {
			params[dependency.index] = require(dependency.token, cls.name);
		}
		return new cls(...params);
	}

	/**
	 * Instantiates a class that is kept for the app lifetime, like {@link make}. A request-scoped
	 * dependency throws {@link ScopeMismatchError}, since the instance would keep the first
	 * request's copy.
	 * @param cls The class to instantiate.
	 */
	export function makeSingleton<T>(cls: Class<T>): T {
		const marker = { token: cls, name: cls.name, scope: ServiceScope.SINGLETON } as ContainerEntry;
		building.push(marker);
		try {
			return make(cls);
		} finally {
			building.pop();
		}
	}

	/** Gets a visible service, throwing rather than returning `null`. */
	function require(service: ServiceToken, requester: string): any {
		const found = lookup(service, ModuleContext.current());
		if (!found) throw notFound(service, requester);
		return entryValue(found.entry);
	}

	/** Explains why `name` can't be resolved from the current context. */
	function notFound(service: ServiceToken, requester: string): ElysiumError {
		const token = tokenOf(service);
		const name = tokenLabel(token);
		const skipped = skippedLookup?.(token);
		if (skipped) {
			return new EnvironmentSkippedModuleError(
				name,
				requester,
				skipped.module,
				skipped.environment
			);
		}

		const hidden = [...moduleScopes.values()]
			.map((scope) => scope.get(token))
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

	/** Whether the global scope has a service with that token. */
	export const hasGlobal = (service: ServiceToken): boolean => globalScope.has(tokenOf(service));

	/** The names registered in the global scope (services registered by class are left out). */
	export const globalNames = (): string[] =>
		[...globalScope.keys()].filter((token): token is string => typeof token === 'string');

	/** Removes a service from the global scope. */
	export const removeGlobal = (service: ServiceToken): void => {
		globalScope.delete(tokenOf(service));
	};

	/**
	 * Runs `fn` in a request scope: request-scoped services resolved inside it, including in the
	 * asynchronous work it starts, get one instance for the whole run.
	 *
	 * Without `key`, a run inside another request scope joins it. With `key` (such as the request
	 * object), every run with the same key shares one scope, so separate hooks of one request see
	 * the same instances.
	 * @param fn The work to run.
	 * @param key The object the scope belongs to.
	 */
	export const runInRequestScope = <T>(fn: () => T, key?: object): T => {
		let store = key ? keyedRequestStores.get(key) : requestStorage.getStore();
		const owned = !key && !store;
		if (!store) {
			store = new Map();
			if (key) keyedRequestStores.set(key, store);
		}
		if (!owned) return requestStorage.run(store, fn);

		const created = store;
		let result: T;
		try {
			result = requestStorage.run(created, fn);
		} catch (error) {
			void destroyStore(created);
			throw error;
		}
		if (!isPromise(result)) {
			void destroyStore(created);
			return result;
		}
		return result.finally(() => destroyStore(created)) as T;
	};

	/**
	 * Ends the request scope of `key`: removes its store and calls `onDestroy` on its instances,
	 * the last created first, each in its owner's module context. Errors are logged, never thrown.
	 * Disposing a scope twice, or one that never existed, does nothing.
	 * @param key The object the scope was started with.
	 */
	export const disposeRequestScope = async (key: object): Promise<void> => {
		const store = keyedRequestStores.get(key);
		if (!store) return;
		keyedRequestStores.delete(key);
		await destroyStore(store);
	};

	/** Whether the current code runs in a request scope. */
	export const inRequestScope = (): boolean => requestStorage.getStore() !== undefined;

	/** Clears the global scope. */
	export const clearGlobal = (): void => {
		globalScope.clear();
	};

	/** The live singletons, in construction order (those whose `onInit` failed are left out). Returns a snapshot. */
	export const constructed = (): readonly {
		token: ServiceToken;
		name: string;
		instance: unknown;
		owner: ModuleNode | null;
	}[] =>
		constructedEntries
			.filter(({ entry }) => !entry.initFailure)
			.map(({ entry, instance }) => ({
				token: entry.token,
				name: entry.name,
				instance,
				owner: entry.owner
			}));

	/**
	 * Forgets the singletons whose `onInit` failed, so that the next resolution builds them
	 * again.
	 */
	export function forgetFailures(): void {
		const failed = new Set<ContainerEntry>();
		for (const entries of [globalScope, ...moduleScopes.values()]) {
			for (const entry of entries.values()) if (entry.initFailure) failed.add(entry);
		}
		for (const entry of failed) {
			delete entry.instance;
			delete entry.initPromise;
			delete entry.initFailure;
			entry.initialised = false;
		}
		const kept = constructedEntries.filter(({ entry }) => !failed.has(entry));
		constructedEntries.splice(0, constructedEntries.length, ...kept);
	}

	/** Clears every scope and the construction record. */
	export function reset(): void {
		globalScope.clear();
		moduleScopes.clear();
		constructedEntries.length = 0;
	}
}
