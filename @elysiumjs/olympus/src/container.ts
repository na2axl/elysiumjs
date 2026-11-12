// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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
import type { Environment } from './environments';
import type { ModuleNode } from './module-graph';
import type { ServiceDefinition, ServiceFactoryDefinition } from './service';
import type { Injection, ServiceTag, ServiceToken } from './token';

import { AsyncLocalStorage } from 'node:async_hooks';

import {
	CircularDependencyError,
	DuplicateGlobalServiceError,
	ElysiumError,
	EnvironmentSkippedModuleError,
	EnvironmentSkippedServiceError,
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
 * @author Axel Nana <ax.lnana@outlook.com>
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

	/** The names of the tags the service is registered with. */
	tags?: readonly string[];
};

/**
 * Supplies the visibility rules of the module graph to the container.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type VisibilityResolver = {
	/** The modules whose exports `node` can see. */
	visibleOwners(node: ModuleNode): readonly ModuleNode[];

	/** The service tokens `owner` exports, or `true` when it exports all its services. */
	exportsOf(owner: ModuleNode): readonly ServiceToken[] | true;

	/** The active modules of the application, whose tagged services every module sees. */
	readonly nodes?: readonly ModuleNode[];
};

/** The request-scoped instances of the request being handled. */
type RequestStore = Map<ContainerEntry, Instantiation>;

type Instantiation = { instance: unknown; ready: Promise<void> | undefined };

const GLOBAL_OWNER = '<global>';

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const tagNames = (tags: readonly ServiceTag[] | undefined): string[] => [
	...new Set((tags ?? []).map((tag) => tag.tag))
];

/** Adds an entry to the index of each of its tags. */
const indexTags = (entry: ContainerEntry, tags: readonly string[]): void => {
	for (const tag of tags) {
		const entries = tagged.get(tag) ?? [];
		if (!entries.includes(entry)) entries.push(entry);
		tagged.set(tag, entries);
	}
};

/** Removes entries from the tag index. */
const unindexTags = (drop: (entry: ContainerEntry) => boolean): void => {
	for (const [tag, entries] of tagged) {
		const kept = entries.filter((entry) => !drop(entry));
		if (kept.length > 0) tagged.set(tag, kept);
		else tagged.delete(tag);
	}
};

const globalScope = new Map<ServiceToken, ContainerEntry>();
const moduleScopes = new Map<ModuleNode, Map<ServiceToken, ContainerEntry>>();
/** The entries of each tag, in registration order. */
const tagged = new Map<string, ContainerEntry[]>();
const requestStorage = new AsyncLocalStorage<RequestStore>();
const keyedRequestStores = new WeakMap<object, RequestStore>();
/** The disposals of keyed scopes, so that a later dispose of the same key waits for them. */
const keyedDisposals = new WeakMap<object, Promise<void>>();
const building: ContainerEntry[] = [];
const constructedEntries: { entry: ContainerEntry; instance: unknown }[] = [];

let overridden: ReadonlySet<ServiceToken> = new Set();
let visibility: VisibilityResolver | null = null;
let moduleInitHook: ((owner: ModuleNode) => Promise<void> | void) | null = null;
/** Why a service is not registered: its module is skipped, or the service itself is. */
type SkippedService =
	| { readonly module: string; readonly environment: Environment }
	| { readonly env: readonly Environment[]; readonly environment: Environment };

