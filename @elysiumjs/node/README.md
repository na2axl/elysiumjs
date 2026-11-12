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

## Local disk

Importing the package registers `local`, a disk of the `Storage` port of `@elysiumjs/olympus/pithos` that keeps objects as files in a folder, through `node:fs`:

```ts
import '@elysiumjs/node';

import { PithosModule, Storage } from '@elysiumjs/olympus/pithos';

PithosModule.with({
	disks: {
		public: () =>
			Storage.for('local', { root: './storage/public', url: 'https://cdn.example.com' }),
		private: () =>
			Storage.for('local', {
				root: './storage/private',
				signing: { url: 'https://api.example.com/storage/private', secret: env.STORAGE_SECRET }
			})
	}
});
```

The content type and metadata of each object are kept in a `.pithos` folder under the root, which listings leave out. `url` makes the disk public: the folder is served by something else, such as a CDN or a static file server, at that URL. With `signing`, its signed URLs go through the `/storage` route of `PithosModule`.

## License

Apache-2.0
