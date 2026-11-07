---
'@elysiumjs/hephaestus': minor
---

Workers builds copy imported `.wasm` files next to the bundle and keep them as imports, so workerd loads them as compiled WebAssembly modules. Bun plugins listed in `build.plugins` of a TypeScript or JavaScript config now run in the Workers and Node builds.
