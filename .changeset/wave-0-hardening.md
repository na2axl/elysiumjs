---
'@elysiumjs/core': minor
'@elysiumjs/runtime-bun': minor
'@elysiumjs/runtime-node': minor
'@elysiumjs/runtime-workers': minor
'@elysiumjs/redis': minor
'@elysiumjs/heracles': minor
'@elysiumjs/mnemosyne': minor
'@elysiumjs/styx': patch
---

Hardening of the runtimes, the container and the CLI, checked by a conformance suite that runs on Bun, Node.js and workerd.

Breaking changes:

- `Runtime` gains the required `argv()`, `write(stream, text)` and `terminal()` members: core reaches the host's arguments, output streams and terminal only through the runtime. Custom runtimes must implement them.
- The third parameter of `InteractsWithConsole.write` is now `'stdout' | 'stderr'`.
- The WebSocket options are narrowed to `idleTimeout`, `maxPayloadLength` and `perMessageDeflate`, and the `bun` WebSocket types are replaced by `ElysiumWebSocket`.
- Redis connections are `RedisConnection`s, a port any Redis client can implement, instead of `Bun.RedisClient`.
- `styx create @scope/name` creates the project in `name/`, and refuses project and module names with upper-case letters.
- Queue handlers no longer reject the batch: after the handlers ran, each message is acked or retried on its own. `@Workers.queue(name, { each: true })` receives one message at a time, so a failure retries only that message.

Fixes:

- Request-scoped services are destroyed when the request ends, also on failure, and an async `onInit` is awaited. A second dispose of a request scope waits for the one in progress, so a Worker's `waitUntil` covers an async `onDestroy`.
- A failed module or service `onInit` no longer breaks later requests: the boot is retried, and the module's event listeners are unwired.
- `@elysiumjs/runtime-node` serves through `node:http`, keeping the Host header authoritative.
- `styx create` validates names before creating files, ships `.gitignore`, declares the dependencies of created projects and imports their default controllers.
