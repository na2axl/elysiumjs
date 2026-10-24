# @elysiumjs/cerberus

Permission and capability management for Elysium.js applications.

## Installation

```bash
bun install @elysiumjs/cerberus
```

## Usage

Import `CerberusModule` in the module that needs it and bind its configuration with `with()`. `getSubject` is required.

```ts
import { Middleware, Module } from '@elysiumjs/core';
import { CerberusMiddleware, CerberusModule } from '@elysiumjs/cerberus';

@Middleware.register(CerberusMiddleware)
@Module.register({
	imports: [
		CerberusModule.with({
			getSubject: async (ctx) => ctx.user ?? null,
			getAbilities: async (ctx) => []
		})
	],
	controllers: []
})
export class AdminModule extends Module {}
```

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
