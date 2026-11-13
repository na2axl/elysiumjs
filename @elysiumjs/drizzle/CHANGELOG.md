# @elysiumjs/drizzle

## 0.1.1

### Patch Changes

- [#114](https://github.com/na2axl/elysiumjs/pull/114) [`632a2d5`](https://github.com/na2axl/elysiumjs/commit/632a2d5accb18d06d273cafbffeebe7f5f1bde5d) Thanks [@na2axl](https://github.com/na2axl)! - `notificationsTable()`, `filesTable()`, `moiraiTables()` and `pgTable()` now declare their return types with Drizzle's own types (`PgTableWithColumns`, `PgBuildColumns`), through the new `BuiltPgTable` type. Their declarations no longer carry a copy of Drizzle's table shape, so the tables they build type-check against the Drizzle the app installs. `DrizzleConnectionProps` and `DrizzleDriverConfig` now take Drizzle relations (`defineRelations()`) as their type parameter, as `DrizzleConfig` does.

## 0.1.0

### Minor Changes

- [#112](https://github.com/na2axl/elysiumjs/pull/112) [`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023) Thanks [@na2axl](https://github.com/na2axl)! - `@elysiumjs/drizzle` provides Drizzle ORM for `@elysiumjs/olympus`: database drivers (Bun SQL, postgres.js, node-postgres, Hyperdrive), models, repositories, migrations, tenancy, the moirai stores, the notification and file stores, `rulesToDrizzle()` for abilities as SQL conditions, and the `postgres` lock driver. `@elysiumjs/pino` provides the `pino` logger driver, with pretty output in development.

### Patch Changes

- Updated dependencies [[`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023), [`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023), [`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023)]:
  - @elysiumjs/olympus@0.25.0
  - @elysiumjs/workers@0.1.0
