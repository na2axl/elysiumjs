# Module System Design

**Date:** 2026-10-24
**Status:** Draft — awaiting approval
**Scope:** `@elysiumjs/core` and every package under `@elysiumjs/*`, plus `example/` and the `create-elysium` templates.

## 1. Intent

Today, much of what an Elysium app can do depends on which files happen to be imported:

- `@Command.register()` puts the command class into the global service container (`elysium.command.*`) at import time. `Application.getCommands()` discovers commands with `Service.keys('elysium.command.*')`. Packages (`styx`, `heracles`, `hephaestus`) do `import './commands'` from their entry point. The example app imports command files by path in `src/app.ts`.
- `Job.register()` (core and heracles) calls `Service.instance` at import time.
- `@Service.register()` with the default singleton scope **constructs the instance at decoration time**. That happens before `initEnv()` and before app config exists.
- Packages initialise themselves with side effects: `mnemosyne-drizzle/src/init.ts` and `mnemosyne/src/keyv-redis.ts` hook `Event.once('elysium:app:launched')`, and `hermes/src/index.ts` calls `Service.registerLazy` at import. They read untyped config keys (`'elysium:mnemosyne' as any`, `'elysium:hermes'`, `'elysium:cerberus'`) via `Application.getConfig`.
- `Module` only mounts `controllers` and a `prefix`. `ModuleProps.jobs` is declared but never read. Modules are only processed by `serve`. The CLI and `work` never load them.

Consequences: importing a package silently adds commands; the first of two same-named commands wins without warning; services can't safely read env in their constructor; and **database connections are never registered for CLI commands**. That last one happens because `elysium:app:launched` fires after `run()` resolves, and `commandExec` calls `process.exit` first. For `serve`, the connections are registered only after `listen()`.

**The intent:** modules become the *only* way anything gets into an app. Decorators record metadata and nothing else. An external package exposes a module, and the app opts in by importing it. Nothing an app can use comes from a file merely being imported.

## 2. Goals

1. Every controller, command, job, middleware and service an app uses is reachable from the app's module graph, and nothing else is.
2. Decorators (`@Service.register`, `@Command.register`, `@Job.register`, `@Http.controller`, …) have no side effects beyond `Reflect.defineMetadata`.
3. Service visibility is scoped by module (`imports`/`exports`), with an explicit opt-in for global services.
4. Package configuration is typed and passed through `Module.with(config)`; untyped `'elysium:*'` keys on `AppProps` are removed.
5. CLI commands start only what they need by default; `serve` and long-running commands that opt in (`boot = true`, e.g. the heracles worker) start everything and fail fast.
6. Proper lifecycle: services and modules can initialise asynchronously and are torn down on shutdown.
7. Modules can be restricted to environments (e.g. dev-only, test-only) while being imported like any other module.

## 3. Non-goals

- Backward compatibility. This is a **clean break** (all packages are 0.x). No deprecation shims, no warnings for the old style.
- The other database fixes from the review: cross-instance cache invalidation in `DrizzleDatabaseCache`, keying the transaction context by connection, and moving the `transactional` wrapper out of `core/src/http.ts`. These are separate follow-up work. The one exception is that this spec must remove the `init.ts` timing bug, because modules replace `init.ts`.
- Dependency upgrades (Elysia 2, Drizzle 1.0, etc.).
- Request-scoped DI or per-request containers beyond what `ServiceScope.FACTORY` already gives.

## 4. Anti-goals (would make this a failure even if it works)

- Copying NestJS naming wholesale (`providers`, `forRoot`, `forFeature`, `@Injectable`). Use Elysium's own vocabulary: `services`, `with()`, `@Service.register()`.
- Any path where importing a file changes what the app can do.
- A dev- or test-only module (e.g. Styx) that can be active in production, or a production module that silently depends on one.
- `process.exit()` inside library code paths introduced by this work. Throw typed errors; only the CLI/app entry decides to exit.

## 5. Design

### 5.1 Module declaration

```ts
@Module.register({
	imports: [DrizzleModule, HermesModule],      // modules (or configured modules) whose exports this module can see
	services: [BillingService, InvoiceRepository, { name: 'billing.client', factory: (config) => new StripeClient(config.key) }],
	exports: [BillingService],                   // or `true` to export all of this module's services
	controllers: [InvoiceController],
	commands: [InvoiceSyncCommand],
	jobs: [SendInvoiceJob],
	prefix: '/billing',
	env: ['development', 'test']                 // optional; omitted = all environments
})
export class BillingModule extends Module {}
```

