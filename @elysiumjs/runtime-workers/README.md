# @elysiumjs/runtime-workers

Cloudflare Workers runtime for [Elysium.js](https://github.com/na2axl/elysiumjs).

## Installation

```bash
bun add @elysiumjs/runtime-workers
```

## Usage

```ts
import { Application } from '@elysiumjs/core';
import { runtime } from '@elysiumjs/runtime-workers';

@Application.register({ runtime, modules: [] })
class App extends Application {}
```

The package exports `runtime`; rename it at import if you like: `import { runtime as workersRuntime } from '@elysiumjs/runtime-workers'`.

Environment variables come from `process.env`, which workerd fills from the Worker's vars and secrets with the `nodejs_compat` flag; use `createRuntime({ env })` to pass others. The host owns the server and the isolate: `serve` throws (export the app's `fetch` from the Worker), and exit and signals do nothing. `bun run check:runtime` checks that the bundle never touches the `Bun` global.

## License

Apache-2.0
