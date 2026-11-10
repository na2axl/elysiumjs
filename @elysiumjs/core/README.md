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

## Request values

Route parameters receive the parts of the request. Their schemas validate the request before the handler runs and document the route in OpenAPI:

```typescript
import { Http, t } from '@elysiumjs/core';

@Http.controller('/users')
export class UserController {
	@Http.patch('/:id', { headers: t.Object({ 'if-match': t.Optional(t.String()) }) })
	public update(
		@Http.param('id') id: string,
		@Http.body(t.Object({ name: t.String() })) body: { name: string },
		@Http.query(t.Object({ notify: t.Optional(t.String()) })) query: { notify?: string },
		@Http.header('x-tenant-id') tenant: string
	) {
		return { id, tenant, ...body };
	}
}
```

- `@Http.param()`, `@Http.body()` and `@Http.query()` give the URL parameter, the body and the query. A value that does not match its schema gets a 422 `VALIDATION_FAILED` problem.
- `@Http.header()` gives a header, a required string unless a schema says otherwise. The `headers` option declares headers the handler does not read itself. Missing or malformed headers get a 400 `BAD_REQUEST` problem.

## Responses and problems

A route declares the schema of its handler's result in `response`, and the problems it answers with in `errors`. Both are documented in OpenAPI.

```typescript
import { DomainError, Http, t } from '@elysiumjs/core';

export class InsufficientFunds extends DomainError.for('INSUFFICIENT_FUNDS', 409, {
	extensions: { missing: t.Integer() }
}) {}

const Wallet = t.Object({ id: t.String(), balance: t.Integer() });

@Http.controller('/wallets')
export class WalletController {
	@Http.post('/:id/pay', { response: Wallet, errors: [InsufficientFunds] })
	public pay(
		@Http.param('id') id: string,
		@Http.body(t.Object({ amount: t.Integer() })) body: { amount: number }
	) {
		if (body.amount > 100)
			return new InsufficientFunds('Top up first.', { extensions: { missing: body.amount - 100 } });
		return { id, balance: 100 - body.amount };
	}
}
```

- A class made with `DomainError.for(code, status, { extensions })` has static `code`, `status` and `schema`. `schema` is the problem details it is sent as, with the code and the status as literals and the extension members; the constructor's `extensions` are typed from them.
- The problems of one status are documented as a union. A schema the route gives for that status in `response` wins over them.
- The framework adds its own: 422 `VALIDATION_FAILED` when the body or the query is validated (400 with `problems.validationStatus`), 400 `BAD_REQUEST` for a body to parse or declared headers, 413 `PAYLOAD_TOO_LARGE` under the body limit, 429 `RATE_LIMITED` with a rate limit, and 500 `INTERNAL_ERROR` on every route.
- A middleware, an interceptor or a validator that answers with problems lists their classes in a static `errors`, and the routes they apply to document them.
- `status` sets the status of a successful response: `@Http.post('/', { status: 201, response: Wallet })` answers 201 and documents `Wallet` under it, and `@Http.del('/:id', { status: 204 })` answers without a body. A handler that sets `ctx.set.status` keeps its own.
- `Http.currentContext()` gives the context of the request being handled to code outside the handler, such as a service, and `undefined` outside a request.

An interceptor that changes the shape of results describes it, so that routes declare the result of their handler. `TransformInterceptor.with(transform, { schema })` passes the success schemas of the routes it wraps through `schema`, in the order results go through the interceptors (route, controller, module, then application). The new schema is the one documented, validated and serialized, and `schema` must leave alone what `transform` leaves alone:

```typescript
const Envelope = TransformInterceptor.with(
	(result) => (isEnveloped(result) ? result : { data: result }),
	{ schema: (schema) => (isEnvelopedSchema(schema) ? schema : t.Object({ data: schema })) }
);
```

## Environment

The app and its modules declare the environment variables they read as TypeBox objects. They are validated when the app runs or is built, with every missing or invalid variable listed, and read with `Env.get()`. A file that declares a schema also augments `AppEnv`, so that `Env.get()` knows each name and its type:

```typescript
// src/env.ts
import type { Env } from '@elysiumjs/core';

import { Secret, t } from '@elysiumjs/core';

export const env = t.Object({
	PORT: t.Number({ default: 3000 }),
	DATABASE_URL: Secret.schema()
});

declare module '@elysiumjs/core' {
	interface AppEnv extends Env.Infer<typeof env> {}
}
```

The app passes the schema as its `env` option, and a module as its `envSchema` option, declared the same way in its own file. Then:

```typescript
Env.get('PORT'); // number
Env.get('DATABASE_URL').reveal(); // string: a Secret prints as [secret] in logs and JSON
Env.get('PROT'); // compile error: not declared
```

- Once any variable is declared, `Env.get()` only accepts declared names. Without any, it takes any name and returns the raw string.
- A variable is typed even when its module is inactive in the current environment: declare the variables of such a module with `t.Optional()`.
- In an app with a schema, reading `Env` before the environment is validated throws `EnvironmentNotReadyError`. Read it in `onInit`, a service, or a `with()` factory.
- The runtime's `env()` stays the raw environment, before validation.

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

### Extension points

When each service of a tag carries options of its own, such as a name and a channel, `Service.extension()` makes the tag, the decorator that registers a service with its options, and the lookups. Names must be unique among the active services: `all()` throws `DuplicateExtensionError` otherwise.

```typescript
type TransportOptions = { name: string; channel: 'email' | 'sms'; devOnly?: boolean };

export const Transports = Service.extension<Transport, TransportOptions>('notifications.transports', {
	env: (options) => (options.devOnly ? Environments.local : undefined)
});

@Transports.register({ name: 'resend', channel: 'email' })
export class ResendTransport implements Transport {}

Transports.all(); // [{ service, options }], in registration order
Transports.find('resend'); // the service, or undefined
Transports.optionsOf(ResendTransport); // { name: 'resend', channel: 'email' }
```

`Transports.tag` is the tag, for `@Service.injectAll()`. `settings.scope` and `settings.global` apply to every service of the extension point.

`Service.get()` answers `null` for a service that is not visible: keep it for optional services, and use `Service.resolve()` for a service the code needs, which throws a precise error when it is missing.

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
