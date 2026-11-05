# @elysiumjs/mnemosyne

Database abstractions and caching for Elysium.js applications.

## Installation

```bash
bun add @elysiumjs/mnemosyne
```

## Usage

`MnemosyneModule` provides the caches (`Cache.redis` and `Cache.memory`). Database driver modules such as `DrizzleModule` from `@elysiumjs/mnemosyne-drizzle` import it for you, so you only add it yourself when you want to configure the caches or use them without a database:

```ts
import { Application, RedisModule } from '@elysiumjs/core';
import { MnemosyneModule } from '@elysiumjs/mnemosyne';

@Application.register({
	modules: [
		RedisModule.with({
			default: 'cache',
			connections: { cache: { url: process.env.REDIS_URL! } }
		}),
		// Opt out of a cache with `redis: false` or `memory: false`.
		MnemosyneModule.with({ cache: { memory: { ttl: 60_000, lruSize: 5000 } } })
	]
})
export class App extends Application {}
```

Any Keyv store can back a cache of its own with `stores`, read with `Cache.store(name)`. On Cloudflare Workers, `KeyvWorkersKV` from `@elysiumjs/runtime-workers` stores entries in a KV namespace:

```ts
import { KeyvWorkersKV } from '@elysiumjs/runtime-workers';

MnemosyneModule.with({
	cache: { redis: false, stores: { kv: () => new KeyvWorkersKV({ binding: 'CACHE' }) } }
});

await Cache.store('kv').set('greeting', 'hello', 120_000);
```

Models and repositories are built with a driver package. See [`@elysiumjs/mnemosyne-drizzle`](../mnemosyne-drizzle/README.md).

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
