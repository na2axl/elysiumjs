---
'@elysiumjs/core': minor
'@elysiumjs/argus': minor
'@elysiumjs/cerberus': minor
'@elysiumjs/hephaestus': minor
'@elysiumjs/heracles': minor
'@elysiumjs/mnemosyne-drizzle': minor
'@elysiumjs/plugin-sentry': minor
'@elysiumjs/styx': minor
'create-elysium': minor
---

Upgrade dependencies to their latest major versions: wampy 8, zod 4, commander 15, @casl/ability 7, OpenTelemetry SDK 2 (sdk-node 0.300, resources 3), @sentry/bun 11. Generated projects now use TypeScript 7.

Breaking in `@elysiumjs/mnemosyne-drizzle`: it now requires drizzle-orm 1.0 (release candidate) and generated projects use drizzle-kit 1.0. `ColumnsWithTable` is no longer re-exported. `migration:generate` writes 1.0 migration folders (`<timestamp>_<name>/migration.sql`), and `migration:run` tracks those by folder name while still running flat `*.sql` files. Existing projects can upgrade their migrations folder with `drizzle-kit up`: `migration:run` recognises the moved migrations as already applied and renames their records. The `make:model` stub now generates a `pgTable` and a `DrizzleModel` built from it.

Breaking in `@elysiumjs/core`: the deprecated `@elysiajs/swagger` plugin is replaced by `@elysiajs/openapi`, and the app option `swagger` is renamed `openapi` (typed `ElysiaOpenAPIConfig | false`). Without a `path`, the docs now live at `/openapi` instead of `/swagger`. The UI options `scalarConfig` and `swaggerOptions` are now `scalar` and `swagger`. Elysia stays on 1.4 (now `^1.4.30`) until Elysia 2 and its OpenAPI plugin are stable.

Also in `@elysiumjs/core`: the WAMP `onChallenge` callback must return a string (or a promise of one); `null` is no longer accepted. `onError` now receives the error and `onReconnectSuccess` receives wampy's details object. `WampClient` is now wampy's own `Wampy` type. `onOpen` is called by Elysium once the connection is established, since wampy 8 no longer has that callback.
