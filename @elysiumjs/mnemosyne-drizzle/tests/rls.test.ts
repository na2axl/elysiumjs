// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import { Application, Service } from '@elysiumjs/core';
import { TENANCY_CONFIG_SERVICE, TENANCY_STRATEGY_SERVICE, withTenant } from '@elysiumjs/mnemosyne';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as d from 'drizzle-orm/pg-core';

import * as pkg from '../src';
import { Database } from '../src/database';
import { DrizzleModel } from '../src/model';
import { DrizzleRepository } from '../src/repository';
import { pgTable } from '../src/table';
import { DrizzleRLSTenancy, getSessionTenant, withRLS } from '../src/tenancy';
import { fakeConnection } from './fake-sql';

const SET_TENANT = 'SELECT set_config($1, $2, true)';

const users = pgTable('rls_users', {
	id: d.uuid().primaryKey(),
	name: d.text().notNull()
});

class User extends DrizzleModel(users) {}
class UserRepository extends DrizzleRepository(User) {}

/** Replaces the registered tenancy configuration. */
const useTenancy = (config: object) => {
	Service.remove(TENANCY_CONFIG_SERVICE);
	Service.instance(TENANCY_CONFIG_SERVICE, config);
};

const row = { id: '00000000-0000-0000-0000-000000000001', name: 'Ada' };

