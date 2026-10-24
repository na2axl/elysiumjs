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

import { isString } from 'radash';

import { Container } from './container';
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
	FACTORY
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
	 * The name of the service. If not set, it will default to the service class name.
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
}>;

/**
 * Describes a service built by a factory function instead of a class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ServiceFactoryDefinition = {
	/** The name of the service. */
	name: string;

	/** Builds the service from the owning module's config and a resolver for visible services. */
	factory: (config: any, get: <T>(name: string | Class<T>) => T) => unknown;

	/** The service's scope. Defaults to `ServiceScope.SINGLETON`. */
	scope?: ServiceScope;

	/** Whether the service is visible from every module. */
	global?: boolean;
};

/**
 * Anything a module can list in its `services`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ServiceDefinition = Class<any> | ServiceFactoryDefinition;

const nameOf = (service: string | ServiceClass): string =>
	isString(service) ? service : service.name;

export namespace Service {
	/**
	 * Marks a class as a service. This only records metadata: the service is registered
	 * when the module that lists it is loaded.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The service options.
	 */
	export const register = (props?: ServiceProps) => {
		return function (target: ServiceClass) {
			Reflect.defineMetadata(Symbols.serviceOptions, props ?? {}, target);
		};
	};

	/**
	 * Resolves a registered service and set it as a parameter value.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service An optional name for the service. If not set, the name of the parameter's type is used instead.
	 */
	export const inject = (service?: string | ServiceClass): ParameterDecorator => {
		return function (target, propertyKey, parameterIndex) {
			const services = Reflect.getMetadata(Symbols.services, target, propertyKey!) ?? [];
			const types: Function[] =
				Reflect.getMetadata('design:paramtypes', target, propertyKey!) ?? [];
			const name = isString(service) ? service : (service?.name ?? types[parameterIndex].name);

			services.push({
				name,
				index: parameterIndex
			});

			Reflect.defineMetadata(Symbols.services, services, target, propertyKey!);
		};
	};

	/**
	 * Retrieves a service visible from the current module context (global services only
	 * when there is none). Lazy services are built on first access.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The name of the service, or its class.
	 * @returns The service, or `null` if none with that name/type is visible.
	 * @throws {ServiceNotReadyError} If the service, or its module, is still initialising.
	 */
	export const get = <T>(service: string | TypedServiceClass<T>): T | null => {
		return Container.get(nameOf(service)) as T | null;
	};

	/**
	 * Like `get`, but waits for the `onInit` of the service and of its owning module.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The name of the service, or its class.
	 * @throws {ServiceNotFoundError | ServiceNotVisibleError | EnvironmentSkippedModuleError}
	 */
	export const resolve = <T>(service: string | TypedServiceClass<T>): Promise<T> => {
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
	 * @param name An optional name for the service. If not set, the name of the service class is used instead.
	 */
	export const bind = <T>(service: TypedServiceClass<T>, name?: string): T => {
		const s = make(service);
		return instance(name ?? service.name, s);
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
	 * @param name An optional name for the service. If not set, the name of the service class is used instead.
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
		const serviceName = isString(serviceOrName)
			? serviceOrName
			: ((nameOrFactory as string | undefined) ?? serviceOrName.name);

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
	export const instance = <T>(service: string | TypedServiceClass<T>, instance: T): T => {
		addGlobal(nameOf(service), ServiceScope.SINGLETON, () => instance, { instance });
		return instance;
	};

	/**
	 * Removes a service from the global scope.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class or name to remove.
	 */
	export const remove = (service: string | TypedServiceClass<any>): void => {
		Container.removeGlobal(nameOf(service));
	};

	/**
	 * Checks if a service exists in the global scope.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class or name to check.
	 * @returns `true` if the service exists, `false` otherwise.
	 */
	export const exists = (service: string | TypedServiceClass<any>): boolean => {
		return Container.hasGlobal(nameOf(service));
	};

	/**
	 * Checks if a service has already been built, without building it.
	 * Lets modules release only the resources they actually created.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the service to check.
	 * @returns `true` if the service has a live instance, `false` otherwise.
	 */
	export const isConstructed = (name: string): boolean => {
		return Container.constructed().some((entry) => entry.name === name);
	};

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
		name: string,
		scope: ServiceScope,
		create: () => unknown,
		prebuilt?: { instance: unknown }
	): void => {
		Container.add({
			name,
			scope,
			global: true,
			owner: null,
			create,
			initialised: prebuilt !== undefined,
			...(prebuilt ? { instance: prebuilt.instance } : {})
		});
	};
}
