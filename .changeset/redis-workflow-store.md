---
'@elysiumjs/redis': minor
---

Add the `redis` workflow store of `@elysiumjs/olympus/odysseus`: `RedisWorkflowStore` keeps the instances of the `engine` driver in Redis, one Lua script per write, shared by any number of processes.
