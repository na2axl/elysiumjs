# Tenancy Configuration Migration

**Date:** 2026-02-22
**Status:** Approved

## Summary

Migrate tenancy configuration from standalone `configureTenancy()` function to the `elysium:mnemosyne` app config key for consistency with other packages (hermes) and improved developer experience.

## Motivation

- **Consistency**: Align tenancy config with other packages' patterns (hermes uses `elysium:hermes`)
- **Developer experience**: Single config location in `@Application.register()` instead of calling `configureTenancy()` separately
- **Auto-initialization**: Let mnemosyne-drizzle read tenancy config from app config during `'elysium:app:launched'` event and auto-register the appropriate strategy

## Design

### Config Structure

The `MnemosyneConfig` interface expands to include tenancy:

```typescript
// @elysiumjs/mnemosyne/src/index.ts
export interface MnemosyneConfig<TConnectionConfig = unknown> {
  database?: {
    default: string;
    connections: Record<string, TConnectionConfig>;
  };
  tenancy?: {
    mode: 'schema' | 'rls';
    rls?: {
      sessionVariable?: string;    // default: 'app.current_tenant'
      defaultColumn?: string;       // default: 'tenant_id'
    };
    schema?: {
      autoCreate?: boolean;
    };
  };
}
```

**Usage in app:**

```typescript
@Application.register({
  'elysium:mnemosyne': {
    database: {
      default: 'main',
      connections: { main: { connection: process.env.DATABASE_URL! } }
    },
    tenancy: {
      mode: 'rls',
      rls: { sessionVariable: 'app.tenant_id' }
    }
  }
})
export class App extends Application {}
```

### Base Package Changes (`@elysiumjs/mnemosyne`)

**`src/tenancy.ts`:**

1. Remove `configure()` function and `_config` module-level variable
2. Update `getConfig()` to read from `Application.instance.getConfig('elysium:mnemosyne')?.tenancy` with fallback

```typescript
// Before
let _config: TenancyConfig = { mode: 'schema' };
export const configure = (config: TenancyConfig): void => { _config = config; };
export const getConfig = (): TenancyConfig => _config;

// After
export const getConfig = (): TenancyConfig => {
  const app = Application.instance;
  if (!app) return { mode: 'schema' };
  return app.getConfig('elysium:mnemosyne')?.tenancy ?? { mode: 'schema' };
};
```

**`src/index.ts`:**

1. Remove `configure as configureTenancy` export
2. Keep `getConfig as getTenancyConfig` export (unchanged)

**No changes needed to:**
- `TenantMiddleware` classes (use `getConfig()` internally)
- `TenancyConfig` and `ModelTenancyConfig` types

### Driver Package Changes (`@elysiumjs/mnemosyne-drizzle`)

**`src/index.ts`:**

Extend the `elysium:app:launched` event handler to auto-register tenancy strategy:

```typescript
Event.once('elysium:app:launched', () => {
  const app = Application.instance;
  const config = app.getConfig<MnemosyneConfig<DrizzleConnectionProps>>('elysium:mnemosyne' as any);

  // Existing: Database connections
  if (config?.database) {
    for (const [name, props] of Object.entries(config.database.connections)) {
      Database.registerConnection(name, props);
    }
    if (Database.connectionExists(config.database.default)) {
      Database.setDefaultConnection(config.database.default);
    }
  }

  // New: Auto-register tenancy strategy
  if (config?.tenancy) {
    const strategy = config.tenancy.mode === 'rls'
      ? new DrizzleRLSTenancy()
      : new DrizzleSchemaTenancy();
    registerTenancyStrategy(strategy);
  }
});
```

**No changes needed to:**
- `src/tenancy.ts` - Strategies already use `getTenancyConfig()`
- `src/database.ts`, `src/model.ts`, `src/repository.ts`

### Edge Cases

**Config accessed before app launch:**

Some code paths may call `getTenancyConfig()` before app initialization. The fallback handles this gracefully:

```typescript
export const getConfig = (): TenancyConfig => {
  const app = Application.instance;
  if (!app) return { mode: 'schema' };  // Safe default
  return app.getConfig('elysium:mnemosyne')?.tenancy ?? { mode: 'schema' };
};
```

## Breaking Changes

- `configureTenancy()` removed from exports
- Tenancy config must now be in `'elysium:mnemosyne'` app config key

## Testing

- Update `@elysiumjs/mnemosyne/tests/model.test.ts` - Remove `configureTenancy()` calls, mock app config
- Update `@elysiumjs/mnemosyne-drizzle/tests/tenancy.test.ts` - Same pattern
