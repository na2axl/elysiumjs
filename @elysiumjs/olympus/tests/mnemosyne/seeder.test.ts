// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { TestingApp } from '../../src/index';
import type { SeederInput } from '../../src/mnemosyne';

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
	Application,
	DATABASE_TRANSACTION_SERVICE,
	ElysiumError,
	Module,
	ModuleContext,
	Service
} from '../../src/index';
import {
	DbSeedCommand,
	DuplicateSeederError,
	MnemosyneModule,
	Seeder,
	SeederCycleError,
	UnknownSeederError
} from '../../src/mnemosyne';
import { testRuntime as bunRuntime } from '../core/test-runtime';

/** What the seeders did, in order. */
let calls: string[] = [];

/** A transaction runner that records the connection and wraps the work in begin/commit. */
const transactions = mock(async <T>(callback: () => Promise<T>, connection?: string) => {
	calls.push(`begin:${connection}`);
	const result = await callback();
	calls.push('commit');
	return result;
});

@Service.register({ name: 'test.countries' })
class Countries {
	public upsert(source: string) {
		calls.push(`countries from ${source}`);
	}
}

@Seeder.register()
class CountriesSeeder extends Seeder {
	protected async run(@Service.inject('test.countries') countries: Countries): Promise<void> {
		countries.upsert(this.input.args.source ?? 'default');
		calls.push(`module:${ModuleContext.current()?.id}`);
	}
}

@Seeder.register({ after: [CountriesSeeder], connection: 'reference' })
class PaymentRoutesSeeder extends Seeder {
	protected async run(): Promise<void> {
		calls.push('payment-routes');
	}
}

@Seeder.register({ after: () => [CountriesSeeder], manual: true })
class CitiesSeeder extends Seeder {
	public static lastInput?: SeederInput;

	protected async run(): Promise<void> {
		CitiesSeeder.lastInput = this.input;
		calls.push('cities');
	}
}

@Seeder.register({ name: 'core.local-only', env: ['development'] })
class LocalOnlySeeder extends Seeder {
	protected async run(): Promise<void> {
		calls.push('local-only');
	}
}

@Module.register({
	services: [Countries],
	seeders: [CitiesSeeder, CountriesSeeder, LocalOnlySeeder]
})
class CoreModule extends Module {}

// Declared first in its own list, but runs after core.countries.
@Module.register({ imports: [CoreModule], seeders: [PaymentRoutesSeeder] })
class FinancesModule extends Module {}

describe('Seeder', () => {
	let app: TestingApp | undefined;

	const boot = async (modules = [CoreModule, FinancesModule], environment = 'test') => {
		app = await Application.testing({
			modules,
			environment,
			overrides: { [DATABASE_TRANSACTION_SERVICE]: transactions }
		});
		return app.kernel.graph;
	};

	beforeEach(() => {
		calls = [];
		transactions.mockClear();
	});

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('names a seeder after its module and class, unless it was given a name', async () => {
		const graph = await boot([CoreModule, FinancesModule], 'development');
		expect(
			Seeder.plan(graph, [
				'core.cities',
				'core.local-only',
				'finances.payment-routes',
				'core.countries'
			]).map((s) => s.name)
		).toEqual(['core.countries', 'core.cities', 'core.local-only', 'finances.payment-routes']);
	});

	it('orders seeders after the classes in their after list, and leaves manual ones out', async () => {
		const graph = await boot();
		expect(Seeder.plan(graph).map((s) => s.name)).toEqual([
			'core.countries',
			'finances.payment-routes'
		]);
	});

	it('runs only the named seeders, manual ones included, in order', async () => {
		const graph = await boot();
		expect(Seeder.plan(graph, ['core.cities', 'core.countries']).map((s) => s.name)).toEqual([
			'core.countries',
			'core.cities'
		]);
		// after sets an order, it does not pull the other seeder in.
		expect(Seeder.plan(graph, ['core.cities']).map((s) => s.name)).toEqual(['core.cities']);
	});

	it('leaves out the seeders of other environments', async () => {
		const graph = await boot();
		expect(() => Seeder.plan(graph, ['core.local-only'])).toThrow(UnknownSeederError);
	});

	it('fails on an unknown name', async () => {
		const graph = await boot();
		expect(() => Seeder.plan(graph, ['core.nope'])).toThrow(
			'No active module lists a seeder named core.nope.'
		);
	});

	it('fails when a seeder runs after one that no module lists', async () => {
		// FinancesModule is not booted: CoreModule alone lists no PaymentRoutesSeeder.
		@Seeder.register({ after: [PaymentRoutesSeeder] })
		class OrphanSeeder extends Seeder {
			protected async run(): Promise<void> {}
		}
		@Module.register({ seeders: [OrphanSeeder] })
		class OrphanModule extends Module {}

		const graph = await boot([OrphanModule]);
		expect(() => Seeder.plan(graph)).toThrow(
			'Seeder orphan.orphan runs after PaymentRoutesSeeder, which no active module lists in its seeders.'
		);
	});

	it('fails on a cycle', async () => {
		@Seeder.register({ after: () => [BSeeder] })
		class ASeeder extends Seeder {
			protected async run(): Promise<void> {}
		}
		@Seeder.register({ after: [ASeeder] })
		class BSeeder extends Seeder {
			protected async run(): Promise<void> {}
		}
		@Module.register({ seeders: [ASeeder, BSeeder] })
		class CycleModule extends Module {}

		const graph = await boot([CycleModule]);
		expect(() => Seeder.plan(graph)).toThrow(SeederCycleError);
		expect(() => Seeder.plan(graph)).toThrow('cycle.a → cycle.b → cycle.a');
	});

	it('fails when two seeders have the same name', async () => {
		@Seeder.register({ name: 'core.countries' })
		class OtherCountriesSeeder extends Seeder {
			protected async run(): Promise<void> {}
		}
		@Module.register({ imports: [CoreModule], seeders: [OtherCountriesSeeder] })
		class OtherModule extends Module {}

		const graph = await boot([CoreModule, OtherModule]);
		expect(() => Seeder.plan(graph)).toThrow(DuplicateSeederError);
	});

	it('fails on a listed class that is not a seeder', async () => {
		class NotASeeder extends Seeder {
			protected async run(): Promise<void> {}
		}
		@Module.register({ seeders: [NotASeeder] })
		class WrongModule extends Module {}

		const graph = await boot([WrongModule]);
		expect(() => Seeder.plan(graph)).toThrow('is not decorated with @Seeder.register()');
	});

	it('runs a seeder in its module, in a transaction on its connection, with its services', async () => {
		const graph = await boot();
		const [countries, routes] = Seeder.plan(graph);
		await Seeder.execute(countries!, { args: { source: 'fixture' } });
		await Seeder.execute(routes!, { args: {} });
		expect(calls).toEqual([
			'begin:default',
			'countries from fixture',
			'module:CoreModule',
			'commit',
			'begin:reference',
			'payment-routes',
			'commit'
		]);
	});

	it('fails without a transaction service', async () => {
		app = await Application.testing({ modules: [CoreModule] });
		const [countries] = Seeder.plan(app.kernel.graph);
		expect(Seeder.execute(countries!, { args: {} })).rejects.toThrow(ElysiumError);
	});
});