let skippedLookup: ((token: ServiceToken) => SkippedService | null) | null = null;

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

	const dependencies: Injection[] = Metadata.get(Symbols.services, entry.cls) ?? [];
	// Look dependencies up synchronously, in the owner's context.
	const found = inOwnerContext(entry.owner, () => {
		const from = ModuleContext.current();
		return dependencies.flatMap((dependency) =>
			'tag' in dependency
				? Container.lookupAll(dependency.tag, from)
				: [Container.lookup(dependency.token, from)?.entry].filter(isDefined)
		);
	});
	for (const dependency of found) {
		if (dependency.scope === ServiceScope.SINGLETON) {
			await entryValueAsync(dependency, trail);
		} else if (
			dependency.scope === ServiceScope.REQUEST &&
			!trail.some((e) => e.scope === ServiceScope.SINGLETON) &&
			requestStorage.getStore()
		) {
			// Built ahead in the request store, so that the dependant finds it ready. Under a
			// singleton, it is left to fail with a ScopeMismatchError when it is built.
			await entryValueAsync(dependency, trail);
		} else {
			await prepare(dependency, trail);
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
		const tags = tagNames(options.tags);
		if (overridden.has(token)) {
			// The override stands in for the service in its tags too.
			const override = globalScope.get(token);
			if (override) indexTags(override, tags);
			return token;
		}

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
			initialised: false,
			tags
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
			indexTags(entry, entry.tags ?? []);
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
		indexTags(entry, entry.tags ?? []);
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
		lookup: ((token: ServiceToken) => SkippedService | null) | null
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
	 * Finds the services registered with a tag, in registration order: the global ones, the ones of
	 * `from`, and the ones of every active module of the application. A tag is an extension point
	 * open to the whole application, so a module sees the tagged services of modules it does not
	 * import; looking them up by token still follows the visibility rules.
	 */
	export function lookupAll(tag: ServiceTag, from: ModuleNode | undefined): ContainerEntry[] {
		const nodes = new Set(visibility?.nodes ?? []);
		return (tagged.get(tag.tag) ?? []).filter(
			(entry) => entry.global || !entry.owner || entry.owner === from || nodes.has(entry.owner)
		);
	}

	/**
	 * Gets every service registered with a tag, from the current module context.
	 * @returns The services, in registration order; empty when none has the tag.
	 * @throws {ServiceNotReadyError} If a service or its module is still initialising.
	 */
	export function getAll(tag: ServiceTag): unknown[] {
		return lookupAll(tag, ModuleContext.current()).map(entryValue);
	}

	/**
	 * Like {@link getAll}, but awaits the `onInit` of each service and of its owning module.
	 */
	export async function resolveAll(tag: ServiceTag): Promise<unknown[]> {
		const instances: unknown[] = [];
		for (const entry of lookupAll(tag, ModuleContext.current())) {
			instances.push(await entryValueAsync(entry));
		}
		return instances;
	}

	/**
	 * Awaits a found entry like {@link resolve}: its module's initialisation, its dependencies and
	 * its `onInit`.
	 */
	export function resolveEntry(entry: ContainerEntry): Promise<unknown> {
		return entryValueAsync(entry);
	}

	/**
	 * Awaits what a parameter receives from the container: a service, `null` when it is not
	 * visible, or every service of a tag.
	 */
	export function resolveInjection(injection: Injection): Promise<unknown> {
		return 'tag' in injection ? resolveAll(injection.tag) : resolveVisible(injection.token);
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
	 * @throws {ServiceNotFoundError | ServiceNotVisibleError | EnvironmentSkippedModuleError | EnvironmentSkippedServiceError}
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
	 * @throws {ServiceNotFoundError | ServiceNotVisibleError | EnvironmentSkippedModuleError | EnvironmentSkippedServiceError}
	 */
	export function make<T>(cls: Class<T>): T {
		const dependencies: Injection[] = Metadata.get(Symbols.services, cls) ?? [];
		const params: unknown[] = [];
		for (const dependency of dependencies) {
			params[dependency.index] =
				'tag' in dependency ? getAll(dependency.tag) : require(dependency.token, cls.name);
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

	/**
	 * Gets a visible service, throwing rather than returning `null`.
	 * @throws {ServiceNotFoundError | ServiceNotVisibleError | EnvironmentSkippedModuleError | EnvironmentSkippedServiceError}
	 * @throws {ServiceNotReadyError} If the service or its module is still initialising.
	 */
	export function require(service: ServiceToken, requester: string): any {
		const found = lookup(service, ModuleContext.current());
		if (!found) throw notFound(service, requester);
		return entryValue(found.entry);
	}

	/** Explains why `name` can't be resolved from the current context. */
	function notFound(service: ServiceToken, requester: string): ElysiumError {
		const token = tokenOf(service);
		const name = tokenLabel(token);
		const skipped = skippedLookup?.(token);
		if (skipped && 'module' in skipped) {
			return new EnvironmentSkippedModuleError(
				name,
				requester,
				skipped.module,
				skipped.environment
			);
		}
		if (skipped) {
			return new EnvironmentSkippedServiceError(name, requester, skipped.env, skipped.environment);
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

	/** The modules that declare a service with that token in their own scope, in registration order. */
	export const ownersOf = (service: ServiceToken): ModuleNode[] => {
		const token = tokenOf(service);
		return [...moduleScopes].filter(([, scope]) => scope.has(token)).map(([node]) => node);
	};

	/** Whether the global scope has a service with that token. */
	export const hasGlobal = (service: ServiceToken): boolean => globalScope.has(tokenOf(service));

	/** The names registered in the global scope (services registered by class are left out). */
	export const globalNames = (): string[] =>
		[...globalScope.keys()].filter((token): token is string => typeof token === 'string');

	/** Removes a service from the global scope. */
	export const removeGlobal = (service: ServiceToken): void => {
		const entry = globalScope.get(tokenOf(service));
		globalScope.delete(tokenOf(service));
		if (entry) unindexTags((e) => e === entry);
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
	 * Disposing a scope twice returns the first disposal, so that every caller, such as a host
	 * that keeps the invocation alive until it ends, waits for the `onDestroy` work. Disposing a
	 * scope that never existed does nothing.
	 * @param key The object the scope was started with.
	 */
	export const disposeRequestScope = (key: object): Promise<void> => {
		const store = keyedRequestStores.get(key);
		const running = keyedDisposals.get(key);
		if (!store) return running ?? Promise.resolve();
		keyedRequestStores.delete(key);
		const disposal = Promise.all([running, destroyStore(store)]).then(() => undefined);
		keyedDisposals.set(key, disposal);
		return disposal;
	};

	/** Whether the current code runs in a request scope. */
	export const inRequestScope = (): boolean => requestStorage.getStore() !== undefined;

	/** Clears the global scope. */
	export const clearGlobal = (): void => {
		const entries = new Set(globalScope.values());
		globalScope.clear();
		unindexTags((entry) => entries.has(entry));
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
	 * @param nodes The modules of the application to retry: only their services, and the global
	 * services they own, are forgotten, so that two applications in one process do not reset each
	 * other's failures. Every failed singleton when omitted.
	 */
	export function forgetFailures(nodes?: readonly ModuleNode[]): void {
		const within = nodes ? new Set(nodes) : undefined;
		const scopes = within
			? [globalScope, ...[...within].map((node) => moduleScopes.get(node)).filter(isDefined)]
			: [globalScope, ...moduleScopes.values()];
		const failed = new Set<ContainerEntry>();
		for (const entries of scopes) {
			for (const entry of entries.values()) {
				if (!entry.initFailure) continue;
				if (within && !(entry.owner && within.has(entry.owner))) continue;
				failed.add(entry);
			}
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
		tagged.clear();
		constructedEntries.length = 0;
	}
}
