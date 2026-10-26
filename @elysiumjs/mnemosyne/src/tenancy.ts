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

import { Application, Middleware, Service } from '@elysiumjs/core';

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
// Configuration
// ============================================================================

/** Name of the global service holding the {@link TenancyConfig}, registered by driver modules. */
export const TENANCY_CONFIG_SERVICE = 'mnemosyne.tenancy.config';

/** Name of the global service holding the {@link TenancyStrategy}, registered by driver modules. */
export const TENANCY_STRATEGY_SERVICE = 'mnemosyne.tenancy.strategy';

/**
 * Gets the current global tenancy configuration.
 *
 * Reads the global service `mnemosyne.tenancy.config`. Returns a default
 * configuration if none is registered.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @returns The current tenancy configuration.
 */
export const getTenancyConfig = (): TenancyConfig => {
	return Service.get<TenancyConfig>(TENANCY_CONFIG_SERVICE) ?? { mode: 'schema' };
};

/**
 * Gets the tenancy strategy registered by the driver module as the global service
 * `mnemosyne.tenancy.strategy`.
 * @author Axel Nana <axel.nana@workbud.com>
 * @returns The current tenancy strategy, or `null` if none is registered.
 */
export const getTenancyStrategy = (): TenancyStrategy<unknown, unknown> | null => {
	return Service.get<TenancyStrategy<unknown, unknown>>(TENANCY_STRATEGY_SERVICE);
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
	// `Application.context` falls back to a module-level storage when no application instance
	// exists (for instance under `Application.testing`), so the tenant is readable there too.
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
// Tenant Identifiers
// ============================================================================

/**
 * The pattern a tenant identifier must match: 1 to 63 ASCII letters, digits, underscores or dashes,
 * not starting with `pg_` and other than `information_schema` (in any case).
 *
 * Tenant identifiers become PostgreSQL schema names in schema mode, and 63 bytes is the PostgreSQL
 * identifier limit. The pattern leaves out quotes, dots, spaces and other characters that would
 * need escaping or change how an identifier is read, and the names of PostgreSQL system schemas.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const TENANT_ID_PATTERN = /^(?!pg_)(?!information_schema$)[a-z0-9_-]{1,63}$/i;

/**
 * Checks that a tenant identifier is well-formed (see {@link TENANT_ID_PATTERN}). This does not
 * check that the tenant exists.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The tenant identifier.
 * @returns `true` if the identifier is well-formed, `false` otherwise.
 */
export const isValidTenantId = (tenant: string): boolean => TENANT_ID_PATTERN.test(tenant);

// ============================================================================
// TenantMiddleware Base Class
// ============================================================================

/**
 * Base class for tenant-aware middleware.
 *
 * The middleware extracts the tenant identifier from an HTTP header and
 * sets `ctx.tenant`. Identifiers must match {@link TENANT_ID_PATTERN} and be accepted by
 * `validateTenant`, which rejects every tenant unless overridden. For RLS mode, route handlers should use the driver's
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
	 *
	 * Rejects every tenant by default: override it to check the tenant against your data store.
	 * Only identifiers matching {@link TENANT_ID_PATTERN} reach this method.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param _tenant The tenant identifier to validate.
	 * @returns `true` if the tenant is valid, `false` otherwise.
	 */
	protected async validateTenant(_tenant: string): Promise<boolean> {
		return false;
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

		const isValid = isValidTenantId(tenantId) && (await this.validateTenant(tenantId));
		if (!isValid) {
			return this.onTenantError('invalid', ctx);
		}

		(ctx as any).tenant = tenantId;
		await this.onTenantResolved(tenantId, ctx);
	}
}

/**
 * A simple tenant middleware that allows public access by default. Requests naming a tenant are
 * rejected until `validateTenant` is overridden.
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