describe('db:seed', () => {
	const originalExit = process.exit;
	const originalStdout = process.stdout.write;
	let output = '';
	let started: Application | undefined;

	@Module.register({
		services: [{ name: DATABASE_TRANSACTION_SERVICE, global: true, factory: () => transactions }]
	})
	class FakeDatabaseModule extends Module {}

	beforeEach(() => {
		calls = [];
		output = '';
		CitiesSeeder.lastInput = undefined;
		process.exit = mock() as never;
		process.stdout.write = mock((message: string) => {
			output += message;
			return true;
		}) as never;
	});

	afterEach(async () => {
		await started?.kernel.shutdown();
		started = undefined;
		Service.clear();
		process.exit = originalExit;
		process.stdout.write = originalStdout;
		for (const signal of ['SIGINT', 'SIGTERM'] as const) process.removeAllListeners(signal);
	});

	const run = async (...args: string[]) => {
		@Application.register({
			runtime: bunRuntime,
			modules: [FakeDatabaseModule, MnemosyneModule, CoreModule, FinancesModule]
		})
		class TestApp extends Application {}
		started = new TestApp();
		await started.run(['db:seed', ...args]);
	};

	it('is provided by the MnemosyneModule', () => {
		expect(DbSeedCommand.command).toBe('db:seed');
	});

	it('runs the non-manual seeders in order', async () => {
		await run();
		expect(calls.filter((c) => !c.startsWith('begin') && c !== 'commit')).toEqual([
			'countries from default',
			'module:CoreModule',
			'payment-routes'
		]);
		expect(output).toContain('core.countries');
		expect(output).toContain('finances.payment-routes');
	});

	it('runs the named seeders with the file and the args', async () => {
		await run(
			'--only',
			'core.cities,core.countries',
			'--file',
			'cities.zip',
			'--arg',
			'source=geonames,mode=full'
		);
		expect(calls.filter((c) => !c.startsWith('begin') && c !== 'commit')).toEqual([
			'countries from geonames',
			'module:CoreModule',
			'cities'
		]);
		expect(CitiesSeeder.lastInput).toEqual({
			file: 'cities.zip',
			args: { source: 'geonames', mode: 'full' }
		});
	});

	it('builds only the services the seeders take', async () => {
		@Module.register({
			services: [
				{
					name: 'test.needs-host',
					global: true,
					factory: () => {
						throw new Error('no host here');
					}
				}
			]
		})
		class HostModule extends Module {}

		@Application.register({
			runtime: bunRuntime,
			modules: [FakeDatabaseModule, MnemosyneModule, HostModule, CoreModule]
		})
		class HostApp extends Application {}
		started = new HostApp();
		await started.run(['db:seed']);
		expect(calls).toContain('countries from default');
	});

	it('lists the plan without running it', async () => {
		await run('--list', '--only', 'core.cities');
		expect(calls).toEqual([]);
		expect(output).toContain('core.cities (manual)');
	});
});
