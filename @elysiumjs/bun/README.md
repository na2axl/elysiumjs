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
