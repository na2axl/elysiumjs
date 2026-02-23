# Enhanced DrizzleModel DX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify DrizzleModel API to accept pgTable directly, enabling better DX through reusable schema definitions.

**Architecture:** Override Drizzle's pgTable to register column builders, simplify DrizzleModel to single signature accepting a table.

**Tech Stack:** TypeScript, Drizzle ORM, Bun test framework

---

## Task 1: Create Enhanced pgTable Function

**Files:**
- Create: `@elysiumjs/mnemosyne-drizzle/src/table.ts`
- Test: `@elysiumjs/mnemosyne-drizzle/tests/table.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/table.test.ts
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as d from 'drizzle-orm/pg-core';

import { pgTable, getTableBuilders } from '../src/table';

describe('pgTable', () => {
	describe('table creation', () => {
		it('should create a table with the same signature as drizzle pgTable', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom(),
				name: d.varchar().notNull()
			};

			const table = pgTable('users', cols);

			expect(table).toBeDefined();
			expect(table).toHaveProperty('id');
			expect(table).toHaveProperty('name');
		});

		it('should support extraConfig parameter', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom()
			};

			const table = pgTable('items', cols, (t) => ({
				unique: t.unique().on(t.id)
			}));

			expect(table).toBeDefined();
		});
	});

	describe('column builder registry', () => {
		it('should register column builders for created tables', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom(),
				email: d.varchar().notNull()
			};

			const table = pgTable('registered', cols);
			const builders = getTableBuilders(table);

			expect(builders).toBeDefined();
			expect(builders).toHaveProperty('id');
			expect(builders).toHaveProperty('email');
		});

		it('should return undefined for tables not created with enhanced pgTable', () => {
			const rawTable = d.pgTable('raw', {
				id: d.uuid().primaryKey()
			});

			const builders = getTableBuilders(rawTable);
			expect(builders).toBeUndefined();
		});
	});
});
```

**Step 2: Run test to verify it fails**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun test tests/table.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/table.ts
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

import type { PgColumnBuilderBase, PgTableWithColumns } from 'drizzle-orm/pg-core';

import { pgTable as drizzlePgTable } from 'drizzle-orm/pg-core';

// ============================================================================
// Column Builder Registry
// ============================================================================

/**
 * Maps tables to their original column builder definitions.
 *
 * When `pgTable()` is called, column builders are consumed and turned into
 * built `PgColumn` instances. This registry preserves the original builder
 * objects so that tenant tables can be re-created in different schemas.
 */
const tableRegistry = new WeakMap<PgTableWithColumns<any>, Record<string, PgColumnBuilderBase>>();

/**
 * Retrieves the original column builders for a table.
 * @param table The table created with enhanced pgTable.
 * @returns The original column builder definitions, or `undefined`.
 */
export const getTableBuilders = (
	table: PgTableWithColumns<any>
): Record<string, PgColumnBuilderBase> | undefined => {
	return tableRegistry.get(table);
};

// ============================================================================
// Enhanced pgTable Function
// ============================================================================

/**
 * Creates a PostgreSQL table with automatic column builder registration.
 *
 * This is an enhanced version of Drizzle's `pgTable` that automatically
 * registers column builders for tenancy support. It has the exact same
 * signature and behavior as the original.
 *
 * @param tableName The name of the database table.
 * @param columns The column definitions.
 * @param extraConfig Optional extra Drizzle table configuration.
 * @returns A Drizzle PostgreSQL table with registered column builders.
 */
export const pgTable = <
	TTableName extends string,
	TColumns extends Record<string, PgColumnBuilderBase>
>(
	tableName: TTableName,
	columns: TColumns,
	extraConfig?: (table: any) => any
): PgTableWithColumns<{
	[K in keyof TColumns]: TColumns[K] extends PgColumnBuilderBase<infer T> ? T : never;
}> => {
	const table = drizzlePgTable(tableName, columns, extraConfig);
	tableRegistry.set(table, columns);
	return table as any;
};
```

**Step 4: Run test to verify it passes**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun test tests/table.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add @elysiumjs/mnemosyne-drizzle/src/table.ts @elysiumjs/mnemosyne-drizzle/tests/table.test.ts
git commit -m "feat(mnemosyne-drizzle): add enhanced pgTable with column builder registry"
```

