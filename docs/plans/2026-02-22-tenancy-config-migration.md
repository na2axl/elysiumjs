# Tenancy Config Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate tenancy configuration from standalone `configureTenancy()` function to the `elysium:mnemosyne` app config key.

**Architecture:** Update base package to read tenancy config from Application config; update driver package to auto-register tenancy strategy on app launch; remove deprecated `configureTenancy()` export.

**Tech Stack:** TypeScript, Bun, ElysiumJS framework patterns

---

## Task 1: Update MnemosyneConfig Interface

**Files:**
- Modify: `@elysiumjs/mnemosyne/src/index.ts:50-55`

**Step 1: Update the MnemosyneConfig interface to include tenancy**

Replace the existing interface:

```typescript
// Configuration types
export interface MnemosyneConfig<TConnectionConfig = unknown> {
	database?: {
		default: string;
		connections: Record<string, TConnectionConfig>;
	};
}
```

With:

```typescript
// Configuration types
export interface MnemosyneConfig<TConnectionConfig = unknown> {
	database?: {
		default: string;
		connections: Record<string, TConnectionConfig>;
	};
	tenancy?: TenancyConfig;
}
```

**Step 2: Verify typecheck passes**

Run: `cd @elysiumjs/mnemosyne && bun run typecheck`
Expected: PASS (no new errors)

**Step 3: Commit**

```bash
git add @elysiumjs/mnemosyne/src/index.ts
git commit -m "feat(mnemosyne): add tenancy to MnemosyneConfig interface"
```

---

## Task 2: Update tenancy.ts getConfig Function

**Files:**
- Modify: `@elysiumjs/mnemosyne/src/tenancy.ts:99-122`

**Step 1: Remove the _config variable and configure function**

Delete lines 101 and 113-115:

```typescript
let _config: TenancyConfig = { mode: 'schema' };
...
export const configure = (config: TenancyConfig): void => {
	_config = config;
};
```

**Step 2: Update getConfig to read from Application config**

Replace:

```typescript
export const getConfig = (): TenancyConfig => _config;
```

With:

```typescript
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
	return app.getConfig('elysium:mnemosyne')?.tenancy ?? { mode: 'schema' };
};
```

**Step 3: Run typecheck**

Run: `cd @elysiumjs/mnemosyne && bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add @elysiumjs/mnemosyne/src/tenancy.ts
git commit -m "refactor(mnemosyne): read tenancy config from Application config"
```

---

## Task 3: Remove configureTenancy Export

**Files:**
- Modify: `@elysiumjs/mnemosyne/src/index.ts:32-43`

**Step 1: Remove configure from exports**

Change:

```typescript
export {
	configure as configureTenancy,
	getConfig as getTenancyConfig,
	getCurrentTenant,
	withTenant,
	registerTenancyStrategy,
	getTenancyStrategy,
	TenantMiddleware,
	SimpleTenantMiddleware,
	StrictTenantMiddleware
} from './tenancy';
```

To:

```typescript
export {
	getConfig as getTenancyConfig,
	getCurrentTenant,
	withTenant,
	registerTenancyStrategy,
	getTenancyStrategy,
	TenantMiddleware,
	SimpleTenantMiddleware,
	StrictTenantMiddleware
} from './tenancy';
```

**Step 2: Run typecheck**

Run: `cd @elysiumjs/mnemosyne && bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add @elysiumjs/mnemosyne/src/index.ts
git commit -m "refactor(mnemosyne): remove configureTenancy export (breaking)"
```

---

## Task 4: Update Driver Auto-Initialization

**Files:**
- Modify: `@elysiumjs/mnemosyne-drizzle/src/index.ts:40-52`

**Step 1: Import registerTenancyStrategy and tenancy classes**

Add to existing imports:

```typescript
import { registerTenancyStrategy } from '@elysiumjs/mnemosyne';
```

