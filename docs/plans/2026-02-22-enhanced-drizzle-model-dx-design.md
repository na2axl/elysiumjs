# Enhanced DrizzleModel DX Design

**Date:** 2026-02-22
**Author:** Axel Nana
**Status:** Approved

## Overview

Simplify the `DrizzleModel` API to accept a `pgTable` directly, enabling better developer experience through reusable schema definitions and seamless integration with raw Drizzle code.

## Goals

1. **Reuse existing pgTable definitions** - Define tables once, use in models
2. **Simpler API** - `DrizzleModel(table)` instead of `DrizzleModel('name', columns)`
3. **Shared schema definitions** - Centralize table definitions in schema files
4. **Drop-in enhancement** - Same `pgTable` function name, just different import path

## Non-Goals

- Backward compatibility with old `DrizzleModel(tableName, columns)` signature (package is new)

## Design

### Enhanced `pgTable` Function

Override Drizzle's `pgTable` to automatically register column builders for tenancy support:

```typescript
// src/table.ts
import {
  pgTable as drizzlePgTable,
  type PgColumnBuilderBase,
  type PgTableWithColumns
} from 'drizzle-orm/pg-core';

const tableRegistry = new WeakMap<PgTableWithColumns<any>, Record<string, PgColumnBuilderBase>>();

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

export const getTableBuilders = (table: PgTableWithColumns<any>) => tableRegistry.get(table);
```

### Simplified `DrizzleModel` Function

Single signature accepting a table and optional configuration:

```typescript
// src/model.ts
interface DrizzleModelOptions {
  /**
   * Enable tenant schema support for this model.
   * @default false
   */
  supportTenancy?: boolean;
}

function DrizzleModel<TTable extends PgTableWithColumns<any>>(
  table: TTable,
  options?: DrizzleModelOptions
): DrizzleModelClass<TTable>;
```

### Package Exports

Re-export all of `drizzle-orm/pg-core` with the enhanced `pgTable`:

```typescript
// src/index.ts
// Re-export everything from drizzle-orm/pg-core
export * from 'drizzle-orm/pg-core';

// Override with enhanced versions
export { pgTable, getTableBuilders } from './table';
export { DrizzleModel, createSchemaFromDrizzle, drizzleAdapter } from './model';
export { Database, DrizzleConnection } from './database';
export * from './repository';
export * from './tenancy';
```

## Usage Examples

### Centralized Schema Definitions

```typescript
// schema/users.ts
import { pgTable, uuid, varchar, timestamp } from '@elysiumjs/mnemosyne-drizzle';

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).notNull().unique(),
  name: varchar({ length: 255 }).notNull(),
  createdAt: timestamp().defaultNow()
});
```

```typescript
// schema/posts.ts
import { pgTable, uuid, varchar, text, timestamp } from '@elysiumjs/mnemosyne-drizzle';
import { users } from './users';

export const posts = pgTable('posts', {
  id: uuid().primaryKey().defaultRandom(),
  title: varchar({ length: 255 }).notNull(),
  content: text().notNull(),
  authorId: uuid().notNull().references(() => users.id),
  createdAt: timestamp().defaultNow()
});
```

### Model Definition

```typescript
// models/user.model.ts
import { DrizzleModel } from '@elysiumjs/mnemosyne-drizzle';
import { users } from '../schema';

export class User extends DrizzleModel(users, { supportTenancy: true }) {
  static async findByEmail(email: string) {
    const db = Database.getConnection();
    return db.select().from(this.table).where(eq(this.table.email, email));
  }
}
```

```typescript
// models/post.model.ts
import { DrizzleModel } from '@elysiumjs/mnemosyne-drizzle';
import { posts } from '../schema';

export class Post extends DrizzleModel(posts) {
  // No tenancy - uses public schema
}
```

### Type Inference

```typescript
class User extends DrizzleModel(users) {}

// All correctly typed from the table definition:
type Select = User['$inferSelect'];
// { id: string; email: string; name: string; createdAt: Date | null; }

type Insert = User['$inferInsert'];
// { id?: string; email: string; name: string; createdAt?: Date; }

type Update = User['$inferUpdate'];
// Partial<{ id?: string; email?: string; name?: string; createdAt?: Date; }>
```

### Migration from Raw Drizzle

```typescript
// Before (raw Drizzle)
import { pgTable, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar().notNull()
});

// After (with mnemosyne integration)
import { pgTable, uuid, varchar } from '@elysiumjs/mnemosyne-drizzle';

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar().notNull()
});

// No code changes - just the import path!
```

## Tenancy Integration

When `supportTenancy: true`, the model's `table` getter automatically resolves to the tenant-scoped table:

```typescript
// schema.ts
export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: varchar().notNull(),
  name: varchar().notNull()
});

// model.ts
class User extends DrizzleModel(users, { supportTenancy: true }) {}

// At runtime:
// - No tenant context → User.table resolves to public.users
// - Tenant 'abc' context → User.table resolves to abc.users
```

The enhanced `pgTable` captures column builders at definition time, enabling the tenancy system to recreate tables in tenant schemas.

## Files to Modify

| File | Changes |
|------|---------|
| `src/table.ts` | New file - enhanced `pgTable` function |
| `src/model.ts` | Simplify `DrizzleModel` to single signature |
| `src/index.ts` | Re-export `drizzle-orm/pg-core`, override `pgTable` |
| `src/tenancy.ts` | Use `getTableBuilders` from new table module |
| `tests/model.test.ts` | Update tests for new API |
| `tests/setup.ts` | Update imports if needed |

## API Summary

### Before

```typescript
class User extends DrizzleModel('users', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar().notNull()
}) {}
```

### After

```typescript
// schema.ts
export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar().notNull()
});

// model.ts
class User extends DrizzleModel(users, { supportTenancy: true }) {}
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| WeakMap registry could lose entries | Tables are typically module-level constants, always referenced |
| Type inference complexity | Use existing Drizzle inference patterns |
| Collision with drizzle-orm/pg-core exports | Explicit re-exports with overrides |

## Success Criteria

- [ ] Single `DrizzleModel(table, options?)` signature works
- [ ] `pgTable` from `@elysiumjs/mnemosyne-drizzle` is drop-in compatible with Drizzle's
- [ ] All existing tests pass
- [ ] Tenancy works with the new `pgTable` + `DrizzleModel` flow
- [ ] Type inference works correctly for `$inferSelect`, `$inferInsert`, `$inferUpdate`
