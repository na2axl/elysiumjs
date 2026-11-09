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

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { Command } from '../src/command';
import { Container } from '../src/container';
import { Environments } from '../src/environments';
import { EnvironmentSkippedServiceError } from '../src/errors';
import { Http } from '../src/http';
import { Kernel } from '../src/kernel';
import { Module } from '../src/module';
import { ModuleContext } from '../src/module-context';
import { buildModuleGraph } from '../src/module-graph';
import { Runtime } from '../src/runtime';
import { Service } from '../src/service';
import { testRuntime } from './test-runtime';

const reset = () => {
	Container.reset();
	Container.setVisibility(null);
	Container.setModuleInitHook(null);
	Container.setSkippedLookup(null);
};

const DEV = Environments.local;

/** Whether a module registered the service. */
const registered = (token: Parameters<typeof Service.ownersOf>[0]) =>
	Service.ownersOf(token).length > 0;

describe('Environments', () => {
	it('treats a class without environments as active everywhere', () => {
		class Anywhere {}
		expect(Environments.of(Anywhere)).toBeUndefined();
		expect(Environments.isActive(Anywhere, 'production')).toBe(true);
	});

	it('keeps the environments a class is active in', () => {
		class Local {}
		Environments.set(Local, DEV);
		expect(Environments.of(Local)).toEqual(DEV);
		expect(Environments.isActive(Local, 'test')).toBe(true);
		expect(Environments.isActive(Local, 'production')).toBe(false);
	});

	it('names development and test as the local environments', () => {
		expect(Environments.local).toEqual(['development', 'test']);
		expect(Environments.includes(Environments.local, 'development')).toBe(true);
		expect(Environments.includes(Environments.local, 'test')).toBe(true);
		expect(Environments.includes(Environments.local, 'production')).toBe(false);
	});

	it('tells which environment is current', () => {
		const original = Runtime.find();
		try {
			const check = (environment: string) => {
				Runtime.use({ ...testRuntime, env: () => ({ NODE_ENV: environment }) });
				return [Environments.isDevelopment(), Environments.isTest(), Environments.isProduction()];
			};
			expect(check('development')).toEqual([true, false, false]);
			expect(check('test')).toEqual([false, true, false]);
			expect(check('production')).toEqual([false, false, true]);
			expect(check('staging')).toEqual([false, false, false]);
		} finally {
			if (original) Runtime.use(original);
		}
	});
});

describe('services with env', () => {
	beforeEach(reset);
	afterEach(reset);

	const Plugins = Service.tag<object>('test.env-plugins');

	it('registers a service only in the environments it lists', async () => {
		@Service.register({ env: DEV })
		class DevOnly {}
		class Always {}
		@Module.register({ services: [DevOnly, Always] })
		class App extends Module {}

		const production = buildModuleGraph([App], 'production');
		await new Kernel(production).register();
		expect(registered(DevOnly)).toBe(false);
		expect(registered(Always)).toBe(true);

		reset();
		const test = buildModuleGraph([App], 'test');
		await new Kernel(test).register();
		expect(registered(DevOnly)).toBe(true);
	});

	it('leaves an inactive service out of the services of its tags', async () => {
		@Service.register({ tags: [Plugins], env: DEV })
		class DevPlugin {}
		@Service.register({ tags: [Plugins] })
		class RealPlugin {}
		@Module.register({ services: [DevPlugin, RealPlugin] })
		class App extends Module {}

		const graph = buildModuleGraph([App], 'production');
		await new Kernel(graph).register();
		const plugins = ModuleContext.run(graph.node(App)!, () => Service.getAll(Plugins));
		expect(plugins.map((p) => p.constructor)).toEqual([RealPlugin]);
	});

	it('skips a factory definition by its env', async () => {
		@Module.register({
			services: [{ name: 'dev.factory', factory: () => ({}), env: DEV }]
		})
		class App extends Module {}

		const graph = buildModuleGraph([App], 'production');
		await new Kernel(graph).register();
		expect(registered('dev.factory')).toBe(false);
	});

	it('says which environments an injected service is active in', async () => {
		@Service.register({ env: DEV })
		class DevOnly {}
		class NeedsDev {
			constructor(@Service.inject(DevOnly) public readonly dev: unknown) {}
		}
		@Module.register({ services: [DevOnly, NeedsDev] })
		class App extends Module {}

		const graph = buildModuleGraph([App], 'production');
		await new Kernel(graph).register();

		let error: unknown;
		try {
			ModuleContext.run(graph.node(App)!, () => Service.make(NeedsDev));
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(EnvironmentSkippedServiceError);
		expect(error).toMatchObject({
			service: 'DevOnly',
			requester: 'NeedsDev',
			env: DEV,
			environment: 'production'
		});
	});
});

describe('controllers, commands and jobs with env', () => {
	it('leaves out an inactive controller', () => {
		@Http.controller('/dev', { env: DEV })
		class DevController {}
		@Http.controller('/real')
		class RealController {}
		@Module.register({ controllers: [DevController, RealController] })
		class App extends Module {}

		const production = buildModuleGraph([App], 'production');
		expect(production.own(production.node(App)!, 'controllers')).toEqual([RealController]);
		const test = buildModuleGraph([App], 'test');
		expect(test.collect('controllers').map((c) => c.item)).toEqual([DevController, RealController]);
	});

	it('leaves out an inactive command', () => {
		@Command.register({ name: 'seed', env: DEV })
		class Seed {
			static command = 'seed';
		}
		@Module.register({ commands: [Seed as any] })
		class App extends Module {}

		expect(buildModuleGraph([App], 'staging').collect('commands')).toEqual([]);
		expect(
			buildModuleGraph([App], 'development')
				.collect('commands')
				.map((c) => c.item)
		).toEqual([Seed as any]);
	});

	it('does not count an inactive command as a duplicate', () => {
		@Command.register({ name: 'reset', env: ['development'] })
		class LocalReset {
			static command = 'reset';
		}
		@Command.register({ name: 'reset', env: ['production'] })
		class ProductionReset {
			static command = 'reset';
		}
		@Module.register({ commands: [LocalReset as any] })
		class M1 extends Module {}
		@Module.register({ commands: [ProductionReset as any] })
		class M2 extends Module {}

		expect(() => buildModuleGraph([M1, M2], 'development')).not.toThrow();
	});

	it('leaves out an inactive job', () => {
		class DevJob {}
		Environments.set(DevJob, DEV);
		class RealJob {}
		@Module.register({ jobs: [DevJob, RealJob] })
		class App extends Module {}

		expect(
			buildModuleGraph([App], 'production')
				.collect('jobs')
				.map((j) => j.item)
		).toEqual([RealJob]);
	});
});