**Step 2: Add tenancy strategy auto-registration to event handler**

Replace the event handler:

```typescript
Event.once('elysium:app:launched', () => {
	const app = Application.instance;
	const config = app.getConfig<MnemosyneConfig<DrizzleConnectionProps>>('elysium:mnemosyne' as any);

	if (config?.database) {
		for (const [name, props] of Object.entries(config.database.connections)) {
			Database.registerConnection(name, props);
		}
		if (Database.connectionExists(config.database.default)) {
			Database.setDefaultConnection(config.database.default);
		}
	}
});
```

With:

```typescript
Event.once('elysium:app:launched', () => {
	const app = Application.instance;
	const config = app.getConfig<MnemosyneConfig<DrizzleConnectionProps>>('elysium:mnemosyne' as any);

	if (config?.database) {
		for (const [name, props] of Object.entries(config.database.connections)) {
			Database.registerConnection(name, props);
		}
		if (Database.connectionExists(config.database.default)) {
			Database.setDefaultConnection(config.database.default);
		}
	}

	if (config?.tenancy) {
		const strategy =
			config.tenancy.mode === 'rls' ? new DrizzleRLSTenancy() : new DrizzleSchemaTenancy();
		registerTenancyStrategy(strategy);
	}
});
```

**Step 3: Run typecheck**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add @elysiumjs/mnemosyne-drizzle/src/index.ts
git commit -m "feat(mnemosyne-drizzle): auto-register tenancy strategy from config"
```

---

## Task 5: Update Base Package Tests

**Files:**
- Modify: `@elysiumjs/mnemosyne/tests/model.test.ts`

**Step 1: Find and review test usage of configureTenancy**

Run: `grep -n "configureTenancy\|configure" @elysiumjs/mnemosyne/tests/`

Review each occurrence and update to mock Application config instead.

**Step 2: Create helper to mock app config in tests**

If tests use `configureTenancy()`, replace with:

```typescript
// Before
import { configureTenancy } from '@elysiumjs/mnemosyne';
configureTenancy({ mode: 'rls', rls: { sessionVariable: 'app.tenant' } });

// After - mock Application.instance.getConfig
beforeEach(() => {
  Application.instance = {
    getConfig: mock(() => ({
      tenancy: { mode: 'rls', rls: { sessionVariable: 'app.tenant' } }
    }))
  } as any;
});
```

**Step 3: Run tests**

Run: `cd @elysiumjs/mnemosyne && bun test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add @elysiumjs/mnemosyne/tests/
git commit -m "test(mnemosyne): update tests for app config tenancy"
```

---

## Task 6: Update Driver Package Tests

**Files:**
- Modify: `@elysiumjs/mnemosyne-drizzle/tests/tenancy.test.ts`

**Step 1: Find and review test usage of configureTenancy**

Run: `grep -n "configureTenancy\|configure" @elysiumjs/mnemosyne-drizzle/tests/`

**Step 2: Update tests to mock Application config**

Same pattern as Task 5 - replace `configureTenancy()` calls with mocked `Application.instance.getConfig`.

**Step 3: Run tests**

Run: `cd @elysiumjs/mnemosyne-drizzle && bun test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add @elysiumjs/mnemosyne-drizzle/tests/
git commit -m "test(mnemosyne-drizzle): update tests for app config tenancy"
```

---

## Task 7: Final Verification

**Step 1: Run all tests**

Run: `bun run test`
Expected: All tests pass

**Step 2: Run typecheck on all packages**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Run linter**

Run: `bun run lint`
Expected: No errors

**Step 4: Build all packages**

Run: `bun run build`
Expected: Success

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: resolve remaining issues from tenancy config migration"
```

---

## Summary

- **3 code changes**: Config interface, getConfig implementation, exports
- **1 driver change**: Auto-registration of strategy
- **2 test updates**: Base and driver package tests
- **1 breaking change**: `configureTenancy()` removed
