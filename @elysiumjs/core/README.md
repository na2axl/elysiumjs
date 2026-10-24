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
- Event system
- Caching (memory and Redis)
- PostgreSQL database support with Drizzle ORM
- Model classes and repositories for database interactions
- Multi-tenancy support enabled
- Swagger documentation

## Usage

Create a controller class:

```typescript
import { Http } from '@elysiumjs/core';

@Http.controller({ path: '/users' })
export class UserController {
	@Http.get({ path: '/:id' })
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
import 'reflect-metadata'; // <- IMPORTANT TO ADD THIS LINE IN THE ENTRYPOINT FILE

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

## Migrating from the pre-module API

- The `database`, `redis`, `wamp` and `elysium:hermes` keys of `@Application.register()` are gone. Add `DrizzleModule.with()`, `RedisModule.with()`, `WampModule.with()` and `HermesModule.with()` to `modules` instead.
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

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](https://github.com/workbud/elysium/blob/main/LICENSE) file for more information.