---

## Task 2: Update DrizzleModel to Single Signature

**Files:**
- Modify: `@elysiumjs/mnemosyne-drizzle/src/model.ts`
- Modify: `@elysiumjs/mnemosyne-drizzle/tests/model.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to tests/model.test.ts

describe('DrizzleModel with pgTable', () => {
	describe('single signature API', () => {
		it('should accept a pgTable directly', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom(),
				title: d.varchar().notNull()
			};
			const posts = pgTable('posts', cols);

			class Post extends DrizzleModel(posts) {}

			expect(Post.tableName).toBe('posts');
			expect(Post.table).toBeDefined();
			expect(Post.insertSchema).toBeDefined();
			expect(Post.updateSchema).toBeDefined();
			expect(Post.selectSchema).toBeDefined();
		});

		it('should support supportTenancy option', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom(),
				name: d.varchar().notNull()
			};
			const tenants = pgTable('tenants', cols);

			class Tenant extends DrizzleModel(tenants, { supportTenancy: true }) {}

			expect(Tenant.supportTenancy).toBe(true);
		});

		it('should default supportTenancy to false', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom()
			};
			const items = pgTable('items', cols);

			class Item extends DrizzleModel(items) {}

			expect(Item.supportTenancy).toBe(false);
		});

		it('should infer types from the table', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom(),
				email: d.varchar().notNull(),
				age: d.integer()
			};
			const users = pgTable('typed_users', cols);

			class TypedUser extends DrizzleModel(users) {}

			// Type inference markers
			expect(TypedUser.$inferSelect).toBeUndefined();
			expect(TypedUser.$inferInsert).toBeUndefined();
			expect(TypedUser.$inferUpdate).toBeUndefined();
		});
	});

	describe('tenancy with pgTable', () => {
		it('should create tenant table when tenancy is enabled', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom(),
				data: d.varchar().notNull()
			};
			const tenantData = pgTable('tenant_data', cols);

			class TenantData extends DrizzleModel(tenantData, { supportTenancy: true }) {}

			// Should not throw when accessing table
			expect(TenantData.table).toBeDefined();
		});
	});
});
```

**Step 2: Run test to verify it fails**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun test tests/model.test.ts`
Expected: FAIL - signature mismatch

**Step 3: Write minimal implementation**

```typescript
// src/model.ts - Rewrite with new signature
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

import type { ColumnMetadata, ModelAdapter } from '@elysiumjs/mnemosyne';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';

import { AbstractModel, createSchemaFromModel } from '@elysiumjs/mnemosyne';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { getTableBuilders } from './table';
import { wrapTenantSchema } from './tenancy';

// ============================================================================
// Column Type Mapping
// ============================================================================

/**
 * Maps a Drizzle column to a normalized data type.
 * @param col The Drizzle column to inspect.
 * @returns A normalized data type string.
 */
const mapDrizzleDataType = (col: PgColumn): ColumnMetadata['dataType'] => {
	if (col.columnType === 'PgUUID') return 'uuid';
	switch (col.dataType) {
		case 'string':
			return 'string';
		case 'number':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'array':
			return 'array';
		case 'json':
			return 'json';
		case 'date':
			return 'date';
		case 'bigint':
			return 'bigint';
		case 'buffer':
			return 'buffer';
		default:
			return 'string';
	}
};

// ============================================================================
// Drizzle Model Adapter
// ============================================================================

