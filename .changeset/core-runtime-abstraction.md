---
'@elysiumjs/core': minor
---

Add a `Runtime` port so core runs outside Bun. Environment variables, timers, the HTTP server, process exit, shutdown signals and Redis clients now go through `Runtime.get()`, with `bunRuntime`, `nodeRuntime` and `createWorkersRuntime()` built in and `Runtime.use()` to replace it. Console colours are plain ANSI codes instead of `Bun.color`, and `node:readline` is loaded only when a prompt runs. A new `check:runtime` script fails when the core bundle reaches the `Bun` global outside the Bun runtime.
