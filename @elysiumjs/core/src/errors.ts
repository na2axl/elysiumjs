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

import type { Environment } from './environments';
import type { ServiceToken } from './token';

/**
 * Base class of every error thrown by the Elysium framework.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class ElysiumError extends Error {
	constructor(message: string) {
		super(message);
		this.name = new.target.name;
	}
}

/**
 * Thrown when the module graph contains an import cycle.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class ModuleCycleError extends ElysiumError {
	constructor(public readonly path: string[]) {
		super(`Module import cycle detected: ${path.join(' -> ')}`);
	}
}

/**
 * Thrown when a class used as a module is not decorated with `@Module`.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidModuleError extends ElysiumError {
	constructor(public readonly className: string) {
		super(`${className} is not a valid module. Decorate it with @Module().`);
	}
}

/**
 * Thrown when two modules declare the same global service.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DuplicateGlobalServiceError extends ElysiumError {
	constructor(
		public readonly serviceName: string,
		public readonly modules: [string, string]
	) {
		super(`Global service "${serviceName}" is declared by both ${modules[0]} and ${modules[1]}.`);
	}
}

/**
 * Thrown when two services of an extension point (`Service.extension()`) have the same name.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DuplicateExtensionError extends ElysiumError {
	constructor(
		public readonly extension: string,
		public readonly extensionName: string,
		public readonly services: [string, string]
	) {
		super(
			`Two services of ${extension} are named "${extensionName}": ${services[0]} and ${services[1]}.`
		);
	}
}

/**
 * Thrown when a class has no options of an extension point (`Service.extension()`).
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class NotAnExtensionError extends ElysiumError {
	constructor(
		public readonly extension: string,
		public readonly className: string
	) {
		super(`${className} is not registered as a service of ${extension}.`);
	}
}

/**
 * Thrown when two modules register the same command.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DuplicateCommandError extends ElysiumError {
	constructor(
		public readonly command: string,
		public readonly modules: [string, string]
	) {
		super(`Command "${command}" is registered by both ${modules[0]} and ${modules[1]}.`);
	}
}

/**
 * Thrown when a module is configured from two conflicting sites.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class ConflictingModuleConfigError extends ElysiumError {
	constructor(
		public readonly module: string,
		public readonly sites: [string, string]
	) {
		super(
			`Module ${module} is configured with conflicting options at ${sites[0]} and ${sites[1]}.`
		);
	}
}

/**
 * Thrown when a module requires configuration that was never provided.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class MissingModuleConfigError extends ElysiumError {
	constructor(
		public readonly module: string,
		public readonly keys: string[]
	) {
		super(`Module ${module} is missing required configuration: ${keys.join(', ')}.`);
	}
}

/**
 * Thrown when a module's configuration is present but invalid.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidModuleConfigError extends ElysiumError {
	constructor(
		public readonly module: string,
		public readonly key: string,
		public readonly reason: string
	) {
		super(`Module ${module} has an invalid "${key}" configuration: ${reason}.`);
	}
}

/**
 * Thrown when a service is requested from a module that cannot see it.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class ServiceNotVisibleError extends ElysiumError {
	constructor(
		public readonly service: string,
		public readonly requester: string,
		public readonly module: string | null,
		public readonly owner: string | null
	) {
		const where = module ? ` in module ${module}` : '';
		const hint = owner ? ` Either import ${owner} or add it to ${owner}'s exports.` : '';
		super(`Service "${service}" requested by ${requester}${where} is not visible.${hint}`);
	}
}

/**
 * Thrown when a service is not registered anywhere.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class ServiceNotFoundError extends ElysiumError {
	constructor(public readonly service: string) {
		super(`Service "${service}" was not found.`);
	}
}

/**
 * Thrown when a service is requested before it has been initialized.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class ServiceNotReadyError extends ElysiumError {
	/**
	 * @param service The service label, used in the message.
	 * @param owner The id of the module owning the service.
	 * @param token The token to pass to `Service.resolve()` to wait for the service.
	 */
	constructor(
		public readonly service: string,
		public readonly owner: string | null = null,
		public readonly token: ServiceToken = service
	) {
		const where = owner ? ` Its module ${owner} initialises asynchronously.` : '';
		super(
			`Service "${service}" is not ready yet.${where} Use "await Service.resolve()" to wait for it. In a command, set "static boot = true" to initialise every module before it runs.`
		);
	}
}

/**
 * Thrown when services depend on each other in a cycle.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class CircularDependencyError extends ElysiumError {
	constructor(public readonly path: string[]) {
		super(`Circular service dependency detected: ${path.join(' -> ')}`);
	}
}

/**
 * Thrown when two different module classes share the same name.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DuplicateModuleNameError extends ElysiumError {
	constructor(public readonly moduleName: string) {
		super(
			`Two different modules are both named "${moduleName}". Module names identify modules in configuration and errors, so they must be unique: rename one of them.`
		);
	}
}

/**
 * Thrown when a service lives in a module skipped for the current environment.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class EnvironmentSkippedModuleError extends ElysiumError {
	constructor(
		public readonly service: string,
		public readonly requester: string,
		public readonly skippedModule: string,
		public readonly environment: Environment
	) {
		super(
			`Service "${service}" requested by ${requester} belongs to module ${skippedModule}, which is skipped in the "${environment}" environment.`
		);
	}
}

/**
 * Thrown when a service is not active in the current environment (its own `env`).
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class EnvironmentSkippedServiceError extends ElysiumError {
	constructor(
		public readonly service: string,
		public readonly requester: string,
		public readonly env: readonly Environment[],
		public readonly environment: Environment
	) {
		super(
			`Service "${service}" requested by ${requester} is only active in ${env.map((e) => `"${e}"`).join(', ')}, not in the "${environment}" environment.`
		);
	}
}

/**
 * Thrown when a class listed in a module's `controllers` is not a decorated controller.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidControllerError extends ElysiumError {
	constructor(
		public readonly className: string,
		public readonly moduleName: string
	) {
		super(
			`${className}, listed in the controllers of ${moduleName}, is not a controller. Decorate it with @Http.controller(), @Websocket.controller() or @Wamp.controller().`
		);
	}
}

/**
 * Thrown when an instance method of a class that is not a service is declared an event listener.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class LifecycleListenerNotSupportedError extends ElysiumError {
	constructor(
		public readonly className: string,
		public readonly method: string,
		public readonly moduleName: string
	) {
		super(
			`${className}.${method} (module ${moduleName}) is an instance event listener, but ${className} is not listed in the services of ${moduleName}. Make the method static or register the class as a service.`
		);
	}
}

/**
 * Thrown when a request-scoped service is resolved outside a request.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class OutsideRequestScopeError extends ElysiumError {
	constructor(public readonly service: string) {
		super(
			`Service "${service}" is request-scoped and was resolved outside a request. Resolve it from a route handler, or run the code in Service.runInRequestScope().`
		);
	}
}

/**
 * Thrown when a singleton service depends on a request-scoped one.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class ScopeMismatchError extends ElysiumError {
	constructor(
		public readonly service: string,
		public readonly dependency: string
	) {
		super(
			`Singleton service "${service}" depends on the request-scoped service "${dependency}". Make "${service}" request-scoped or a factory, or resolve "${dependency}" when it is needed.`
		);
	}
}

/**
 * Thrown when an interceptor calls `next()` more than once, which would run the handler twice.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InterceptorNextCalledTwiceError extends ElysiumError {
	constructor(public readonly interceptor: string) {
		super(
			`Interceptor "${interceptor}" called next() more than once. Call it once, and keep its result.`
		);
	}
}
