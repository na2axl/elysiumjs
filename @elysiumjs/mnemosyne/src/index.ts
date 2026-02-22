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

import type { DatabaseConnectionProps } from './database';

import { Application, Event } from '@elysiumjs/core';

import { Database } from './database';

export { Database, DatabaseCache } from './database';
export type { DatabaseConnectionProps, DatabaseConnection } from './database';
export { KeyvRedis } from './keyv-redis';
export { Cache } from './cache';
export type { CacheInterface } from './cache';
export { createSchemaFromDrizzle, Model } from './model';
export type { ModelClass } from './model';
export { Repository } from './repository';
export type { IdType, RepositoryInterface, RepositoryClass } from './repository';
export * as Tenancy from './tenancy';
export { TenantMiddleware, SimpleTenantMiddleware, StrictTenantMiddleware } from './tenancy';
export type { TenancyConfig, TenancyMode, ModelTenancyConfig } from './tenancy';
export type {
	ColumnMetadata,
	DatabaseCacheConfig,
	DatabaseCacheStrategy,
	DatabaseDriver,
	ModelAdapter,
	TenancyStrategy,
} from './interfaces';

// Configuration types
export interface MnemosyneConfig {
	database?: {
		default: string;
		connections: Record<string, DatabaseConnectionProps>;
	};
}

// Initialize on app launch
Event.once('elysium:app:launched', () => {
	const app = Application.instance;
	const config = app.getConfig<MnemosyneConfig>('elysium:mnemosyne' as any);

	if (config?.database) {
		for (const [name, props] of Object.entries(config.database.connections)) {
			Database.registerConnection(name, props);
		}
		if (Database.connectionExists(config.database.default)) {
			Database.setDefaultConnection(config.database.default);
		}
	}
});
