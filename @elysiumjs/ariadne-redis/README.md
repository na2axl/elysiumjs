# @elysiumjs/ariadne-redis

A Redis store for [`@elysiumjs/olympus/ariadne`](../olympus) flows. Claims and commits are atomic Lua scripts run with `EVAL`, so they work with any Redis connection of [`@elysiumjs/redis`](../redis), Upstash included.

## Installation

```bash
bun add @elysiumjs/olympus @elysiumjs/redis @elysiumjs/ariadne-redis
```

## Usage

```ts
import { RedisFlowStore } from '@elysiumjs/ariadne-redis';
import { AriadneModule } from '@elysiumjs/olympus/ariadne';
import { Redis } from '@elysiumjs/redis';

AriadneModule.with({
	store: new RedisFlowStore({ connection: () => Redis.connection(), prefix: 'flow:' })
});
```

Each flow is a hash under `{prefix}{flow:flowKey}`, with a lease key that expires on its own and, once the flow is finished, a marker that keeps its owner and end time for its TTL. The keys of a flow share a hash tag, so they live on the same cluster slot.
