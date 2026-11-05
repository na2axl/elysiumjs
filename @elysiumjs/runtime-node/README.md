# @elysiumjs/runtime-node

Node.js runtime for [Elysium.js](https://github.com/na2axl/elysiumjs).

## Installation

```bash
bun add @elysiumjs/runtime-node
```

## Usage

```ts
import { Application } from '@elysiumjs/core';
import { nodeRuntime } from '@elysiumjs/runtime-node';

@Application.register({ runtime: nodeRuntime, modules: [] })
class App extends Application {}
```

Uses `process.env`, timers, Elysia's `listen`, `process.exit` and `SIGINT`/`SIGTERM` handlers. Elysia needs its Node adapter: set `server: { adapter: node() }` from `@elysiajs/node`.

## License

Apache-2.0
