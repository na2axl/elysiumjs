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
import type { ServiceTag, ServiceToken } from './token';

import { isString } from 'radash';

import { Container } from './container';
import { Environments } from './environments';
import { ElysiumError } from './errors';
import { Metadata } from './metadata';
import { isServiceTag, serviceTag, tokenLabel, tokenOf } from './token';
import { Symbols } from './utils';

/**
 * The scope of a service.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export enum ServiceScope {
	/**
	 * A single instance of the service is created and shared everywhere it is injected or retrieved.
	 */
	SINGLETON,

	/**
	 * A new instance of the service is created every time it is injected or retrieved.
	 */
	FACTORY,

	/**
	 * One instance of the service is created per request, and shared by everything resolved
	 * while handling that request. Resolving it outside a request throws, and so does injecting
	 * it into a singleton.
	 */
	REQUEST
}

/**
 * A generic service class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type ServiceClass = Class<any>;

/**
 * A typed service class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type TypedServiceClass<T> = Class<T>;

/**
 * Type for a factory function.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type FactoryFn<T> = () => T extends void ? never : T;

/**
 * Utility function to check if a value is a class.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param value The value to check.
 * @returns `true` if the value is a class, `false` otherwise.
 */
const isClass = <T, V>(value: Class<T> | V): value is Class<T> => {
	return typeof value === 'function' && value.prototype && value.prototype.constructor === value;
};

/**
 * Properties required when declaring a service using the `@service()` decorator.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ServiceProps = Partial<{
	/**
	 * The name (token) of the service. Without one, the service is identified by its class:
	 * inject it with `@Service.inject(TheClass)` or by its parameter type, and get it with
	 * `Service.get(TheClass)`.
	 */
	name: string;

	/**
	 * The service's scope.
	 *
	 * Set it to `Scope.SINGLETON` to ensure that only one instance of this service is
	 * used everywhere it is injected or retrieved.
	 *
	 * Set it to `Scope.FACTORY` to ensure that every time you inject or retrieve this
	 * service, you have a new instance created.
	 *
	 * @see ServiceScope
	 */
	scope: ServiceScope;

	/**
	 * Whether the service is visible from every module without being exported.
	 */
	global: boolean;

	/**
	 * The tags the service is registered with: it is part of what `@Service.injectAll(tag)` and
	 * `Service.getAll(tag)` return for each of them.
	 */
	tags: readonly ServiceTag<any>[];

	/**
	 * The environments (`NODE_ENV` values) in which the service is active. In any other, the
	 * service is not registered: it is not injected, and `injectAll` does not return it.
	 */
	env: readonly string[];
}>;

/**
 * Describes a service built by a factory function instead of a class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ServiceFactoryDefinition = {
	/** The token of the service: a name, or a class to register the service by class. */
	name: ServiceToken;

	/** Builds the service from the owning module's config and a resolver for visible services. */
	factory: (config: any, get: <T>(name: string | Class<T>) => T) => unknown;

	/** The service's scope. Defaults to `ServiceScope.SINGLETON`. */
	scope?: ServiceScope;

	/** Whether the service is visible from every module. */
	global?: boolean;

	/** The tags the service is registered with. */
	tags?: readonly ServiceTag<any>[];

	/** The environments (`NODE_ENV` values) in which the service is active. */
	env?: readonly string[];
};