`ModuleProps`:

| Field | Type | Meaning |
|---|---|---|
| `imports` | `(ModuleClass \| ConfiguredModule)[]` | Modules whose exported services become visible to this module. |
| `services` | `(ServiceClass \| ServiceFactoryDefinition)[]` | Services this module registers. |
| `exports` | `(ServiceClass \| string \| ModuleClass)[] \| true` | What importers can see. `true` = all of this module's own services. A `ModuleClass` entry re-exports that imported module's exports. Default: nothing. |
| `controllers` | `Class[]` | HTTP / WebSocket / WAMP controllers, mounted under `prefix` in `serve`. |
| `commands` | `CommandClass[]` | CLI commands contributed by this module. |
| `jobs` | `Class[]` | Jobs contributed by this module. Core only stores them as metadata; heracles reads them from the module graph (5.9). |
| `prefix` | `Route` | As today. |
| `env` | `string[]` | Environments in which this module loads (see 5.7). |

Middlewares stay as today (`@Middleware.register(...)` on the module class or controller); middleware classes are constructed through the module's container so they can inject the module's visible services.

The `Module` base class keeps being a class with lifecycle hooks; `beforeRegister`/`afterRegister` are replaced by `onInit()` / `onDestroy()` (5.6).

*(My call.)* `Module` also gets `onServe(app: Elysia): void | Promise<void>`, called only in `serve` with the **root** Elysia instance. It runs for each loaded module in dependency order (imports first), after the app-level `swagger`/`plugins` and before any controllers are mounted. This is how modules such as `SentryModule` and `ArgusModule` install root-level plugins and `as: 'global'` hooks. Ordering among modules with no import relationship follows their order in the app's `modules` list, so a module that must come first (Sentry) is listed first.

### 5.2 Application as root module

`@Application.register({ modules, server, debug, env, swagger, plugins, middlewares? })`. `modules` acts as the root module's `imports`. Controllers, commands, jobs and services all come from modules; the app class itself contributes none.

Removed from `AppProps`: `redis`, `wamp`, the index signature `[key: string]: any`, and all `'elysium:*'` keys. `Application.getConfig()` is removed or narrowed to the remaining typed keys. Redis and WAMP move to core modules (5.8).

`swagger` and `plugins` (raw Elysia plugins) stay on `AppProps` for now.

### 5.3 Services

Declaring a service:

```ts
@Service.register({ name: 'billing', scope: ServiceScope.SINGLETON, global: false })
export class BillingService {
	public constructor(
		@Service.inject('billing.client') private readonly client: StripeClient,
		@Service.inject() private readonly invoices: InvoiceRepository
	) {}
}
```

- `@Service.register()` only writes metadata (`name`, `scope`, `global`). It is optional. A plain class listed in `services` registers under its class name, `SINGLETON`, non-global.
- Factory entries (`{ name, factory, scope?, global? }`) receive the owning module's resolved config (5.5) plus a resolver for visible services.
- `@Service.inject()` is unchanged in syntax. Resolution happens against the *requesting module's* visibility (5.4).
- Services are registered as lazy entries when their module is registered; singletons are constructed on first resolution. This reuses the idea behind today's `Service.registerLazy`.
- A service may define `onInit(): Promise<void> | void`, awaited right after construction (before it is handed to whoever asked), and `onDestroy(): Promise<void> | void`, called on shutdown.

### 5.4 Visibility rules

A module M can resolve:
1. its own `services`;
2. services exported by modules in M's `imports` (including re-exports);
3. any `global` service whose owning module is loaded.

