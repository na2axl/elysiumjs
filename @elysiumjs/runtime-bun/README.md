# @elysiumjs/runtime-bun

Bun runtime for [Elysium.js](https://github.com/na2axl/elysiumjs).

## Installation

```bash
bun add @elysiumjs/runtime-bun
```

## Usage

```ts
import { Application } from '@elysiumjs/core';
import { runtime } from '@elysiumjs/runtime-bun';

@Application.register({ runtime, modules: [] })
class App extends Application {}
```

The package exports `runtime`; rename it at import if you like: `import { runtime as bunRuntime } from '@elysiumjs/runtime-bun'`.

Uses `Bun.env`, `Bun.sleep`, Elysia's `listen`, `process.exit` and `SIGINT`/`SIGTERM` handlers.

## License

Apache-2.0
