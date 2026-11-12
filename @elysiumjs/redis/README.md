# @elysiumjs/redis

Redis for [Elysium.js](https://github.com/na2axl/elysiumjs): connections, a lock driver, a cache store, rate limits, a Heracles transport with its worker, and flow and session stores.

## Installation

```bash
bun add @elysiumjs/olympus @elysiumjs/redis
```

## Connections

`RedisModule` registers each connection as a global service named `redis.connection.{name}`. Clients are created on first use.

```ts
import { runtime as bunRuntime } from '@elysiumjs/bun';
import { Application } from '@elysiumjs/olympus';
import { Redis, RedisModule } from '@elysiumjs/redis';

@Application.register({
	runtime: bunRuntime,
	modules: [
		RedisModule.with({
			default: 'cache',
			connections: { cache: { url: process.env.REDIS_URL! } }
		})
	]
})
class App extends Application {}

const client = Redis.getConnection('cache');
```

The default client is `Bun.RedisClient`. Pass `client` in the module config to use another one: `ioredis(...)` wraps an ioredis client, and `upstash({ token })` talks to Upstash over HTTP, which also works on Cloudflare Workers.

## Lock

Importing the package registers the `redis` driver of the `Lock` port. A lock is a key set with `SET NX PX`; Lua scripts release and extend it only for its holder.

```ts
import { Lock } from '@elysiumjs/olympus';
import { HeraclesModule } from '@elysiumjs/olympus/heracles';

import '@elysiumjs/redis';

HeraclesModule.with({ lock: Lock.for('redis', { connection: 'cache', prefix: 'lock:' }) });
```

## Cache store

`KeyvRedis` is a Keyv store over a connection, for the caches of `@elysiumjs/olympus/mnemosyne`:

```ts
import { MnemosyneModule } from '@elysiumjs/olympus/mnemosyne';
import { KeyvRedis } from '@elysiumjs/redis';

MnemosyneModule.with({
	cache: { stores: { redis: () => new KeyvRedis({ connection: 'cache' }) } }
});
// Cache.store('redis')
```

## Rate limits

`RedisRateLimitStore` keeps the counters of `RateLimit` in Redis, so every instance of the app shares them.

## Heracles

`RedisTransport` carries the jobs of a queue on Redis streams. `HeraclesRedisModule` adds two commands: `heracles:work` runs a worker that consumes the queues, and `heracles:clean` removes finished jobs from the streams.

```ts
import { HeraclesModule } from '@elysiumjs/olympus/heracles';
import { HeraclesRedisModule, RedisTransport } from '@elysiumjs/redis';

@Application.register({
	modules: [
		RedisModule.with({ connections: { default: { url: process.env.REDIS_URL! } } }),
		HeraclesModule.with({ queues: { emails: { transport: RedisTransport } } }),
		HeraclesRedisModule
	]
})
class App extends Application {}
```

```bash
styx heracles:work --id worker-1 --queues emails --redis default
```

## Flows

`RedisFlowStore` keeps the flows of `@elysiumjs/olympus/ariadne`:

```ts
import { AriadneModule } from '@elysiumjs/olympus/ariadne';
import { Redis, RedisFlowStore } from '@elysiumjs/redis';

AriadneModule.with({
	store: new RedisFlowStore({ connection: () => Redis.connection(), prefix: 'flow:' })
});
```

Each flow is a hash under `{prefix}{flow:flowKey}`, with a lease key that expires on its own and, once the flow is finished, a marker that keeps its owner and end time for its TTL. The keys of a flow share a hash tag, so they live on the same cluster slot.

## Sessions

`RedisSessionStore` keeps the sessions of `@elysiumjs/olympus/themis`, on any connection, Upstash included:

```ts
import { ThemisModule } from '@elysiumjs/olympus/themis';
import { Redis, RedisSessionStore } from '@elysiumjs/redis';

ThemisModule.with({
	secret: env.APP_SECRET,
	session: {
		store: new RedisSessionStore({ connection: () => Redis.connection(), prefix: 'session:' })
	}
});
```

Each session is a JSON value under `{prefix}{id}` (`session:` by default), which expires with the session.

## License

Apache-2.0