Rules:
- Visibility is **not transitive**. If A imports B and B imports C, A does not see C's services unless B re-exports C (`exports: [C]`) or A imports C.
- A service marked `global: true` is visible everywhere once its module is loaded. It does not need to be exported. It must still be listed in some loaded module's `services`; `global` only widens visibility.
- Framework infrastructure services are global: the application instance (`elysium.app`), Redis connections, WAMP connections, database connections (`db.connection.*`), and the logger (`logger`, `HermesLogger`).
- Name collisions: two non-global services with the same name in different modules are fine (each module sees its own). Two global services with the same name → startup error naming both modules.
- Injecting a service that isn't visible → error at resolution time naming the requesting class, its module, the requested service, and (if found elsewhere) the module that owns it and the fix ("import X" / "add it to X's exports").
**Module context (decided: tracked at runtime).** The framework keeps track of which module's code is running, using an `AsyncLocalStorage` alongside the existing `Application.context`. Static `Service.get()` / `Service.make()` resolve against that module's visibility. Existing code such as `Service.get<UserService>('user.service')` in a controller method therefore keeps working.
- The framework enters a module's context whenever it calls into code owned by that module:
  - constructing its services, controllers, middlewares, commands and jobs;
  - running each HTTP/WS/WAMP handler, and its middlewares and route-parameter injection (`core/src/http.ts`, `websocket.ts`, `wamp.ts`, `middleware.ts`);
  - running a command's `init`/`run`/`help`;
  - running a job's `execute`;
  - running the module's `onInit`/`onDestroy` and any service `onInit`/`onDestroy`.
- Static `Service.get(name)` called outside any module context, e.g. in package-level helpers like `Database.getConnection()`, resolves **global services only**.
- A service resolved through a module context is constructed in its **owning** module's context, so its own injections follow the owner's visibility, not the requester's.

### 5.5 Configuring modules: `with()`

```ts
@Application.register({
	modules: [
		HermesModule.with({ level: 'debug', format: 'pretty' }),
		DrizzleModule.with(() => ({
			default: 'main',
			connections: { main: { connection: Env.get('DATABASE_URL') } }
		})),
		BillingModule
	]
})
export class App extends Application {}
```

- A configurable module exposes `static with(config: TConfig | (() => TConfig | Promise<TConfig>)): ConfiguredModule<TConfig>`. Core provides a helper/base so package authors write only the config type and defaults.
- The function form is evaluated at startup, **after** env validation. The object form is evaluated at import time (plain `process.env` only).
- Importing a configurable module without `with()` uses its defaults. If a required setting has no default, startup fails naming the module and the missing key.
- Config is available inside the module as a service: `@Service.inject(HermesModule.config)` (a module-private token), and as the first argument of the module's `services` factories.
- A module is instantiated once per app, however many modules import it. Plain (unconfigured) imports reuse the configured instance.
- *(My call.)* Packages may configure the modules they depend on (e.g. `DrizzleModule` importing `MnemosyneModule.with(...)`). Precedence when the same module is configured in more than one place:
  1. **The closest `with()` to the root wins.** A `with()` in the app's `modules` overrides any `with()` inside package modules, so packages provide defaults and the app overrides them.
  2. **Same depth, different config → startup error** naming both import sites. Object-form configs are compared by deep equality in Phase 1. Function-form configs are compared after evaluation, at the start of Phase 3, so `list`/`help` won't report those conflicts.

### 5.6 Bootstrapping and lifecycle

**Phase 1: graph (always, all modes).** Walk the module graph from the root by reading metadata only. Deduplicate modules, apply `env` filtering (5.7), and detect cycles (error with the cycle path). Validate global-name collisions, conflicting `with()` configs, and command name collisions (two commands with the same `command` name → error naming both modules). No service is constructed. This is enough for `styx list`, `styx help <cmd>` and the default describe screen.

**Phase 2: registration.** Register each module's services as lazy entries in a per-module scope, with globals in the shared global scope.

**Phase 3: mode-specific.**

