# @elysiumjs/core

Core functionalities for the Elysium.js framework.

> **NOTE**
>
> This package is part of the Elysium.js framework, which is built exclusively for Bun runtime.

## Installation

```bash
bun install @elysiumjs/core
```

## Features

- Dependency Injection
- HTTP Controllers
- WebSocket support
- WAMP protocol integration
- Command-line interface (`@elysiumjs/styx`), with support for custom commands
- Lifecycle events
- Caching (memory and Redis)
- PostgreSQL database support with Drizzle ORM
- Model classes and repositories for database interactions
- Multi-tenancy support enabled
- OpenAPI documentation (Scalar or Swagger UI)

## Usage

Create a controller class:

```typescript
import { Http } from '@elysiumjs/core';

@Http.controller('/users')
export class UserController {
	@Http.get('/:id')
	public getUser(id: string) {
		return { id };
	}
}
```

Create a module class. A module is the only way to register anything in an Elysium.js app:
controllers, commands, jobs and services are all declared by the module that owns them.

```typescript
import { Module } from '@elysiumjs/core';

import { UserController } from './controllers/http/user.controller';
import { UserService } from './services/user.service';

@Module.register({
	services: [UserService],
	controllers: [UserController]
})
export class MainModule extends Module {}
```

Create an application class. Modules that need configuration are bound to it with `with()`:

```typescript
import { Application, RedisModule } from '@elysiumjs/core';
import { HermesModule } from '@elysiumjs/hermes';

import { MainModule } from './main.module';

@Application.register({
	modules: [
		HermesModule.with({ level: 'debug', format: 'pretty' }),
		RedisModule.with({
			default: 'cache',
			connections: { cache: { url: process.env.REDIS_URL! } }
		}),
		MainModule
	],
	server: {
		name: 'Elysium',
		port: 3000
	}
})
export class App extends Application {}
```

Create an entrypoint file:

```typescript
import { App } from './app';

await App.start();
```

Start the server:

```bash
bun run index.ts serve
```

Or, if using `styx`, run:

```bash
bun styx serve
```

## Services

A service is identified by its class. Give it a name with `@Service.register({ name })` to look it up by that string instead. Class names are never used as identifiers, so services resolve the same way after a bundler renames classes (`bun run check:minified` builds a minified app and checks it).

```typescript
import { Service, ServiceScope } from '@elysiumjs/core';

@Service.register()
export class UserRepository {}

@Service.register({ name: 'mailer' })
export class MailerService {}

@Service.register()
export class UserService {
	constructor(
		@Service.inject(UserRepository) private readonly users: UserRepository,
		@Service.inject('mailer') private readonly mailer: MailerService
	) {}
}
```

`@Service.inject()` without an argument injects the class of the parameter type, read from `emitDecoratorMetadata`. Pass the class or the name when the type is an interface or is missing; Elysium throws at declaration time when it cannot tell which service to inject.

A service has one of three scopes:

| Scope                    | Instances                                                   |
| ------------------------ | ----------------------------------------------------------- |
| `ServiceScope.SINGLETON` | One for the app (the default)                               |
| `ServiceScope.FACTORY`   | A new one each time the service is resolved                 |
| `ServiceScope.REQUEST`   | One per HTTP request, shared by its middlewares and handler |

A request-scoped service resolves only inside a request: resolving it elsewhere throws `OutsideRequestScopeError`. Code outside a route, such as a job or a test, opens a scope with `Service.runInRequestScope(fn)`; every request-scoped service resolved inside `fn`, including after an `await`, is shared for that run. A singleton, or a controller with the default server scope, cannot depend on a request-scoped service, since it would keep the first request's instance: Elysium throws `ScopeMismatchError`. Use a request-scoped controller (`scope: HttpControllerScope.REQUEST`), or inject the service in the route handler's parameters.

### Tags

A tag groups services: each service registered with it is injected together with the others. Use it for extension points that modules contribute to, such as health checks or permission rules.

