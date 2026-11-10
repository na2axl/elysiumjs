# create-elysium

## 0.3.5

### Patch Changes

- Updated dependencies [[`9bd29cb`](https://github.com/na2axl/elysiumjs/commit/9bd29cbd10131e4465505de91c78e7f39d242e71)]:
  - @elysiumjs/styx@0.14.0

## 0.3.4

### Patch Changes

- Updated dependencies [[`1c0372f`](https://github.com/na2axl/elysiumjs/commit/1c0372fed957249bc504b684399e8295514b5075)]:
  - @elysiumjs/styx@0.13.0

## 0.3.3

### Patch Changes

- Updated dependencies [[`af05b49`](https://github.com/na2axl/elysiumjs/commit/af05b498a2c4d4dafda44f361fe68c490f49a8c7), [`af05b49`](https://github.com/na2axl/elysiumjs/commit/af05b498a2c4d4dafda44f361fe68c490f49a8c7)]:
  - @elysiumjs/styx@0.12.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`ec07c41`](https://github.com/na2axl/elysiumjs/commit/ec07c410c417053df4e284d8ddc6d2c4da4e42ec)]:
  - @elysiumjs/styx@0.11.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`762661e`](https://github.com/na2axl/elysiumjs/commit/762661e362444f431ea84576494322a9a7a81539)]:
  - @elysiumjs/styx@0.10.0

## 0.3.0

### Minor Changes

- [#9](https://github.com/na2axl/elysiumjs/pull/9) [`8a30cc3`](https://github.com/na2axl/elysiumjs/commit/8a30cc35a82438fe9da08fcea91ef9b46f3430f1) Thanks [@na2axl](https://github.com/na2axl)! - Styx is a global command: install it with `bun add -g @elysiumjs/styx`, then run `styx create my-app` to start a project (template, runtime, modules, plugins and features, from prompts or options). Inside a project, the global `styx` hands every command to the project's own Styx. The code generators (`make:*`, `module:*`) run without starting the app, and new projects install Styx as a dev dependency.

  When a project installs `@elysiumjs/hephaestus` as a dev dependency, Styx provides its commands. Standalone `styx` executables are built with Hephaestus (`bun run build:bin`), with the stubs and templates embedded. The Hephaestus asset embedder includes dotfiles.

  `create-elysium` runs `styx create`; the project templates live in `@elysiumjs/styx`.

### Patch Changes

- [#7](https://github.com/na2axl/elysiumjs/pull/7) [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148) Thanks [@na2axl](https://github.com/na2axl)! - Elysium runs on Elysia 2 (`elysia@^2.0.0-rc.1`), with TypeBox 1 (`typebox`), `@elysia/openapi` and `@elysia/opentelemetry`.

  Breaking:

  - `TSchema` and `Static` are re-exported from `typebox` instead of `@sinclair/typebox`; `Value` comes from `typebox/value` and `Value.Errors()` returns an array.
  - `Application.onError()` receives a `ServerError` (exported from core). Elysia now names its errors in kebab case; the default error response keeps the upper snake case names (`VALIDATION`, `NOT_FOUND`, `UNKNOWN` for other errors).
  - `AppHttpContext` is a plain interface with `decorator`, `store` and `derive` records (Elysia 2 renamed `resolve` to `derive`).
  - Websocket controllers install Elysia's `websocket()` capability themselves.

  A module or controller `onRequest` middleware that answers now stops the request: Elysia 2 ignores values returned from a transform hook, so the response is thrown as a status and sent as is, without going through `onError`.

  `mnemosyne` builds date columns with `t.Codec` (TypeBox 1 dropped `Transform`). `argus` traces every route of the app it is installed on and ends each span once, keeping the error status when the request failed.

- [#5](https://github.com/na2axl/elysiumjs/pull/5) [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82) Thanks [@na2axl](https://github.com/na2axl)! - Core runs outside Bun. Environment variables, timers, the HTTP server, process exit and shutdown signals now come from a `Runtime` set with the new `runtime` option of `@Application.register()` or with `Runtime.use()`. Runtimes ship as packages, each exporting `runtime`: `@elysiumjs/runtime-bun`, `@elysiumjs/runtime-node` and `@elysiumjs/runtime-workers` (which also exports `createRuntime({ env })`).

  Breaking: an application needs a runtime (add `runtime` from `@elysiumjs/runtime-bun`), and `Redis` and `RedisModule` moved from core to the new `@elysiumjs/redis` package, which also accepts a `client` factory for runtimes without `Bun.RedisClient`.

  Console colours are plain ANSI codes instead of `Bun.color`, `node:readline` is loaded only when a prompt runs, and core's dist is built for the `node` target so `node:` imports keep their prefix. `check:runtime` scripts in core and runtime-workers fail when their bundles touch the `Bun` global.

  `create-elysium` gets a runtime step: it installs the chosen runtime package and sets it in the generated app. Bun is selectable today; Node.js and Cloudflare Workers are listed as coming later.

- Updated dependencies [[`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5), [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64), [`0057b67`](https://github.com/na2axl/elysiumjs/commit/0057b67df0e3abecab8a9accff6b55a6a64c21df), [`8a30cc3`](https://github.com/na2axl/elysiumjs/commit/8a30cc35a82438fe9da08fcea91ef9b46f3430f1), [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d), [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4), [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576), [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b)]:
  - @elysiumjs/styx@0.9.0

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

- [`3625883`](https://github.com/na2axl/elysiumjs/commit/3625883dba92f1596e7444ee52f9399d8e9b049f) Thanks [@na2axl](https://github.com/na2axl)! - Drop the `reflect-metadata` dependency. Decorator metadata now lives in a small store in `@elysiumjs/core`, exported as `Metadata` (`define`, `get`, `getOwn`, `has`). Use it instead of `Reflect.defineMetadata` and `Reflect.getMetadata` to read or write Elysium metadata.

  Apps no longer need `import 'reflect-metadata'` in their entrypoint, and generated projects leave it out. Keep `emitDecoratorMetadata` enabled: `@Service.inject()` and `@Command.arg()` still infer types from it. An app that loads `reflect-metadata` for another library keeps working; Elysium also reads the types stored there.

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

## 0.1.9

### Patch Changes

- Update project templates with shared modules, validators, and improved scaffolding utilities.
- Add type declaration files for templates.