| Mode | Behaviour |
|---|---|
| `serve` | Eager: run every loaded module's `onInit()` in dependency order (imports first), construct every singleton service (running its `onInit()`), then mount controllers and `listen()`. Any failure aborts boot. |
| CLI command, default | Lazy, on demand: run `onInit()` for the command's owning module, then construct the command in that module's context. Whenever a service is resolved, its owning module (and that module's imports) is initialised first if it isn't already. A command that touches a model therefore initialises `DrizzleModule` (connections, tenancy strategy) without importing it, and unrelated modules are never touched. *(My call.)* |
| CLI command with `static boot = true` | Same eager boot as `serve` (without mounting/listening), then run the command. Heracles' `work` command sets `boot = true`. *(My call.)* |
| `list` / describe | Phase 1 only. |
| `help <cmd>` | Same as a default CLI command: constructs the command lazily and calls its instance `help()`. No API change for command authors. *(My call.)* |

`Command` gains `public static readonly boot: boolean = false` alongside `command`, `description` and `dev`.

**Shutdown.** On normal completion of a CLI command, on SIGINT/SIGTERM, and on `Elysia.stop()`: call `onDestroy()` on every *constructed* service in reverse construction order, then `onDestroy()` on every initialised module in reverse init order, then exit. Errors in one `onDestroy` are logged and don't stop the others.

`elysium:app:launched` and the other events keep firing, but no package may rely on them for registration.

### 5.7 Environment-specific modules

- `@Module.register({ env: ['development'] })` restricts where the module loads. Omitted = all environments.
- The current environment is `NODE_ENV`; unset counts as `development`. This matches today's `cmd.dev` filter in `Application.getCommands()`.
- Outside its environments, a module is skipped entirely: its services, commands, jobs and controllers aren't registered, and its `imports` aren't followed on its behalf (they still load if something else imports them).
- If a loaded module imports a skipped module and something resolves a service that only the skipped module exports → error naming both modules and the current environment. In `serve` and `boot = true` commands this surfaces at boot (eager construction); in lazy CLI mode at resolution.
- The per-command `static dev` flag is kept for individual dev-only commands inside modules that otherwise load everywhere.
- Documented constraint: env filtering happens at startup, not at import. A module's file and its top-level imports load in every environment, so env-restricted modules must not statically import packages that are only installed as devDependencies. Load those lazily inside services. (Styx is fine: the templates list it under `dependencies`, and it calls `drizzle-kit` via `bunx`.)

### 5.8 What each package ships

| Package | Module | Contents |
|---|---|---|
| core | `RedisModule.with({ default, connections })` | Global Redis connection services. Replaces `AppProps.redis` and the constructor wiring in `app.ts`. |
| core | `WampModule.with({ default, connections })` | Global WAMP clients. Replaces `AppProps.wamp`. |
| styx | `StyxModule` (`env: ['development']`) | `make:*`, `module:*` commands. The `styx` bin loads `${project}/src/app` and runs it; it no longer subclasses the app or imports commands. Migration commands move out (below). |
| mnemosyne | `MnemosyneModule.with({ cache })` | Cache stores (`Cache.redis`/`Cache.memory` backends) as services. Replaces the `keyv-redis.ts` launch hook. |
| mnemosyne-drizzle | `DrizzleModule.with({ default, connections, tenancy })` | Imports `MnemosyneModule`. Global connections `db.connection.<name>` and `db.connection.default`, plus the tenancy strategy. Its `onDestroy` closes pools. Replaces `src/init.ts`. Owns `migration:generate` and `migration:run`, moved from styx; `migration:run` is not `dev`, so it can run in production. |
| heracles | `HeraclesModule.with({ transports, queues })` | Queue/worker services and its commands (`clean`, `list`, `work`). Jobs come from the `jobs` lists of loaded modules. Remove `import './commands'` from the entry. |
| hephaestus | `HephaestusModule` | `build`, `docker`, `embed` commands. Remove `import './commands'`. |
| hermes | `HermesModule.with({ level, format, transports })` | Global `logger` / `HermesLogger` service. Replaces `registerLazy` at import and the `'elysium:hermes'` key. |
| cerberus | `CerberusModule.with(config)` | Config service and `CerberusMiddleware`. Replaces the `'elysium:cerberus'` key. |
| argus | `ArgusModule.with(config)` | Wraps its existing tracing setup. |
| plugin-sentry | `SentryModule.with(options)` | Wraps the existing `plugin()` Elysia plugin. |

Each package's entry point must have **no** side-effect imports (`import './commands'`, `import './init'`) after this work. Exception: `reflect-metadata`.

### 5.9 Jobs

**Decided: core's job system is removed. Heracles is the only job system.**
- **Remove from core:** `core/src/job.ts`, `core/src/worker.ts` (`Worker`, `WorkerPool`, `QueueOptions`), their exports in `core/src/index.ts`, `Symbols.job` in `core/src/utils.ts`, `core/tests/job.test.ts`, and the built-in `work` action in `Application.run()` (`commandWork`).
- **Heracles is already independent** of these, so no change is needed there because of the removal.
- **`example/` moves to heracles:** `email.job.ts`, `failing.job.ts`, the dispatch in `user.controller.ts`, and the `WorkerPool` setup in `App.onStart`.

*(My calls, following from the tracked module context:)*
- **Reading jobs:** core keeps `jobs` on `ModuleProps` as plain metadata and exposes a read-only way to query the loaded graph, e.g. "all `jobs` of loaded modules, with their owning module". `HeraclesModule` uses it at init. This is the only coupling.
- **Running jobs:** jobs keep being constructed with `new JobClass(...dispatchArgs)`. The heracles worker constructs and executes them inside the owning module's context, so `Service.get()` within the job sees that module's services. `@Service.inject` on `execute()` parameters may be supported if it's cheap; that's the builder's call.
- **Unique names:** job names must be unique across the graph. `HeraclesModule` validates this at init and fails naming both modules.
- **Which process needs the job:** a job must be in the graph of the process that **executes** it. The dispatching process only needs the class to call dispatch; it does not need the job registered.

### 5.10 The `styx` binary *(my call)*

Constructing an `Application` no longer runs it. Today the constructor calls `run()` (`core/src/app.ts:238`). Instead, construction is separated from running: `new App().run()` or a static `App.start()`. The project entry and the `styx` bin both call it, so the bin can load the user's app (resolved from the project's entry, not a hardcoded `src/app`) without subclassing it.

