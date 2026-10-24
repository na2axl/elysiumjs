# @elysiumjs/hermes

Logging utilities for Elysium.

## Installation

```bash
bun add @elysiumjs/hermes
```

## Usage

Add `HermesModule` to your application. It provides the logger as the global services `HermesLogger` and `logger`.

```ts
import { Application } from '@elysiumjs/core';
import { HermesModule } from '@elysiumjs/hermes';

@Application.register({
	modules: [HermesModule.with({ level: 'debug', format: 'pretty' })]
})
export class App extends Application {}
```

Inject the logger in your services:

```ts
import { Service } from '@elysiumjs/core';
import { HermesLogger } from '@elysiumjs/hermes';

export class UserService {
	public constructor(@Service.inject() private readonly logger: HermesLogger) {}

	public hello() {
		this.logger.info('Hello world!');
	}
}
```

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
