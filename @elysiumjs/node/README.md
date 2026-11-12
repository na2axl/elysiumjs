# @elysiumjs/node

Node.js runtime for [Elysium.js](https://github.com/na2axl/elysiumjs).

## Installation

```bash
bun add @elysiumjs/olympus @elysiumjs/node
```

## Usage

```ts
import { runtime } from '@elysiumjs/node';
import { Application } from '@elysiumjs/olympus';

@Application.register({ runtime, modules: [] })
class App extends Application {}
```

The package exports `runtime`; rename it at import if you like: `import { runtime as nodeRuntime } from '@elysiumjs/node'`.

Uses `process.env`, timers, `process.exit` and `SIGINT`/`SIGTERM` handlers. It serves the app on a `node:http` server through `serveNode`, a bridge to Elysia's `fetch` handler (no Elysia 2 Node adapter is released yet), so no adapter needs to be configured.

## License

Apache-2.0
