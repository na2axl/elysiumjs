# @elysiumjs/themis-redis

A Redis session store for [`@elysiumjs/olympus/themis`](../olympus). It works with any Redis connection of [`@elysiumjs/redis`](../olympus), Upstash included.

## Installation

```bash
bun add @elysiumjs/olympus @elysiumjs/themis-redis
```

## Usage

```ts
import { Redis } from '@elysiumjs/redis';
import { ThemisModule } from '@elysiumjs/olympus/themis';
import { RedisSessionStore } from '@elysiumjs/themis-redis';

ThemisModule.with({
	secret: env.APP_SECRET,
	session: {
		store: new RedisSessionStore({ connection: () => Redis.connection(), prefix: 'session:' })
	}
});
```

Each session is a JSON value under `{prefix}{id}` (`session:` by default), which expires with the session.