```typescript
import { Service } from '@elysiumjs/core';

export const HealthChecks = Service.tag<HealthCheck>('health.checks');

@Service.register({ tags: [HealthChecks] })
export class DatabaseCheck implements HealthCheck {}

@Service.register()
export class Health {
	constructor(@Service.injectAll(HealthChecks) private readonly checks: HealthCheck[]) {}
}
```

`@Service.injectAll(tag)` and `Service.getAll(tag)` give the tagged services in registration order, and an empty array when there is none; `Service.resolveAll(tag)` also waits for their `onInit`. A module receives the tagged services of every module of the application, including the ones it does not import, while getting one of them by its class still follows the module's imports and exports. Scopes apply to each tagged service as they do to `@Service.inject()`.

## Lazy boot

A CLI command boots lazily: running `app:cmd` initialises the command's own module and the modules it imports, not the whole graph. `help <cmd>` is always lazy, even for commands with `static boot = true`.

- **Sync helpers are safe** (`Service.get()`, `Database.getConnection()`, `Redis.getConnection()`, ...) when the module that owns the service initialises synchronously. Elysium then initialises that module on the spot, even if the command does not import it.
- **Use `await Service.resolve(...)`** when the owning module has an asynchronous `onInit`. A sync `get` then throws `ServiceNotReadyError`, which names the module.
- **Use `static boot = true`** on a command that needs every module initialised before it runs (workers, servers). It initialises every module and builds every service first.
- Service factories receive a synchronous `get`; it may only read services whose owning modules initialise synchronously, otherwise it throws `ServiceNotReadyError`.

## Runtimes

Core never calls a host API directly. Environment variables, timers, the HTTP server, process exit and shutdown signals come from a runtime, which ships as its own package:

| Package                      | Exports                             | Notes                                                                                                     |
| ---------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@elysiumjs/runtime-bun`     | `runtime`                           | `Bun.env`, `Bun.sleep`, `listen`, process exit and signals                                                |
| `@elysiumjs/runtime-node`    | `runtime`                           | Same on Node.js; set `server: { adapter: node() }` from `@elysiajs/node`                                  |
| `@elysiumjs/runtime-workers` | `runtime`, `createRuntime({ env })` | Env from `process.env` (`nodejs_compat`) or `env`; no `serve` (export the app's `fetch`), exit or signals |

Each package exports `runtime` (rename it at import if you like). Pass it to the application, or call `Runtime.use()` before anything needs it:

```ts
import { Application } from '@elysiumjs/core';
import { runtime } from '@elysiumjs/runtime-bun';

@Application.register({ runtime, modules: [] })
class App extends Application {}
```

Without a runtime, `Runtime.get()` throws `RuntimeNotConfiguredError`; only the environment name falls back to `development`. `bun run check:runtime` bundles core, fails if it touches the `Bun` global, and boots an application from the bundle under Node.js.

## Migrating from the pre-module API

- The `database`, `redis`, `wamp` and `elysium:hermes` keys of `@Application.register()` are gone. Add `DrizzleModule.with()`, `RedisModule.with()`, `WampModule.with()` and `HermesModule.with()` to `modules` instead.
- `Redis` and `RedisModule` moved to `@elysiumjs/redis`.
- An application needs a runtime: add `runtime` from `@elysiumjs/runtime-bun` to `@Application.register()`.
- `plugins` no longer takes package plugins. Add the package's module (for example `SentryModule`) to `modules`.
- Importing a file no longer registers its commands or services. List commands in a module's `commands`, services in `services`, and jobs in `jobs`.
- `new App()` is replaced by `await App.start()`. `Application.testing()` boots a module graph for tests.
- The `beforeRegister` and `afterRegister` module hooks are replaced by `onInit`, `onServe` and `onDestroy`.
- Jobs and workers moved to `@elysiumjs/heracles`; `WorkerPool` is removed.

## Documentation

TODO

## Contributing

This project is built primarily to meet requirements for internal projects at [Workbud Technologies Inc.](https://www.workbud.com)

Feel free to open issues for any bugs or questions you may have. Pull requests are also welcome, but they will be reviewed to ensure they align with our internal project's goals and standards.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](https://github.com/na2axl/elysiumjs/blob/main/LICENSE) file for more information.