/**
 * Anything a module can list in its `services`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ServiceDefinition = Class<any> | ServiceFactoryDefinition;

const nameOf = (service: ServiceToken): ServiceToken => tokenOf(service);

export namespace Service {
	/**
	 * Marks a class as a service. This only records metadata: the service is registered
	 * when the module that lists it is loaded.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The service options.
	 */
	export const register = (props?: ServiceProps) => {
		return function (target: ServiceClass) {
			Metadata.define(Symbols.serviceOptions, props ?? {}, target);
			Environments.set(target, props?.env);
		};
	};

	/**
	 * Resolves a registered service and set it as a parameter value.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The name or class of the service. Without it, the parameter's type is used,
	 * which needs the compiler to emit decorator metadata (`emitDecoratorMetadata`).
	 * @throws {ElysiumError} When no service is given and the parameter type is unknown.
	 */
	export const inject = (service?: ServiceToken): ParameterDecorator => {
		return function (target, propertyKey, parameterIndex) {
			const services = Metadata.get(Symbols.services, target, propertyKey!) ?? [];
			const types: Function[] = Metadata.get('design:paramtypes', target, propertyKey!) ?? [];
			const type = types[parameterIndex];
			const token = service ?? (type && type !== Object ? (type as ServiceClass) : undefined);
			if (token === undefined) {
				const owner = typeof target === 'function' ? target : target.constructor;
				throw new ElysiumError(
					`Cannot tell which service to inject in parameter ${parameterIndex} of ${tokenLabel(owner as ServiceClass)}${propertyKey ? `.${String(propertyKey)}` : ''}: pass its name or class to @Service.inject().`
				);
			}

			services.push({
				token,
				index: parameterIndex
			});

			Metadata.define(Symbols.services, services, target, propertyKey!);
		};
	};

	/**
	 * Creates a tag, the token of a group of services. Services join it with
	 * `@Service.register({ tags: [tag] })` (or `tags` on a factory definition), and a consumer
	 * receives them all with `@Service.injectAll(tag)` or `Service.getAll(tag)`.
	 *
	 * A tag is an extension point open to the whole application: a module receives the tagged
	 * services of every active module, including the ones it does not import.
	 *
	 * @example
	 * ```ts
	 * export const HealthChecks = Service.tag<HealthCheck>('health.checks');
	 *
	 * @Service.register({ tags: [HealthChecks] })
	 * class DatabaseCheck implements HealthCheck {}
	 *
	 * @Service.register()
	 * class Health {
	 * 	constructor(@Service.injectAll(HealthChecks) private readonly checks: HealthCheck[]) {}
	 * }
	 * ```
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @template T The type every tagged service implements.
	 * @param name The name of the tag, unique in the application. Two tags with the same name are
	 * the same tag.
	 */
	export const tag = <T>(name: string): ServiceTag<T> => serviceTag<T>(name);

	/**
	 * Sets a parameter to every service registered with a tag, in registration order (an empty
	 * array when there is none). The same scope rules as `inject` apply to each of them: a
	 * singleton that receives a request-scoped service throws `ScopeMismatchError`.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param tag The tag, from `Service.tag()`.
	 */
	export const injectAll = (tag: ServiceTag<any>): ParameterDecorator => {
		if (!isServiceTag(tag))
			throw new ElysiumError('@Service.injectAll() expects a tag from Service.tag().');
		return function (target, propertyKey, parameterIndex) {
			const services = Metadata.get(Symbols.services, target, propertyKey!) ?? [];
			services.push({ tag, index: parameterIndex });
			Metadata.define(Symbols.services, services, target, propertyKey!);
		};
	};

	/**
	 * Retrieves every service registered with a tag, in registration order.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param tag The tag, from `Service.tag()`.
	 * @returns The services; empty when none has the tag.
	 * @throws {ServiceNotReadyError} If a service, or its module, is still initialising.
	 */
	export const getAll = <T>(tag: ServiceTag<T>): T[] => Container.getAll(tag) as T[];

	/**
	 * Like `getAll`, but waits for the `onInit` of each service and of its owning module.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param tag The tag, from `Service.tag()`.
	 */
	export const resolveAll = <T>(tag: ServiceTag<T>): Promise<T[]> =>
		Container.resolveAll(tag) as Promise<T[]>;

	/**
	 * Retrieves a service visible from the current module context (global services only
	 * when there is none). Lazy services are built on first access.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The name of the service, or its class.
	 * @returns The service, or `null` if none with that name/type is visible.
	 * @throws {ServiceNotReadyError} If the service, or its module, is still initialising.
	 */
	export const get = <T>(service: ServiceToken | TypedServiceClass<T>): T | null => {
		return Container.get(nameOf(service)) as T | null;
	};

	/**
	 * Like `get`, but waits for the `onInit` of the service and of its owning module.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The name of the service, or its class.
	 * @throws {ServiceNotFoundError | ServiceNotVisibleError | EnvironmentSkippedModuleError}
	 */
	export const resolve = <T>(service: ServiceToken | TypedServiceClass<T>): Promise<T> => {
		return Container.resolve(nameOf(service), 'Service.resolve') as Promise<T>;
	};

	/**
	 * Registers a global lazy service that is only instantiated on first access.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the service.
	 * @param resolver A factory function called on first access.
	 * @throws {DuplicateGlobalServiceError} If a global service with that name exists.
	 */
	export const registerLazy = <T>(name: string, resolver: () => T): void => {
		addGlobal(name, ServiceScope.SINGLETON, resolver);
	};

	/**
	 * Instantiates a service with its dependencies, resolved from the current module context.
	 *
	 * This function always create a new instance of the service, even if the service's scope is `ServiceScope.SINGLETON`
	 * and it has already been registered in the container.
	 *
	 * @author Axel Nana <axel.nana@workbud.com>
	 *
	 * @param service The service class to instantiate.
	 * @throws {ServiceNotFoundError | ServiceNotVisibleError | EnvironmentSkippedModuleError}
	 */
	export const make = <T>(service: TypedServiceClass<T>): T => {
		return Container.make(service);
	};

	/**
	 * Binds a service to the global scope and sets it as a singleton.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class to bind.
	 * @param name An optional name for the service. Without it, the service is bound to its class.
	 */
	export const bind = <T>(service: TypedServiceClass<T>, name?: string): T => {
		const s = Container.makeSingleton(service);
		return instance(name ?? service, s);
	};

	/**
	 * Binds a service to the global scope and sets it as a factory.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name A name for the service.
	 * @param factory The factory function used to instantiate the service.
	 */
	export function factory<T>(name: string, factory: FactoryFn<T>): T;

	/**
	 * Binds a service to the global scope and sets it as a factory.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class to bind.
	 * @param name An optional name for the service. Without it, the service is bound to its class.
	 */
	export function factory<T>(service: TypedServiceClass<T>, name?: string): T;

	/**
	 * Binds a service to the global scope and sets it as a factory.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param serviceOrName The service class to bind or its name.
	 * @param nameOrFactory The service name or a factory function.
	 */
	export function factory<T>(
		serviceOrName: TypedServiceClass<T> | string,
		nameOrFactory?: FactoryFn<T> | string
	): T {
		const serviceName: ServiceToken = isString(serviceOrName)
			? serviceOrName
			: ((nameOrFactory as string | undefined) ?? tokenOf(serviceOrName));

		const create = () => {
			return isClass(serviceOrName) ? make(serviceOrName) : (nameOrFactory as FactoryFn<T>)();
		};

		addGlobal(serviceName, ServiceScope.FACTORY, create);

		return create() as T;
	}

	/**
	 * Binds a service's instance to the global scope.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class or name to bind.
	 * @param instance The instance to bind.
	 * @throws {DuplicateGlobalServiceError} If a global service with that name exists.
	 */
	export const instance = <T>(service: ServiceToken | TypedServiceClass<T>, instance: T): T => {
		addGlobal(nameOf(service), ServiceScope.SINGLETON, () => instance, { instance });
		return instance;
	};

	/**
	 * Removes a service from the global scope.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class or name to remove.
	 */
	export const remove = (service: ServiceToken): void => {
		Container.removeGlobal(nameOf(service));
	};

	/**
	 * Checks if a service exists in the global scope.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class or name to check.
	 * @returns `true` if the service exists, `false` otherwise.
	 */
	export const exists = (service: ServiceToken): boolean => {
		return Container.hasGlobal(nameOf(service));
	};

	/**
	 * The modules that declare a service in their own scope, rather than as a global service, in
	 * registration order. Run code in one of them with `ModuleContext.run()` to resolve the service
	 * as that module sees it.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class or name.
	 * @returns The modules, empty when no module declares it.
	 */
	export const ownersOf = (service: ServiceToken): readonly ModuleNode[] =>
		Container.ownersOf(nameOf(service));

	/**
	 * Checks if a service has already been built, without building it.
	 * Matches by name in any scope (global or module), not only the global one.
	 * Lets modules release only the resources they actually created.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The name or class of the service to check.
	 * @returns `true` if the service has a live instance, `false` otherwise.
	 */
	export const isConstructed = (service: ServiceToken): boolean => {
		const token = tokenOf(service);
		return Container.constructed().some((entry) => entry.token === token);
	};

	/**
	 * Runs `fn` in a request scope: request-scoped services resolved inside it, including in the
	 * asynchronous work it starts, share one instance. HTTP route handlers already run in one.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param fn The work to run, such as a job or a test.
	 */
	export const runInRequestScope = <T>(fn: () => T): T => Container.runInRequestScope(fn);

	/**
	 * Ends the request scope started for `key`, calling `onDestroy` on its request-scoped
	 * instances, the last created first. Errors are logged, never thrown, and a second call does
	 * nothing. Runtimes that keep a scope per request call this once the response is sent.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param key The request object the scope belongs to.
	 */
	export const disposeRequestScope = (key: object): Promise<void> =>
		Container.disposeRequestScope(key);

	/**
	 * Clears the global scope.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const clear = () => {
		Container.clearGlobal();
	};

	/**
	 * Returns an array of global service names matching the given pattern.
	 * Pattern supports '*' (any sequence) and '?' (any single character), similarly to Redis KEYS.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param pattern The glob-like pattern to match service names.
	 * @returns Array of matching service names.
	 */
	export const keys = (pattern: string): string[] => {
		// Escape regex special chars except * and ?
		const regexPattern =
			'^' +
			pattern
				.replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&')
				.replace(/\*/g, '.*')
				.replace(/\?/g, '.') +
			'$';
		const regex = new RegExp(regexPattern);
		return Container.globalNames().filter((key) => regex.test(key));
	};

	const addGlobal = (
		service: ServiceToken,
		scope: ServiceScope,
		create: () => unknown,
		prebuilt?: { instance: unknown }
	): void => {
		const token = tokenOf(service);
		Container.add({
			token,
			name: tokenLabel(token),
			scope,
			global: true,
			owner: null,
			create,
			initialised: prebuilt !== undefined,
			...(prebuilt ? { instance: prebuilt.instance } : {})
		});
	};
}
