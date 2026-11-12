# @elysiumjs/themis-workers

A Cloudflare Workers KV session store for [`@elysiumjs/olympus/themis`](../olympus).

## Installation

```bash
bun add @elysiumjs/olympus @elysiumjs/themis-workers
```

## Usage

```ts
import { Workers } from '@elysiumjs/runtime-workers';
import { ThemisModule } from '@elysiumjs/olympus/themis';
import { KvSessionStore } from '@elysiumjs/themis-workers';

ThemisModule.with({
	secret: env.APP_SECRET,
	session: { store: new KvSessionStore({ namespace: () => Workers.binding('SESSIONS') }) }
});
```

KV is eventually consistent: a session saved in one location can take a few seconds to be seen in another. KV refuses expirations under 60 seconds, so a shorter session lives 60 seconds in KV.
