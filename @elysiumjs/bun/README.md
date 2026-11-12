# @elysiumjs/bun

Bun runtime for [Elysium.js](https://github.com/na2axl/elysiumjs).

## Installation

```bash
bun add @elysiumjs/bun
```

## Usage

```ts
import { runtime } from '@elysiumjs/bun';
import { Application } from '@elysiumjs/olympus';

@Application.register({ runtime, modules: [] })
class App extends Application {}
```

The package exports `runtime`; rename it at import if you like: `import { runtime as bunRuntime } from '@elysiumjs/bun'`.

Uses `Bun.env`, `Bun.sleep`, Elysia's `listen`, `process.exit` and `SIGINT`/`SIGTERM` handlers.

## License

Apache-2.0
