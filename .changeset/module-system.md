---
'@elysiumjs/core': minor
'@elysiumjs/argus': minor
'@elysiumjs/cerberus': minor
'@elysiumjs/hephaestus': minor
'@elysiumjs/heracles': minor
'@elysiumjs/hermes': minor
'@elysiumjs/mnemosyne': minor
'@elysiumjs/mnemosyne-drizzle': minor
'@elysiumjs/plugin-sentry': minor
'@elysiumjs/styx': minor
'create-elysium': minor
---

Introduce the module system. Modules are now the only way to register anything in an Elysium.js app. This is a breaking change with no compatibility layer.

Breaking changes:

- `@Module.register()` takes `imports`, `services`, `exports`, `controllers`, `commands`, `jobs`, `prefix` and `env`. Services are private to their module unless exported (or global). The `beforeRegister` and `afterRegister` hooks are replaced by `onInit`, `onServe` and `onDestroy`.
- Configurable modules are bound with `with()`, for example `HermesModule.with({ level: 'debug' })`. `with()` accepts an object or a function.
- Decorators only record metadata. Importing a file no longer registers commands, services or event wiring, and the side-effect imports of the packages are removed (only `reflect-metadata` remains). List commands, jobs and services in the module that owns them.
- `@Application.register()` no longer takes `database`, `redis`, `wamp` or `'elysium:hermes'`/`'elysium:cerberus'` keys. Use `DrizzleModule`, `RedisModule`, `WampModule`, `HermesModule` and `CerberusModule`. `plugins` no longer takes package plugins: add `SentryModule` instead of the `plugin()` function.
- Constructing an `Application` no longer runs it. Use `await App.start()`; `Application.testing()` boots a module graph for tests. The `styx` binary loads `src/app.ts` (or `index.ts`) and starts the exported application, so a project entry no longer needs to import commands.
- The job system of core (`Job`, `Worker`, `WorkerPool`, `commandWork`) is removed. `@elysiumjs/heracles` is the only job system: extend its `Job`, list jobs in a module's `jobs`, declare queues with `HeraclesModule.with({ queues })`, and dispatch with `Heracles.dispatch()`.
- `@elysiumjs/styx` ships `StyxModule`, active in development only. The `migration:generate` and `migration:run` commands move to `DrizzleModule` and are available in production.
- `@elysiumjs/mnemosyne` ships `MnemosyneModule` for its caches (`redis: false` or `memory: false` opts out). `DrizzleModule` imports it.
- New modules: `HephaestusModule`, `ArgusModule` (`serviceName` is required), `SentryModule` (needs a `dsn` or `SENTRY_DSN`) and `CerberusModule` (`getSubject` is required).
- Library code throws typed errors (for example `InvalidModuleConfigError`) instead of exiting the process. Only `Application.run()` prints the error and exits.
- `create-elysium` generates apps that use modules, and adds Sentry and Hephaestus to the `modules` list.
