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
export { pgTable, getTableBuilders } from './table.js';

// Re-exports
export { rulesToDrizzle, UntranslatableRuleError } from './cerberus.js';
export {
	Database,
	DEFAULT_CACHE_TTL,
	DrizzleDatabaseCache,
	TenantMismatchError
} from './database.js';
export type {
	DrizzleConnectionProps,
	DrizzleConnection,
	DrizzleQueryResultHKT
} from './database.js';
export {
	type DrizzleDriver,
	type DrizzleDriverConfig,
	MissingDriverError,
	MissingMigrationsError
} from './driver.js';
export {
	DrizzleModel,
	createSchemaFromDrizzle,
	drizzleAdapter,
	type DrizzleModelOptions
} from './model.js';
export { DrizzleModule, type DrizzleModuleConfig } from './drizzle.module.js';
export {
	Migration,
	type MigrationConnection,
	type MigrationDatabase,
	type MigrationHook,
	type MigrationRun,
	type MigrationStep
} from './migration.js';
export {
	nodePostgresMigrations,
	templateClientMigrations,
	type PgPool,
	type TemplateClient
} from './migration-clients.js';
export {
	applyTableMarkers,
	DrizzleTable,
	getTableMarker,
	type CreatedTable,
	type PartitionColumn,
	type TableMarker
} from './table-markers.js';
export { compileAfter, compileFilter, compileQuery } from './query.js';
export { drizzleRepositoryAdapter } from './repository.js';
export {
	DrizzleSchemaTenancy,
	DrizzleRLSTenancy,
	wrapTenantSchema,
	registerTenantSchema,
	getTenantSchema,
	withRLS,
	getSessionTenant,
	createRLSPolicy
} from './tenancy.js';
export { PgAdvisoryLock } from './lock.js';
export { DrizzleNotificationStore, notificationsTable, type NotificationsTable } from './hermes.js';
export { DrizzleFileStore, filesTable, type FilesTable } from './pithos.js';
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
} from './moirai.js';
export {
	DrizzleWorkflowStore,
	type DrizzleWorkflowStoreOptions,
	workflowTables,
	type WorkflowTables
} from './odysseus.js';
