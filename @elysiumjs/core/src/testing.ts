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
import type { Application } from './app';
import type { HttpTestClient } from './http-client';
import type { ConfiguredModule, ModuleClass } from './module';
import type { ServiceToken } from './token';

import { Container } from './container';
import { ElysiumError } from './errors';
import { createHttpClient } from './http-client';
import { Kernel } from './kernel';
import { ModuleContext } from './module-context';
import { buildModuleGraph } from './module-graph';
import { Service } from './service';

/**
 * Options of {@link Application.testing}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type TestingOptions = {
	/** The modules to boot. */
	modules: (ModuleClass | ConfiguredModule<any>)[];

	/**
	 * Services registered as globals; they win over module services with the same token.
	 * Give named services by name, or any service by class with a `Map`.
	 */
	overrides?: Record<string, unknown> | Map<ServiceToken, unknown>;

	/** The environment to build the graph for. Defaults to `test`. */
	environment?: string;

	/** `eager` initialises every module and builds every service. Defaults to `lazy`. */
	boot?: 'lazy' | 'eager';
};

/**
 * A booted module graph, for tests.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type TestingApp = {
	/** The kernel running the graph. */
	kernel: Kernel;

	/**
	 * Resolves a service, optionally from inside a module, so that visibility applies.
	 * @param name The service name or class.
	 * @param from The module to resolve from. Defaults to global lookups only.
	 */
	get<T>(name: string | Class<T>, from?: ModuleClass): Promise<T>;

	/** Destroys the services and modules, and resets the container. */
	shutdown(): Promise<void>;
};

/**
 * Empties the service container and clears its overrides, module visibility rules, module
 * init hook and skipped-module lookup. The container is global to the process: call this
 * between tests or scenarios that each boot their own application.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const resetContainer = (): void => {
	Container.reset();
	Container.setOverrides(null);
	Container.setVisibility(null);
	Container.setModuleInitHook(null);
	Container.setSkippedLookup(null);
};

/**
 * Options of {@link Application.testing} for a whole application, driven over HTTP.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type TestingAppOptions = {
	/** The application class to build. It must not be started. */
	app: new () => Application;

	/**
	 * Services registered as globals before the application boots; they win over module services
	 * with the same token. Give named services by name, or any service by class with a `Map`.
	 */
	overrides?: Record<string, unknown> | Map<ServiceToken, unknown>;
};

/**
 * A built application under test, with an HTTP client that drives it in memory.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type TestingHttpApp = TestingApp & {
	/** The application instance. */
	app: Application;

	/** Sends requests to the application through `app.handle(Request)`, without a server. */
	http: HttpTestClient;
};

const applyOverrides = (overrides: Record<string, unknown> | Map<ServiceToken, unknown>) => {
	const entries = overrides instanceof Map ? [...overrides] : Object.entries(overrides);
	Container.setOverrides(entries.map(([token]) => token));
	for (const [token, value] of entries) Service.instance(token, value);
};

/**
 * Builds an application, as a host that owns the server would (`app.build()`), and returns an
 * HTTP client for it. Modules boot on the first request.
 * @param options See {@link TestingAppOptions}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export async function createTestingHttpApp(options: TestingAppOptions): Promise<TestingHttpApp> {
	const { app: App, overrides = {} } = options;

	resetContainer();
	try {
		const app = new App();
		applyOverrides(overrides);
		const elysia = await app.build();
		const graph = app.kernel.graph;
		return {
			app,
			kernel: app.kernel,
			http: createHttpClient((request) => elysia.handle(request)),
			get: async <T>(name: string | Class<T>, from?: ModuleClass) => {
				await app.boot();
				const resolve = () => Service.resolve<T>(name);
				if (!from) return resolve();
				const node = graph.node(from);
				if (!node) throw new ElysiumError(`Module ${from.name} is not part of the app graph.`);
				return ModuleContext.run(node, resolve);
			},
			shutdown: async () => {
				await app.kernel.shutdown();
				resetContainer();
			}
		};
	} catch (error) {
		resetContainer();
		throw error;
	}
}

/**
 * Boots a module graph without a CLI or an HTTP server.
 * @param options See {@link TestingOptions}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export async function createTestingApp(options: TestingOptions): Promise<TestingApp> {
	const { modules, overrides = {}, environment = 'test', boot = 'lazy' } = options;

	resetContainer();
	try {
		const graph = buildModuleGraph(modules, environment);
		const kernel = new Kernel(graph);

		applyOverrides(overrides);

		await kernel.register();
		if (boot === 'eager') await kernel.bootEager();

		return {
			kernel,
			get: async <T>(name: string | Class<T>, from?: ModuleClass) => {
				const resolve = () => Service.resolve<T>(name);
				if (!from) return resolve();
				const node = graph.node(from);
				if (!node) throw new ElysiumError(`Module ${from.name} is not part of the test graph.`);
				return ModuleContext.run(node, resolve);
			},
			shutdown: async () => {
				await kernel.shutdown();
				resetContainer();
			}
		};
	} catch (error) {
		resetContainer();
		throw error;
	}
}
