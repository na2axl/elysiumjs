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

import type { Context } from '@elysiumjs/core';
import type { TenancyStrategy } from './interfaces';

import { Application, Middleware } from '@elysiumjs/core';

// ============================================================================
// Types
// ============================================================================

/**
 * The tenancy mode for the application.
 * - `schema`: Each tenant has their own Postgres schema.
 * - `rls`: Row-Level Security with a shared schema and a tenant column.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type TenancyMode = 'schema' | 'rls';

/**
 * Global tenancy configuration for the application.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface TenancyConfig {
	/**
	 * The tenancy mode to use.
	 */
	mode: TenancyMode;

	/**
	 * Configuration specific to RLS mode.
	 */
	rls?: {
		/**
		 * The PostgreSQL session variable used to store the current tenant.
		 * @default 'app.current_tenant'
		 */
		sessionVariable?: string;

		/**
		 * The default column name used for tenant isolation in RLS policies.
		 * @default 'tenant_id'
		 */
		defaultColumn?: string;
	};

	/**
	 * Configuration specific to schema-based tenancy.
	 */
	schema?: {
		/**
		 * Whether to automatically create tenant schemas on first use.
		 */
		autoCreate?: boolean;
	};
}

/**
 * Per-model tenancy configuration, used to control how a specific model
 * interacts with the tenancy system.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface ModelTenancyConfig {
	/**
	 * Whether tenancy is enabled for this model.
	 */
	enabled: boolean;

	/**
	 * Override the global tenancy mode for this model.
	 */
	mode?: TenancyMode;

	/**
	 * The column name used for RLS tenant isolation in this model.
	 */
	column?: string;

	/**
	 * Custom RLS policy name for this model.
	 */
	policyName?: string;
}

// ============================================================================
// Internal State
// ============================================================================

let _strategy: TenancyStrategy<unknown, unknown> | null = null;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Gets the current global tenancy configuration.
 *
 * Reads from the 'elysium:mnemosyne' app config key. Returns a default
 * configuration if the app is not yet initialized or no tenancy config is set.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @returns The current tenancy configuration.
 */
export const getConfig = (): TenancyConfig => {
	const app = Application.instance;
	if (!app) {
		return { mode: 'schema' };
	}
	const config = app.getConfig<{ tenancy?: TenancyConfig }>('elysium:mnemosyne' as any);
	return config?.tenancy ?? { mode: 'schema' };
};

// ============================================================================
// Strategy Registry
// ============================================================================

/**
 * Registers the tenancy strategy to use for table resolution and isolation.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param strategy The tenancy strategy to register.
 */
export const registerTenancyStrategy = (strategy: TenancyStrategy<unknown, unknown>): void => {
	_strategy = strategy;
};

/**
 * Gets the currently registered tenancy strategy.
 * @author Axel Nana <axel.nana@workbud.com>
 * @returns The current tenancy strategy, or `null` if none is registered.
 */
export const getTenancyStrategy = (): TenancyStrategy<unknown, unknown> | null => {
	return _strategy;
};

// ============================================================================
// Context Management
// ============================================================================

/**
 * Gets the current tenant from the async context.
 * @author Axel Nana <axel.nana@workbud.com>
 * @returns The current tenant identifier, or `null` if not set.
 */
export const getCurrentTenant = (): string | null => {
	if (!Application.instance || !Application.context.getStore) {
		return null;
	}
	const store = Application.context.getStore();
	return (store?.get('tenant') ?? null) as string | null;
};

/**
 * Runs a callback within the context of a specific tenant.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The tenant identifier to set.
 * @param callback The function to execute within the tenant context.
 * @returns The return value of the callback.
 */
export const withTenant = <T>(tenant: string, callback: () => T): T => {
	const currentStore = Application.context.getStore();
	const newStore = new Map(currentStore);
	newStore.set('tenant', tenant);
	return Application.context.run(newStore, callback);
};

// ============================================================================
// TenantMiddleware Base Class
// ============================================================================

/**
 * Base class for tenant-aware middleware.
 *
 * The middleware extracts the tenant identifier from an HTTP header and
 * sets `ctx.tenant`. For RLS mode, route handlers should use the driver's
 * isolation mechanism to wrap their queries in a tenant-scoped transaction.
 *
 * @example
 * ```typescript
 * class OrganizationMiddleware extends TenantMiddleware {
 *   protected header = 'x-organization-id';
 *   protected allowPublic = false;
 *
 *   protected async validateTenant(orgId: string): Promise<boolean> {
 *     return Organization.exists(orgId);
 *   }
 * }
 * ```
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class TenantMiddleware extends Middleware {
	/**
	 * The HTTP header name from which the tenant ID is read.
	 */
	protected header: string = 'x-tenant-id';

	/**
	 * Whether requests without a tenant ID are allowed (defaulting to 'public').
	 */
	protected allowPublic: boolean = true;

	/**
	 * The database connection name used for tenant operations.
	 */
	protected connectionName: string = 'default';

	/**
	 * Validates that a tenant identifier is legitimate.
	 * Override this to check against your data store.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param _tenant The tenant identifier to validate.
	 * @returns `true` if the tenant is valid, `false` otherwise.
	 */
	protected async validateTenant(_tenant: string): Promise<boolean> {
		return true;
	}

	/**
	 * Hook called after a tenant has been successfully resolved.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param _tenant The resolved tenant identifier.
	 * @param _ctx The request context.
	 */
	protected async onTenantResolved(_tenant: string, _ctx: Context): Promise<void> {}

	/**
	 * Called when the tenant cannot be determined or is invalid.
	 * Throws an appropriate error by default.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param reason Whether the tenant is 'missing' or 'invalid'.
	 * @param _ctx The request context.
	 */
	protected onTenantError(reason: 'missing' | 'invalid', _ctx: Context): never {
		if (reason === 'missing') {
			throw new Error('Tenant ID required');
		} else {
			throw new Error('Invalid tenant');
		}
	}

	/**
	 * Extracts and validates the tenant from the incoming request.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param ctx The request context.
	 */
	public async onRequest(ctx: Context): Promise<any> {
		const tenantId = ctx.request.headers.get(this.header);

		if (!tenantId || tenantId === 'public') {
			if (this.allowPublic) {
				(ctx as any).tenant = 'public';
				return;
			}
			return this.onTenantError('missing', ctx);
		}

		const isValid = await this.validateTenant(tenantId);
		if (!isValid) {
			return this.onTenantError('invalid', ctx);
		}

		(ctx as any).tenant = tenantId;
		await this.onTenantResolved(tenantId, ctx);
	}
}

/**
 * A simple tenant middleware that allows public access by default.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class SimpleTenantMiddleware extends TenantMiddleware {}

/**
 * A strict tenant middleware that rejects requests without a tenant ID.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class StrictTenantMiddleware extends TenantMiddleware {
	protected allowPublic = false;
}
