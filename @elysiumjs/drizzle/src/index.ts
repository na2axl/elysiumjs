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

// Re-export drizzle-orm/pg-core with enhanced pgTable
export * from 'drizzle-orm';
export * from 'drizzle-orm/pg-core';
export type {
	SelectedFields,
	SelectedFieldsFlat,
	SelectedFieldsOrdered,
	TableConfig
} from 'drizzle-orm/pg-core';
export { pgTable, getTableBuilders } from './table';

// Re-exports
export { Database, DEFAULT_CACHE_TTL, DrizzleDatabaseCache, TenantMismatchError } from './database';
export type { DrizzleConnectionProps, DrizzleConnection, DrizzleQueryResultHKT } from './database';
export {
	type DrizzleDriver,
	type DrizzleDriverConfig,
	MissingDriverError,
	MissingMigrationsError
} from './driver';
export {
	DrizzleModel,
	createSchemaFromDrizzle,
	drizzleAdapter,
	type DrizzleModelOptions
} from './model';
export { DrizzleModule, type DrizzleModuleConfig } from './drizzle.module';
export {
	Migration,
	type MigrationConnection,
	type MigrationDatabase,
	type MigrationHook,
	type MigrationRun,
	type MigrationStep
} from './migration';
export {
	nodePostgresMigrations,
	templateClientMigrations,
	type PgPool,
	type TemplateClient
} from './migration-clients';
export {
	applyTableMarkers,
	DrizzleTable,
	getTableMarker,
	type CreatedTable,
	type PartitionColumn,
	type TableMarker
} from './table-markers';
export { compileAfter, compileFilter, compileQuery } from './query';
export { drizzleRepositoryAdapter } from './repository';
export {
	DrizzleSchemaTenancy,
	DrizzleRLSTenancy,
	wrapTenantSchema,
	registerTenantSchema,
	getTenantSchema,
	withRLS,
	getSessionTenant,
	createRLSPolicy
} from './tenancy';
export { PgAdvisoryLock } from './lock';
export {
	DrizzleEventStore,
	DrizzleIdempotencyStore,
	DrizzleInboxStore,
	DrizzleOutboxStore,
	DrizzleProjectionStorage,
	type DrizzleStoreOptions,
	moiraiTables,
	type MoiraiTables,
	type MoiraiTablesOptions,
	type StoreTable
} from './moirai';
