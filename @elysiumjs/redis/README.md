# @elysiumjs/redis

Redis connections for [Elysium.js](https://github.com/na2axl/elysiumjs), as global services named `redis.connection.{name}`.

## Installation

```bash
bun add @elysiumjs/redis
```

## Usage

```ts
import { Application } from '@elysiumjs/core';
import { Redis, RedisModule } from '@elysiumjs/redis';
import { runtime as bunRuntime } from '@elysiumjs/runtime-bun';

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

Clients are created on first use with `Bun.RedisClient`. Pass `client: (url, options) => ...` in the module config to use another client.

## License

Apache-2.0
