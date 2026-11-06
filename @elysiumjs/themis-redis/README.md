# @elysiumjs/themis-redis

A Redis session store for [`@elysiumjs/themis`](../themis). It works with any Redis connection of [`@elysiumjs/redis`](../redis), Upstash included.

## Installation

```bash
bun add @elysiumjs/themis @elysiumjs/themis-redis @elysiumjs/redis
```

## Usage

```ts
import { Redis } from '@elysiumjs/redis';
import { ThemisModule } from '@elysiumjs/themis';
import { RedisSessionStore } from '@elysiumjs/themis-redis';

ThemisModule.with({
	secret: env.APP_SECRET,
	session: {
		store: new RedisSessionStore({ connection: () => Redis.connection(), prefix: 'session:' })
	}
});
```

Each session is a JSON value under `{prefix}{id}` (`session:` by default), which expires with the session.
