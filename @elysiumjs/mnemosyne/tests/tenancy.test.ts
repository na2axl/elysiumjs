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

import { Application } from '@elysiumjs/core';
import { describe, expect, it } from 'bun:test';

import {
	getCurrentTenant,
	isValidTenantId,
	SimpleTenantMiddleware,
	StrictTenantMiddleware,
	TenantMiddleware,
	withTenant
} from '../src/tenancy';

describe('getCurrentTenant', () => {
	it('returns null outside a tenant context', () => {
		expect(getCurrentTenant()).toBeNull();
	});

	it('reads the tenant set by withTenant when no application instance exists', () => {
		expect(Application.instance).toBeNull();
		expect(withTenant('acme', () => getCurrentTenant())).toBe('acme');
	});

	it('does not change the outer store', () => {
		const store = new Map<any, unknown>([['tenant', 'outer']]);

		const inner = Application.context.run(store, () => withTenant('inner', getCurrentTenant));

		expect(inner).toBe('inner');
		expect(store.get('tenant')).toBe('outer');
	});
});

describe('isValidTenantId', () => {
	it('accepts letters, digits, underscores and dashes up to 63 characters', () => {
		for (const id of ['acme', 'Acme_42', 'tenant-1', 'a', 'x'.repeat(63)]) {
			expect(isValidTenantId(id)).toBe(true);
		}
	});

	it('rejects anything else', () => {
		for (const id of ['', 'x'.repeat(64), 'a.b', 'a"b', 'pg_catalog;--', 'a b', 'é', '../x']) {
			expect(isValidTenantId(id)).toBe(false);
		}
	});

	it('rejects the names PostgreSQL reserves for system schemas', () => {
		for (const id of [
			'pg_catalog',
			'pg_toast',
			'PG_temp_1',
			'pg_',
			'information_schema',
			'INFORMATION_SCHEMA'
		]) {
			expect(isValidTenantId(id)).toBe(false);
		}
		for (const id of ['pgadmin', 'tenant_pg_1', 'information_schema_2']) {
			expect(isValidTenantId(id)).toBe(true);
		}
	});
});

describe('TenantMiddleware', () => {
	const request = (tenant?: string) =>
		({
			request: new Request('http://localhost/', {
				headers: tenant === undefined ? {} : { 'x-tenant-id': tenant }
			})
		}) as any;

	class KnownTenantMiddleware extends TenantMiddleware {
		public checked: string[] = [];

		protected async validateTenant(tenant: string): Promise<boolean> {
			this.checked.push(tenant);
			return tenant === 'acme';
		}
	}

	it('rejects every tenant unless validateTenant is overridden', async () => {
		const ctx = request('acme');

		await expect(new SimpleTenantMiddleware().onRequest(ctx)).rejects.toThrow('Invalid tenant');
		expect(ctx.tenant).toBeUndefined();
	});

	it('still allows public requests by default', async () => {
		const ctx = request();

		await new SimpleTenantMiddleware().onRequest(ctx);

		expect(ctx.tenant).toBe('public');
	});

	it('requires a tenant in strict mode', async () => {
		await expect(new StrictTenantMiddleware().onRequest(request())).rejects.toThrow(
			'Tenant ID required'
		);
	});

	it('accepts the tenants validateTenant accepts', async () => {
		const ctx = request('acme');

		await new KnownTenantMiddleware().onRequest(ctx);

		expect(ctx.tenant).toBe('acme');
	});

	it('rejects malformed identifiers before calling validateTenant', async () => {
		const middleware = new KnownTenantMiddleware();

		await expect(middleware.onRequest(request('acme"; DROP SCHEMA x'))).rejects.toThrow(
			'Invalid tenant'
		);
		await expect(middleware.onRequest(request('x'.repeat(64)))).rejects.toThrow('Invalid tenant');
		expect(middleware.checked).toEqual([]);
	});
});
