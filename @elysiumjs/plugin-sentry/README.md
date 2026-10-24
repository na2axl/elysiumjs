# @elysiumjs/plugin-sentry

Enables Sentry error reporting for Elysium applications.

## Installation

```bash
bun add @elysiumjs/plugin-sentry
```

## Usage

Add `SentryModule` to your application:

```ts
import { Application } from '@elysiumjs/core';
import { SentryModule } from '@elysiumjs/plugin-sentry';

@Application.register({
	modules: [
		SentryModule.with({
			serverName: 'my-app',
			dsn: 'https://<key>@sentry.io/<project>'
		})
		// Your other modules
	]
})
class MyApp extends Application {}
```

The `dsn` can also come from the `SENTRY_DSN` environment variable. Boot fails when neither is set.

## Configuration

The module forwards all options to the Sentry initialization method. You can find the full list of options [here](https://docs.sentry.io/platforms/javascript/guides/bun/configuration/options/).

## License

This project is licensed under the terms of the [Apache License 2.0](../../LICENSE).