### 5.11 Error types

Introduce typed errors in core (exact names are the builder's call): module cycle, duplicate global service, duplicate command, conflicting module config, missing required config, service not visible, unknown module (class without `@Module.register`). Library code throws them; `Application` catches at the entry, prints a readable message, and exits non-zero. Existing `process.exit` calls in `module.ts`, `service.ts` and `mnemosyne/src/database.ts` that sit on paths touched by this work are converted.

## 6. Migration of in-repo consumers

- `example/` rewritten in the new style: commands listed in the hero module, `HermesModule.with(...)`, `DrizzleModule.with(...)`, `RedisModule.with(...)`, `WampModule.with(...)`, `StyxModule` imported plainly. The current `database:` key in `example/src/app.ts` is already stale and goes away.
- `create-elysium` templates (`template-single`, `template-multi`) updated the same way.
- Styx generators (`make:command`, `make:job`, `make:service`, `make:controller`, `module:new`) must add the generated class to the target module's `commands`/`jobs`/`services`/`controllers` list, or at minimum print the exact line to add. *(Builder's call which.)*
- READMEs of each package updated to show the module import.
- The uncommitted `mnemosyne-drizzle/src/init.ts` is not committed in its current form; it is superseded by `DrizzleModule`.

## 7. Testing

- Unit tests in core for: graph walking, dedupe, cycle detection, env filtering, visibility (own / imported / exported / re-exported / global / non-transitive), `exports: true`, collisions, `with()` (object, function, defaults, missing required, conflicting configs), lazy vs eager boot, `boot = true`, `onInit`/`onDestroy` ordering, shutdown on error.
- Test helper: a way to boot a module graph in tests without starting an HTTP server, with overridable services (for example `Application.testing({ modules, overrides })`). The exact API is the builder's call. Modules with `env: ['test']` must work with it.
- Per-package tests updated so they register through their module, not by import.
- The example app's existing flows (serve, a custom command, a job) work end to end.
- A regression test that `migration:run` resolves a database connection under the CLI.

## 8. Constraints

- Runtime is Bun; TypeScript with `experimentalDecorators` + `emitDecoratorMetadata` and `reflect-metadata`, as today.
- Keep existing idioms: namespace-style APIs (`Service.*`, `Command.*`), static decorator factories named `register`, metadata under `Symbols.*` in `core/src/utils.ts`, the license header, and JSDoc with `@author` on public APIs.
- Release via changesets as a breaking minor bump on every affected 0.x package.

## 9. Left to the builder

- Internal container structure (one registry with scope tags vs. per-module child containers).
- Exact names of error classes, the `with()` helper/base, the config injection token, and the test helper.
- Whether `Service.make()` stays public and how it behaves outside a module context.
- Ordering among sibling modules with no import relationship (any deterministic order is fine).
- Whether Styx generators edit module files automatically or print instructions.
