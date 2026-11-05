---
'@elysiumjs/runtime-workers': minor
'@elysiumjs/core': minor
'@elysiumjs/mnemosyne': minor
'@elysiumjs/hephaestus': minor
'@elysiumjs/styx': minor
---

`createWorker(app)` from `@elysiumjs/runtime-workers` builds an application and returns the handlers a Cloudflare Worker exports: `fetch` serves the routes, `queue` hands each batch to the service methods marked `@Workers.queue(name)`, and `scheduled` calls the methods marked `@Workers.cron(expression)`. Each invocation runs with its own env and execution context: `Workers.env()`, `Workers.context()` and `Workers.binding(name)` read them, and `WorkersModule` provides them, and the bindings it lists, as request-scoped services injected with `@Workers.inject(name)`. `KeyvWorkersKV` stores mnemosyne caches in a KV namespace. `bun run check:wrangler` runs a sample Worker in `wrangler dev`.

`MnemosyneModule` takes other Keyv stores in `cache.stores`, read with `Cache.store(name)`.

`styx build --target workers` (Hephaestus `hephaestus:build --target workers`, `WorkersBuilder`) bundles a Worker with its routes compiled ahead of time and refuses a bundle that generates code at runtime.

In core, `Application.boot()` initialises the modules once, for hosts that handle more than requests; `Kernel.serviceClasses(node)` lists the service classes of a module; console output falls back to `console` where the host has no output streams; and a singleton depending on a request-scoped service throws `ScopeMismatchError` even when it is built outside a request.
