# @elysiumjs/pino

The [pino](https://getpino.io) logger for [Elysium.js](https://github.com/na2axl/elysiumjs): the `pino` driver of the `Logger` port, with readable output in development through pino-pretty.

## Installation

```bash
bun add @elysiumjs/olympus @elysiumjs/pino
```

## Usage

Import the package once, such as in the app's entry: it registers the `pino` driver, and `HermesModule` then uses it for the app's `logger` service.

```ts
import { Application, getLogger } from '@elysiumjs/olympus';
import { HermesModule } from '@elysiumjs/olympus/hermes';

import '@elysiumjs/pino';

@Application.register({
	modules: [HermesModule.with({ name: 'shop', level: 'debug', format: 'pretty' })]
})
export class App extends Application {}

getLogger({ module: 'orders' }).info('Order placed', { orderId: 'o-1' });
```

- `format: 'json'` (the default) writes one JSON object per line; `format: 'pretty'` writes readable lines through pino-pretty, for development.
- Errors logged under `error` are serialized with their type, message and stack.
- The logger flushes its buffered lines when the app shuts down.
- On Cloudflare Workers, where pino's Node.js streams are not available, `HermesModule` keeps the `console` driver unless you set `transport: 'pino'`.

Build one outside the module with the port:

```ts
import { Logger } from '@elysiumjs/olympus';

import '@elysiumjs/pino';

const logger = Logger.for('pino', { name: 'importer', level: 'info' });
```

## License

Apache-2.0
