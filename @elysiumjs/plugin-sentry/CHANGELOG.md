# @elysiumjs/plugin-sentry

## 0.4.6

### Patch Changes

- Updated dependencies [[`8235094`](https://github.com/na2axl/elysiumjs/commit/823509464b9f71a80fdac117418b7e3e1213103c)]:
  - @elysiumjs/core@0.23.0

## 0.4.5

### Patch Changes

- Updated dependencies [[`791048c`](https://github.com/na2axl/elysiumjs/commit/791048ca9eca4c69a8cb199482541fe95327c786)]:
  - @elysiumjs/core@0.22.0

## 0.4.4

### Patch Changes

- Updated dependencies [[`5b79d5a`](https://github.com/na2axl/elysiumjs/commit/5b79d5a4b634347ce18766ef08aec12916328ff6), [`9bd29cb`](https://github.com/na2axl/elysiumjs/commit/9bd29cbd10131e4465505de91c78e7f39d242e71)]:
  - @elysiumjs/core@0.21.0

## 0.4.3

### Patch Changes

- Updated dependencies [[`920b941`](https://github.com/na2axl/elysiumjs/commit/920b941a9c070c9006fe277abc7a187b9d140af7), [`9901020`](https://github.com/na2axl/elysiumjs/commit/99010200522c56bb37cbc44c7ffa311d69972599), [`7dc7c59`](https://github.com/na2axl/elysiumjs/commit/7dc7c59f67b9f62159064f7958f529f4e6e27e65)]:
  - @elysiumjs/core@0.20.0

## 0.4.2

### Patch Changes

- Updated dependencies [[`af05b49`](https://github.com/na2axl/elysiumjs/commit/af05b498a2c4d4dafda44f361fe68c490f49a8c7), [`7ffe5eb`](https://github.com/na2axl/elysiumjs/commit/7ffe5eb3926d8a428c6cb14fdc9437758d4c99b5)]:
  - @elysiumjs/core@0.19.0

## 0.4.1

### Patch Changes

- Updated dependencies [[`d471a6e`](https://github.com/na2axl/elysiumjs/commit/d471a6e69736e016eb972a0715987df1d7b62438)]:
  - @elysiumjs/core@0.18.0

## 0.4.0

### Minor Changes

- [#54](https://github.com/na2axl/elysiumjs/pull/54) [`ec07c41`](https://github.com/na2axl/elysiumjs/commit/ec07c410c417053df4e284d8ddc6d2c4da4e42ec) Thanks [@na2axl](https://github.com/na2axl)! - `SentryModule` declares `SENTRY_DSN` and `SENTRY_ENVIRONMENT` in its environment schema (`SentryEnv`), so they are validated at boot and typed in `Env.get()`.

### Patch Changes

- Updated dependencies [[`ec07c41`](https://github.com/na2axl/elysiumjs/commit/ec07c410c417053df4e284d8ddc6d2c4da4e42ec)]:
  - @elysiumjs/core@0.17.1

## 0.3.6

### Patch Changes

- Updated dependencies [[`762661e`](https://github.com/na2axl/elysiumjs/commit/762661e362444f431ea84576494322a9a7a81539)]:
  - @elysiumjs/core@0.17.0

## 0.3.5

### Patch Changes

- Updated dependencies [[`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9)]:
  - @elysiumjs/core@0.16.0

## 0.3.4

### Patch Changes

- Updated dependencies [[`d663d2e`](https://github.com/na2axl/elysiumjs/commit/d663d2ed95778079f71e53fcaf60a7f8ef570f6d)]:
  - @elysiumjs/core@0.15.0

## 0.3.3

### Patch Changes

- Updated dependencies [[`359f157`](https://github.com/na2axl/elysiumjs/commit/359f1579b9ad69643da5360d9ca9e80104fbe2f1)]:
  - @elysiumjs/core@0.14.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`c8d9f53`](https://github.com/na2axl/elysiumjs/commit/c8d9f534eef32621eae121f7008f97dc24808141)]:
  - @elysiumjs/core@0.13.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`651a755`](https://github.com/na2axl/elysiumjs/commit/651a7557173ce2c6155bcfa8d90cf388ac419821)]:
  - @elysiumjs/core@0.12.0

## 0.3.0

### Minor Changes

- [#7](https://github.com/na2axl/elysiumjs/pull/7) [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148) Thanks [@na2axl](https://github.com/na2axl)! - Elysium runs on Elysia 2 (`elysia@^2.0.0-rc.1`), with TypeBox 1 (`typebox`), `@elysia/openapi` and `@elysia/opentelemetry`.

  Breaking:

  - `TSchema` and `Static` are re-exported from `typebox` instead of `@sinclair/typebox`; `Value` comes from `typebox/value` and `Value.Errors()` returns an array.
  - `Application.onError()` receives a `ServerError` (exported from core). Elysia now names its errors in kebab case; the default error response keeps the upper snake case names (`VALIDATION`, `NOT_FOUND`, `UNKNOWN` for other errors).
  - `AppHttpContext` is a plain interface with `decorator`, `store` and `derive` records (Elysia 2 renamed `resolve` to `derive`).
  - Websocket controllers install Elysia's `websocket()` capability themselves.

  A module or controller `onRequest` middleware that answers now stops the request: Elysia 2 ignores values returned from a transform hook, so the response is thrown as a status and sent as is, without going through `onError`.

  `mnemosyne` builds date columns with `t.Codec` (TypeBox 1 dropped `Transform`). `argus` traces every route of the app it is installed on and ends each span once, keeping the error status when the request failed.

### Patch Changes

- Updated dependencies [[`6bc48fe`](https://github.com/na2axl/elysiumjs/commit/6bc48febd51f7090c582e73f349eaeff7261241c), [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148), [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82), [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4), [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562), [`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5), [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64), [`0057b67`](https://github.com/na2axl/elysiumjs/commit/0057b67df0e3abecab8a9accff6b55a6a64c21df), [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4), [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d), [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4), [`fbcc7da`](https://github.com/na2axl/elysiumjs/commit/fbcc7dad127db29da42e7a4a5c2124966731cd88), [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576), [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b)]:
  - @elysiumjs/core@0.11.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`68a0cdd`](https://github.com/na2axl/elysiumjs/commit/68a0cdd8b2e4a003d6e0af2d78985623cae40428), [`2c49acd`](https://github.com/na2axl/elysiumjs/commit/2c49acd3b552aa43765d70339fa216961499e1b5), [`76ba0ff`](https://github.com/na2axl/elysiumjs/commit/76ba0ff18f3c196cebc2189426328f67cb699f46), [`4ebf029`](https://github.com/na2axl/elysiumjs/commit/4ebf029611e6d753a4f1bfdbe247a75d954d9ded), [`bacce71`](https://github.com/na2axl/elysiumjs/commit/bacce7146f667a1a46bf474dc0344fb0111ae12a)]:
  - @elysiumjs/core@0.10.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`5fef4a7`](https://github.com/na2axl/elysiumjs/commit/5fef4a7199f502fc4fe035299e7670739459a108)]:
  - @elysiumjs/core@0.9.0

## 0.2.0

### Minor Changes

- [`8ac91ab`](https://github.com/na2axl/elysiumjs/commit/8ac91ab676b1119b4eecf0ddb3fd0a3e84017cac) Thanks [@na2axl](https://github.com/na2axl)! - Upgrade dependencies to their latest major versions: wampy 8, zod 4, commander 15, @casl/ability 7, OpenTelemetry SDK 2 (sdk-node 0.300, resources 3), @sentry/bun 11. Generated projects now use TypeScript 7.

  Breaking in `@elysiumjs/mnemosyne-drizzle`: it now requires drizzle-orm 1.0 (release candidate) and generated projects use drizzle-kit 1.0. `ColumnsWithTable` is no longer re-exported. `migration:generate` writes 1.0 migration folders (`<timestamp>_<name>/migration.sql`), and `migration:run` tracks those by folder name while still running flat `*.sql` files. Existing projects can upgrade their migrations folder with `drizzle-kit up`: `migration:run` recognises the moved migrations as already applied and renames their records. The `make:model` stub now generates a `pgTable` and a `DrizzleModel` built from it.

  Breaking in `@elysiumjs/core`: the deprecated `@elysiajs/swagger` plugin is replaced by `@elysiajs/openapi`, and the app option `swagger` is renamed `openapi` (typed `ElysiaOpenAPIConfig | false`). Without a `path`, the docs now live at `/openapi` instead of `/swagger`. The UI options `scalarConfig` and `swaggerOptions` are now `scalar` and `swagger`. Elysia stays on 1.4 (now `^1.4.30`) until Elysia 2 and its OpenAPI plugin are stable.

  Also in `@elysiumjs/core`: the WAMP `onChallenge` callback must return a string (or a promise of one); `null` is no longer accepted. `onError` now receives the error and `onReconnectSuccess` receives wampy's details object. `WampClient` is now wampy's own `Wampy` type. `onOpen` is called by Elysium once the connection is established, since wampy 8 no longer has that callback.

- [`07236b3`](https://github.com/na2axl/elysiumjs/commit/07236b386c2506590d74e8753ce847c1e184b3ee) Thanks [@na2axl](https://github.com/na2axl)! - Introduce the module system. Modules are now the only way to register anything in an Elysium.js app. This is a breaking change with no compatibility layer.

  Breaking changes:

  - `@Module.register()` takes `imports`, `services`, `exports`, `controllers`, `commands`, `jobs`, `prefix` and `env`. Services are private to their module unless exported (or global). The `beforeRegister` and `afterRegister` hooks are replaced by `onInit`, `onServe` and `onDestroy`.
  - Configurable modules are bound with `with()`, for example `HermesModule.with({ level: 'debug' })`. `with()` accepts an object or a function.
  - Decorators only record metadata. Importing a file no longer registers commands, services or event wiring, and the side-effect imports of the packages are removed. List commands, jobs and services in the module that owns them.
  - `@Application.register()` no longer takes `database`, `redis`, `wamp` or `'elysium:hermes'`/`'elysium:cerberus'` keys. Use `DrizzleModule`, `RedisModule`, `WampModule`, `HermesModule` and `CerberusModule`. Package plugins are replaced by modules: add `SentryModule` instead of the `plugin()` function. `plugins` still accepts plain Elysia plugin factories.
  - Constructing an `Application` no longer runs it. Use `await App.start()`; `Application.testing()` boots a module graph for tests. The `styx` binary loads `src/app.ts` (or `index.ts`) and starts the exported application, so a project entry no longer needs to import commands.
  - The job system of core (`Job`, `Worker`, `WorkerPool`, `commandWork`) is removed. `@elysiumjs/heracles` is the only job system: extend its `Job`, list jobs in a module's `jobs`, declare queues with `HeraclesModule.with({ queues })`, and dispatch with `Heracles.dispatch()`.
  - `@elysiumjs/styx` ships `StyxModule`, active in development only. The `migration:generate` and `migration:run` commands move to `DrizzleModule` and are available in production.
  - `@elysiumjs/mnemosyne` ships `MnemosyneModule` for its caches (`redis: false` or `memory: false` opts out). `DrizzleModule` imports it.
  - New modules: `HephaestusModule`, `ArgusModule` (`serviceName` is required), `SentryModule` (needs a `dsn` or `SENTRY_DSN`) and `CerberusModule` (`getSubject` is required).
  - Module and service code throws typed errors (for example `InvalidModuleConfigError`) instead of exiting the process. `Application.run()` prints them and exits; command `run()` methods may still exit, and package plugin factories are unchanged.
  - `Application.register` merges subclass props over the parent's (own props, then own metadata, then parent, then defaults), and concatenates `modules` parent first. Previously defaults and parent values won, so `openapi` could not be enabled.
  - `Heracles.dispatch` starts a stopped queue on first use, so producers no longer start queues. `Queue.start()` is idempotent.
  - `create-elysium` generates apps that use modules, and adds Sentry and Hephaestus to the `modules` list.
  - `@Event.on`/`@Event.once` method listeners on classes in a loaded module's `services` or `controllers` are wired by the kernel and run in their module's context. Jobs, commands and middlewares are not wired, and an instance listener on a class that is not a service throws `EventListenerNotSupportedError`. Listeners on classes not listed in a loaded module no longer fire.
  - New typed errors: `CircularDependencyError` (services that depend on each other, in sync and async resolution), `DuplicateModuleNameError` (two different module classes sharing a name; module scopes and config tokens are name based) and `EventListenerNotSupportedError`.
  - Lazy boot contract: a CLI command initialises only its own module and that module's imports. Sync helpers such as `Database.getConnection()` work when the owning module's `onInit` is synchronous; otherwise they throw `ServiceNotReadyError` naming the module. Use `await Service.resolve()` or set `static boot = true` on the command.

### Patch Changes

- Updated dependencies [[`8ac91ab`](https://github.com/na2axl/elysiumjs/commit/8ac91ab676b1119b4eecf0ddb3fd0a3e84017cac), [`3625883`](https://github.com/na2axl/elysiumjs/commit/3625883dba92f1596e7444ee52f9399d8e9b049f), [`07236b3`](https://github.com/na2axl/elysiumjs/commit/07236b386c2506590d74e8753ce847c1e184b3ee)]:
  - @elysiumjs/core@0.8.0

## 0.1.1

### Patch Changes

- Move plugin entry point to `src/` directory for consistent project structure.