/**
 * Drizzle-specific model adapter.
 *
 * Bridges Drizzle's `PgTableWithColumns` to the framework's
 * normalized model metadata.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const drizzleAdapter: ModelAdapter<PgTableWithColumns<any>> = {
	getTableName(table) {
		return getTableConfig(table).name;
	},

	getColumns(table): ColumnMetadata[] {
		const config = getTableConfig(table);
		return config.columns.map((col: PgColumn) => ({
			name: col.name,
			dataType: mapDrizzleDataType(col),
			nullable: !col.notNull,
			hasDefault: col.hasDefault,
			isPrimaryKey:
				col.primary || config.primaryKeys.some((pk) => pk.columns.some((c) => c.name === col.name))
		}));
	},

	createTenantTable(table, tenant) {
		const builders = getTableBuilders(table);
		if (!builders) {
			throw new Error(
				`No column builders registered for table. ` +
					`Use pgTable() from '@elysiumjs/mnemosyne-drizzle' for tenant support.`
			);
		}
		const config = getTableConfig(table);
		return wrapTenantSchema(tenant, config.name, builders) as PgTableWithColumns<any>;
	}
};

// ============================================================================
// Schema Helper
// ============================================================================

/**
 * Creates Elysia validation schemas from a Drizzle table.
 *
 * This is a convenience wrapper around `createSchemaFromModel` that
 * automatically extracts column metadata via the `drizzleAdapter`.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @param table The Drizzle table to generate schemas for.
 * @param opts Schema generation options.
 * @returns An Elysia validation schema.
 */
export const createSchemaFromDrizzle = (
	table: PgTableWithColumns<any>,
	opts?: { mode?: 'create' | 'update' | 'select' }
) => {
	return createSchemaFromModel(drizzleAdapter.getColumns(table), opts);
};

// ============================================================================
// DrizzleModel Options
// ============================================================================

/**
 * Options for creating a DrizzleModel.
 */
export interface DrizzleModelOptions {
	/**
	 * Enable tenant schema support for this model.
	 * @default false
	 */
	supportTenancy?: boolean;
}

// ============================================================================
// DrizzleModel Function
// ============================================================================

/**
 * Creates a model class backed by a Drizzle pgTable.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @param table The Drizzle table (created with enhanced pgTable).
 * @param options Model configuration options.
 * @returns A model class with Drizzle-backed static metadata.
 */
export const DrizzleModel = <TTable extends PgTableWithColumns<any>>(
	table: TTable,
	options?: DrizzleModelOptions
) => {
	const config = getTableConfig(table);
	const builders = getTableBuilders(table);

	type TSelect = TTable['$inferSelect'];
	type TInsert = TTable['$inferInsert'];

	const Base = AbstractModel(config.name, builders ?? {}, drizzleAdapter, table);

	// Override supportTenancy if specified
	if (options?.supportTenancy !== undefined) {
		(Base as any).supportTenancy = options.supportTenancy;
	}

	return Base as typeof Base & {
		readonly $inferSelect: TSelect;
		readonly $inferInsert: TInsert;
		readonly $inferUpdate: Partial<TInsert>;
		readonly table: TTable;
	};
};
```

**Step 4: Run test to verify it passes**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun test tests/model.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add @elysiumjs/mnemosyne-drizzle/src/model.ts @elysiumjs/mnemosyne-drizzle/tests/model.test.ts
git commit -m "feat(mnemosyne-drizzle): simplify DrizzleModel to single table signature"
```

---

## Task 3: Update Package Exports

**Files:**
- Modify: `@elysiumjs/mnemosyne-drizzle/src/index.ts`

**Step 1: Write implementation**

```typescript
// src/index.ts
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

// Re-export everything from drizzle-orm/pg-core for convenience
export * from 'drizzle-orm/pg-core';

// Override with enhanced versions
export { pgTable, getTableBuilders } from './table';
export { DrizzleModel, createSchemaFromDrizzle, drizzleAdapter, type DrizzleModelOptions } from './model';
export { Database, type DrizzleConnection, type DrizzleConnectionConfig } from './database';
export { Repository, type RepositoryClass } from './repository';
export {
	getTenancyConfig,
	registerTenancyStrategy,
	type TenancyStrategy,
	DrizzleSchemaTenancy,
	DrizzleRLSTenancy,
	registerTenantSchema,
	getTenantSchema,
	wrapTenantSchema,
	withRLS,
	setConnectionTenant,
	getSessionTenant,
	createRLSPolicy
} from './tenancy';
```

