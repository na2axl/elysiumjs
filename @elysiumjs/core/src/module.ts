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

import type { Elysia } from 'elysia';
import type { Class } from 'type-fest';
import type { CommandClass } from './command';
import type { Route } from './http';
import type { ServiceDefinition } from './service';

import { InvalidModuleError, MissingModuleConfigError } from './errors';
import { deepMerge, Symbols } from './utils';

/**
 * Type for a module class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ModuleClass = Class<Module>;

/**
 * A module bound to a configuration, as returned by `Module.with()`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ConfiguredModule<TConfig> = {
	readonly [Symbols.configuredModule]: true;
	readonly module: ModuleClass;
	readonly config: Partial<TConfig> | (() => Partial<TConfig> | Promise<Partial<TConfig>>);
};

/**
 * Properties used when declaring a module with `@Module.register()`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ModuleProps<TConfig = unknown> = {
	/** Modules (or configured modules) whose exports this module can use. */
	imports?: (ModuleClass | ConfiguredModule<any>)[];

	/** The services this module provides, optionally derived from its resolved config. */
	services?: ServiceDefinition[] | ((config: TConfig) => ServiceDefinition[]);

	/** What this module exposes to importers, or `true` to expose everything. */
	exports?: (Class<any> | string | ModuleClass)[] | true;

	/** The controllers provided by the module. */
	controllers?: Class<any>[];

	/** The commands provided by the module. */
	commands?: CommandClass[];

	/** The jobs provided by the module. */
	jobs?: Class<any>[];

	/** The base path prefixed to every controller path of this module. */
	prefix?: Route;

	/** Environments (`NODE_ENV` values) in which the module is active. */
	env?: string[];
};

/**
 * Checks whether a value is a configured module.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export function isConfiguredModule(value: unknown): value is ConfiguredModule<unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as Record<symbol, unknown>)[Symbols.configuredModule] === true
	);
}

/**
 * Reads the props a module class was declared with.
 * @throws {InvalidModuleError} When the class is not decorated with `@Module.register()`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export function getModuleProps(cls: ModuleClass): ModuleProps {
	const props = Reflect.getMetadata(Symbols.module, cls);
	if (props === undefined) {
		throw new InvalidModuleError(cls.name);
	}
	return props;
}

/**
 * Base class for all modules.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class Module {
	/**
	 * Marks a class as a module. Only stores metadata.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public static register<TConfig = any>(props: ModuleProps<TConfig> = {}) {
		return function (target: ModuleClass) {
			Reflect.defineMetadata(Symbols.module, props, target);
		};
	}

	/**
	 * Creates a base class for modules that accept configuration.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public static configurable<TConfig extends object>(
		options: { defaults?: Partial<TConfig>; required?: (keyof TConfig)[] } = {}
	) {
		abstract class ConfigurableModule extends Module {
			/** Injection token of the resolved config of this module. */
			public static get config(): string {
				return `elysium.module.${this.name}.config`;
			}

			/** Binds a configuration to this module. */
			public static with(
				config: Partial<TConfig> | (() => Partial<TConfig> | Promise<Partial<TConfig>>)
			): ConfiguredModule<TConfig> {
				return {
					[Symbols.configuredModule]: true,
					module: this as unknown as ModuleClass,
					config
				};
			}

			/**
			 * Merges the defaults with the input and checks required keys. Array defaults are
			 * concatenated with the user's arrays (primitives are de-duplicated), not replaced.
			 */
			public static resolveConfig(input: Partial<TConfig> = {}): TConfig {
				// deepMerge keeps the target's values, so the input is the target.
				const resolved = deepMerge(
					{ ...input } as Record<string, any>,
					{ ...(options.defaults ?? {}) } as Record<string, any>
				) as TConfig;
				const missing = (options.required ?? []).filter(
					(key) => (resolved as any)[key] === undefined
				);
				if (missing.length > 0) {
					throw new MissingModuleConfigError(this.name, missing.map(String));
				}
				return resolved;
			}

			/** The resolved configuration, set by the kernel. */
			public get config(): TConfig {
				return Reflect.getMetadata(Symbols.moduleConfig, this);
			}
		}

		return ConfigurableModule;
	}

	/** Called once the module's services are ready. */
	public onInit(): Promise<void> | void {}

	/** Called when the application shuts down. */
	public onDestroy(): Promise<void> | void {}

	/** Called with the Elysia app before it starts listening. */
	public onServe(_app: Elysia<any>): Promise<void> | void {}
}
