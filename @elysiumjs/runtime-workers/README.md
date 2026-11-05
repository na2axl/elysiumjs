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

## Serving and compiling ahead of time

Build the app with `Application.build()` and export its `fetch`. It returns the root Elysia app without listening. Modules boot on the first request, so building runs no `onInit` work:

```ts
export const app = await new App().build();

export default { fetch: (request: Request) => app.fetch(request) };
```

Workers forbid generating code at runtime (`new Function`), which Elysia does for validators unless the app is compiled ahead of time. Bundle the entry with Elysia's AOT plugin, which evaluates it at build time:

```ts
import { aot } from 'elysia/plugin/aot/bun';

await Bun.build({
	entrypoints: ['src/worker.ts'],
	outdir: 'dist',
	target: 'browser',
	format: 'esm',
	conditions: ['workerd', 'worker', 'browser'],
	external: ['node:*', 'cloudflare:*'],
	plugins: [aot('src/worker.ts', { target: 'workerd' })]
});
```

`bun run check:aot` compiles a sample app this way, checks that the bundle has no runtime code generation, and serves a validated route under Node.js with code generation from strings disallowed.

## License

Apache-2.0
