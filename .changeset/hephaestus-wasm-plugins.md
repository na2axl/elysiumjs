---
'@elysiumjs/hephaestus': minor
---

Workers builds copy imported `.wasm` files next to the bundle and keep them as imports, so workerd loads them as compiled WebAssembly modules. Bun plugins listed in `build.plugins` of a TypeScript or JavaScript config now run in the Workers and Node builds. An entry that imports `cloudflare:workers` (to export a Durable Object, such as the flow store of `@elysiumjs/ariadne-workers`) now builds: the routes compile against stand-ins of the `cloudflare:*` modules, and the bundle keeps the real imports.