describe('RLS isolation', () => {
	let fake: ReturnType<typeof fakeConnection>;

	beforeEach(() => {
		fake = fakeConnection((query) => (query.startsWith('select') ? [row] : []));
		Service.instance('db.connection.default', fake.connection);
		Service.instance(TENANCY_CONFIG_SERVICE, { mode: 'rls' });
		Service.instance(TENANCY_STRATEGY_SERVICE, new DrizzleRLSTenancy());
	});

	afterEach(() => {
		Service.remove('db.connection.default');
		Service.remove(TENANCY_CONFIG_SERVICE);
		Service.remove(TENANCY_STRATEGY_SERVICE);
	});

	const statements = () => fake.log.map(({ client, query }) => `${client}: ${query}`);

	describe('DrizzleRLSTenancy.withIsolation', () => {
		it('makes the tenant-scoped transaction the connection used inside the callback', async () => {
			const strategy = new DrizzleRLSTenancy();

			const seen = await strategy.withIsolation(fake.connection, 'acme', async () => ({
				connection: Database.getConnection(),
				tenant: Application.context.getStore()?.get('tenant')
			}));

			expect(seen.connection).not.toBe(fake.connection);
			expect(Database.inTransaction()).toBe(false);
			expect(seen.tenant).toBe('acme');
			expect(fake.log[1]).toEqual({
				client: 'tx',
				query: SET_TENANT,
				params: ['app.current_tenant', 'acme']
			});
		});

		it('leaves the current context store untouched', async () => {
			const store = new Map<any, unknown>([['tenant', 'outer']]);

			await Application.context.run(store, () =>
				new DrizzleRLSTenancy().withIsolation(fake.connection, 'acme', async () => {})
			);

			expect([...store.entries()]).toEqual([['tenant', 'outer']]);
		});

		it('switches the tenant of an open transaction for the callback only', async () => {
			const strategy = new DrizzleRLSTenancy();

			await withTenant('outer', () =>
				Database.transaction(() =>
					strategy.withIsolation(fake.connection, 'inner', async () => {
						expect(Application.context.getStore()?.get('tenant')).toBe('inner');
					})
				)
			);

			expect(fake.log.map(({ query, params }) => [query, params[1]])).toEqual([
				['BEGIN', undefined],
				[SET_TENANT, 'outer'],
				[SET_TENANT, 'inner'],
				[SET_TENANT, 'outer'],
				['COMMIT', undefined]
			]);
		});

		it('does not set the tenant again on a transaction already scoped to it', async () => {
			await withTenant('acme', () =>
				Database.transaction(() =>
					new DrizzleRLSTenancy().withIsolation(fake.connection, 'acme', async () => {})
				)
			);

			expect(fake.log.filter(({ query }) => query === SET_TENANT)).toHaveLength(1);
		});
	});

	describe('withRLS', () => {
		it('passes the scoped transaction and exposes it to repositories', async () => {
			const found = await withRLS('acme', async (tx) => {
				expect(tx).toBe(Database.getConnection() as never);
				return new UserRepository().find(row.id);
			});

			expect(found).toEqual(row);
			expect(statements()).toEqual([
				'root: BEGIN',
				`tx: ${SET_TENANT}`,
				'tx: select "id", "name" from "rls_users" where "rls_users"."id" = $1',
				'root: COMMIT'
			]);
		});

		it('scopes to the public tenant when none is given', async () => {
			await withRLS(null, async () => {});

			expect(fake.log[1]!.params).toEqual(['app.current_tenant', 'public']);
		});
	});

	describe('getSessionTenant', () => {
		it('reads the tenant from the first row of the result', async () => {
			fake = fakeConnection(() => [{ tenant: 'acme' }]);
			Service.remove('db.connection.default');
			Service.instance('db.connection.default', fake.connection);

			expect(await getSessionTenant()).toBe('acme');
			expect(fake.log[0]).toEqual({
				client: 'root',
				query: 'SELECT current_setting($1, true) as tenant',
				params: ['app.current_tenant']
			});
		});

		it('returns null when the variable is not set', async () => {
			fake = fakeConnection(() => [{ tenant: null }]);
			Service.remove('db.connection.default');
			Service.instance('db.connection.default', fake.connection);

			expect(await getSessionTenant()).toBeNull();
		});

		it('reads the variable on the open transaction', async () => {
			fake = fakeConnection((query) =>
				query.includes('current_setting') ? [{ tenant: 'tx' }] : []
			);
			Service.remove('db.connection.default');
			Service.instance('db.connection.default', fake.connection);

			expect(await withTenant('tx', () => Database.transaction(() => getSessionTenant()))).toBe(
				'tx'
			);
			expect(fake.log.at(-2)!.client).toBe('tx');
		});
	});

	it('no longer exports setConnectionTenant, which leaked tenants across pooled connections', () => {
		expect('setConnectionTenant' in pkg).toBe(false);
	});

	describe('Database.transaction', () => {
		it('sets the current tenant on the transaction it opens in rls mode', async () => {
			await withTenant('acme', () => Database.transaction(async () => {}));

			expect(fake.log[1]).toEqual({
				client: 'tx',
				query: SET_TENANT,
				params: ['app.current_tenant', 'acme']
			});
		});

		it('uses the configured session variable', async () => {
			useTenancy({ mode: 'rls', rls: { sessionVariable: 'app.org' } });

			await Database.transaction(async () => {});

			expect(fake.log[1]!.params).toEqual(['app.org', 'public']);
		});

		it('does not set a tenant in schema mode', async () => {
			useTenancy({ mode: 'schema' });

			await withTenant('acme', () => Database.transaction(async () => {}));

			expect(statements()).toEqual(['root: BEGIN', 'root: COMMIT']);
		});
	});

	describe('DrizzleRepository', () => {
		it('runs each operation in a transaction scoped to the current tenant', async () => {
			const found = await withTenant('acme', () => new UserRepository().find(row.id));

			expect(found).toEqual(row);
			expect(statements()).toEqual([
				'root: BEGIN',
				`tx: ${SET_TENANT}`,
				'tx: select "id", "name" from "rls_users" where "rls_users"."id" = $1',
				'root: COMMIT'
			]);
			expect(fake.log[1]!.params).toEqual(['app.current_tenant', 'acme']);
		});

		it('joins the open transaction, whose tenant was set when it was opened', async () => {
			await withTenant('acme', () =>
				Database.transaction(async () => {
					const repository = new UserRepository();
					await repository.find(row.id);
					await repository.all();
				})
			);

			expect(statements()).toEqual([
				'root: BEGIN',
				`tx: ${SET_TENANT}`,
				'tx: select "id", "name" from "rls_users" where "rls_users"."id" = $1',
				'tx: select "id", "name" from "rls_users"',
				'root: COMMIT'
			]);
		});

		it('queries the connection directly in schema mode', async () => {
			useTenancy({ mode: 'schema' });

			await new UserRepository().all();

			expect(statements()).toEqual(['root: select "id", "name" from "rls_users"']);
		});
	});
});
