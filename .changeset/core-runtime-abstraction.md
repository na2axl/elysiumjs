---
'@elysiumjs/core': minor
'@elysiumjs/redis': minor
'@elysiumjs/runtime-bun': minor
'@elysiumjs/runtime-node': minor
'@elysiumjs/runtime-workers': minor
'@elysiumjs/heracles': patch
'@elysiumjs/mnemosyne': patch
'create-elysium': patch
---

Core runs outside Bun. Environment variables, timers, the HTTP server, process exit and shutdown signals now come from a `Runtime` set with the new `runtime` option of `@Application.register()` or with `Runtime.use()`. Runtimes ship as packages: `@elysiumjs/runtime-bun`, `@elysiumjs/runtime-node` and `@elysiumjs/runtime-workers`.

Breaking: an application needs a runtime (add `runtime: bunRuntime` from `@elysiumjs/runtime-bun`), and `Redis` and `RedisModule` moved from core to the new `@elysiumjs/redis` package, which also accepts a `client` factory for runtimes without `Bun.RedisClient`.

Console colours are plain ANSI codes instead of `Bun.color`, `node:readline` is loaded only when a prompt runs, and core's dist is built for the `node` target so `node:` imports keep their prefix. `check:runtime` scripts in core and runtime-workers fail when their bundles touch the `Bun` global.
