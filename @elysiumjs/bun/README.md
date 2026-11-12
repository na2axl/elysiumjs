# @elysiumjs/bun

Bun runtime for [Elysium.js](https://github.com/na2axl/elysiumjs).

## Installation

```bash
bun add @elysiumjs/olympus @elysiumjs/bun
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

## Bun disk

Importing the package registers `bun`, a disk of the `Storage` port of `@elysiumjs/olympus/pithos` that keeps objects as files in a folder, through `Bun.file()` and `Bun.write()`. Reads and writes stream, so large objects are not held in memory:

```ts
import '@elysiumjs/bun';

import { PithosModule, Storage } from '@elysiumjs/olympus/pithos';

PithosModule.with({
	disks: {
		public: () => Storage.for('bun', { root: './storage/public', url: 'https://cdn.example.com' }),
		private: () =>
			Storage.for('bun', {
				root: './storage/private',
				signing: { url: 'https://api.example.com/storage/private', secret: env.STORAGE_SECRET }
			})
	}
});
```

The content type and metadata of each object are kept in a `.pithos` folder under the root, which listings leave out. `url` makes the disk public: the folder is served by something else at that URL. With `signing`, its signed URLs go through the `/storage` route of `PithosModule`.

## Argon2id passwords

Importing the package registers `bun`, a driver of the `PasswordHasher` port that hashes with Argon2id through `Bun.password`. Make it the hasher of new passwords; hashes of the other drivers still verify, and `Password.needsRehash()` tells when to replace them:

```ts
import '@elysiumjs/bun';

import { Password, PasswordHasher } from '@elysiumjs/olympus/harpocrates';

Password.use('bun');
// or with stronger parameters
Password.use(PasswordHasher.for('bun', { memoryCost: 131072, timeCost: 3 }));
```

`Password.verify` routes the hashes that start with `$argon2id$` to this driver.

## License

Apache-2.0
