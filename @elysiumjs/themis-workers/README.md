# @elysiumjs/themis-workers

A Cloudflare Workers KV session store for [`@elysiumjs/themis`](../themis).

## Installation

```bash
bun add @elysiumjs/themis @elysiumjs/themis-workers
```

## Usage

```ts
import { Workers } from '@elysiumjs/runtime-workers';
import { ThemisModule } from '@elysiumjs/themis';
import { KvSessionStore } from '@elysiumjs/themis-workers';

ThemisModule.with({
	secret: env.APP_SECRET,
	session: { store: new KvSessionStore({ namespace: () => Workers.binding('SESSIONS') }) }
});
```

KV is eventually consistent: a session saved in one location can take a few seconds to be seen in another. KV refuses expirations under 60 seconds, so a shorter session lives 60 seconds in KV.
