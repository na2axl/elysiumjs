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
import type { ConfiguredModule, ModuleClass } from './module';

import { Container } from './container';
import { ElysiumError } from './errors';
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

	/** Services registered as globals; they win over module services of the same name. */
	overrides?: Record<string, unknown>;

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

const resetContainer = () => {
	Container.reset();
	Container.setOverrides(null);
	Container.setVisibility(null);
	Container.setModuleInitHook(null);
	Container.setSkippedLookup(null);
};

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

		Container.setOverrides(Object.keys(overrides));
		for (const [name, value] of Object.entries(overrides)) Service.instance(name, value);

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