**Step 2: Run all tests to verify**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun test`
Expected: PASS

**Step 3: Commit**

```bash
git add @elysiumjs/mnemosyne-drizzle/src/index.ts
git commit -m "feat(mnemosyne-drizzle): re-export drizzle-orm/pg-core with enhanced pgTable"
```

---

## Task 4: Update Tenancy Module

**Files:**
- Modify: `@elysiumjs/mnemosyne-drizzle/src/tenancy.ts`

**Step 1: Update imports**

Update the import to use `getTableBuilders` from the new table module instead of the old model module:

```typescript
// In tenancy.ts, update this import:
import { getTableColumnBuilders } from './model';

// To:
import { getTableBuilders } from './table';
```

**Step 2: Update usages**

Update all references to `getTableColumnBuilders` to use `getTableBuilders`:

```typescript
// Before
const builders = getTableColumnBuilders(table);

// After
const builders = getTableBuilders(table);
```

Also update error message:

```typescript
throw new Error(
  `No column builders registered for table. ` +
    `Use pgTable() from '@elysiumjs/mnemosyne-drizzle' for tenant support.`
);
```

**Step 3: Run tenancy tests**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun test tests/tenancy.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add @elysiumjs/mnemosyne-drizzle/src/tenancy.ts
git commit -m "refactor(mnemosyne-drizzle): update tenancy to use getTableBuilders from table module"
```

---

## Task 5: Remove Old Registry Code from Model

**Files:**
- Modify: `@elysiumjs/mnemosyne-drizzle/src/model.ts`
- Modify: `@elysiumjs/mnemosyne-drizzle/tests/model.test.ts`

**Step 1: Remove deprecated exports**

Remove from model.ts:
- `registerTableColumnBuilders` function
- `getTableColumnBuilders` function
- `columnBuilderRegistry` WeakMap

**Step 2: Update tests to remove tests for removed functions**

Remove tests for:
- `registerTableColumnBuilders`
- Any tests using the old `DrizzleModel(tableName, columns)` signature

**Step 3: Run all tests**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add @elysiumjs/mnemosyne-drizzle/src/model.ts @elysiumjs/mnemosyne-drizzle/tests/model.test.ts
git commit -m "refactor(mnemosyne-drizzle): remove deprecated column builder registry from model"
```

---

## Task 6: Update Tenancy Tests

**Files:**
- Modify: `@elysiumjs/mnemosyne-drizzle/tests/tenancy.test.ts`

**Step 1: Update imports**

Change imports to use `pgTable` from the package instead of raw drizzle-orm:

```typescript
// Before
import * as d from 'drizzle-orm/pg-core';

// After
import { pgTable, uuid, varchar } from '../src/table';
// Or from index if testing public API
import { pgTable, uuid, varchar } from '../src';
```

**Step 2: Update test to use pgTable**

Update tests that create tables for tenancy to use enhanced `pgTable`:

```typescript
it('should create a tenant-scoped table when column builders are registered', () => {
  const cols = {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar().notNull()
  };
  const table = pgTable('items', cols);

  const tenantTable = wrapTenantSchema('tenant-abc', 'items', cols);
  expect(tenantTable).toBeDefined();
});
```

**Step 3: Run tenancy tests**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun test tests/tenancy.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add @elysiumjs/mnemosyne-drizzle/tests/tenancy.test.ts
git commit -m "test(mnemosyne-drizzle): update tenancy tests to use enhanced pgTable"
```

---

## Task 7: Run Full Test Suite and Type Check

**Files:**
- N/A

**Step 1: Run all tests**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun test`
Expected: All tests PASS

**Step 2: Run type check**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun run typecheck`
Expected: No errors

**Step 3: Run lint**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun run lint`
Expected: No errors

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(mnemosyne-drizzle): fix type and lint errors"
```

---

## Verification Checklist

After completing all tasks, verify:

- [ ] `pgTable` from `@elysiumjs/mnemosyne-drizzle` works identically to Drizzle's `pgTable`
- [ ] `DrizzleModel(table)` creates a model class with correct metadata
- [ ] `DrizzleModel(table, { supportTenancy: true })` enables tenant support
- [ ] All existing tests pass
- [ ] Type inference works for `$inferSelect`, `$inferInsert`, `$inferUpdate`
- [ ] Tenancy integration works with the new `pgTable`
- [ ] `drizzle-orm/pg-core` is fully re-exported for convenience
