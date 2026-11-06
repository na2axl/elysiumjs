# @elysiumjs/runtime-node

Node.js runtime for [Elysium.js](https://github.com/na2axl/elysiumjs).

## Installation

```bash
bun add @elysiumjs/runtime-node
```

## Usage

```ts
import { Application } from '@elysiumjs/core';
import { runtime } from '@elysiumjs/runtime-node';

@Application.register({ runtime, modules: [] })
class App extends Application {}
```

The package exports `runtime`; rename it at import if you like: `import { runtime as nodeRuntime } from '@elysiumjs/runtime-node'`.

Uses `process.env`, timers, `process.exit` and `SIGINT`/`SIGTERM` handlers. It serves the app on a `node:http` server through `serveNode`, a bridge to Elysia's `fetch` handler (no Elysia 2 Node adapter is released yet), so no adapter needs to be configured.

## License

Apache-2.0
