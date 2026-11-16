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

export type {
	ColumnMetadata,
	DatabaseCacheConfig,
	DatabaseCacheStrategy,
	DatabaseDriver,
	IdType,
	RowKey,
	ModelAdapter,
	ModelClass,
	RepositoryClass,
	RepositoryInterface,
	TenancyStrategy
} from './interfaces.js';

export * from './database.js';
export * from './model.js';
export * from './repository.js';
export * from './memory.js';
export * from './pruner.js';
export { ModelResource, type ModelResourceOptions } from './resource.js';
export {
	type TransactionRunner,
	Transactional,
	UnitOfWork,
	withUnitOfWork
} from './unit-of-work.js';
export {
	type CursorPage,
	type OffsetPage,
	type Page,
	type PaginationOf,
	type FilterOperator,
	type ParsedFilter,
	type ParsedQuery,
	type ParsedSort,
	type QueryFieldType,
	type QueryFilterSpec,
	type QueryFilters,
	type QueryPagination,
	type QueryParamKeys,
	type QueryParams,
	type QuerySchemaProperties,
	type QuerySpec,
	Listing,
	PageSerializer
} from './query.js';

export {
	DuplicateSeederError,
	type PlannedSeeder,
	Seeder,
	type SeederClass,
	SeederCycleError,
	type SeederInput,
	type SeederProps,
	UnknownSeederError
} from './seeder.js';
export { DbSeedCommand } from './commands/db_seed.command.js';

export * from './tenancy.js';
export type { TenancyConfig, TenancyMode, ModelTenancyConfig } from './tenancy.js';

export {
	Cache,
	type CacheInterface,
	cacheStoreService,
	makeCacheInterface,
	MEMORY_CACHE_SERVICE
} from './cache.js';
export {
	DEFAULT_REPOSITORY_CACHE_TTL,
	REPOSITORY_CACHE_SERVICE,
	type RepositoryCacheOptions
} from './repository-cache.js';
export * from './mnemosyne.module.js';
export { CacheInterceptor, type CacheInterceptorOptions } from './cache.interceptor.js';
