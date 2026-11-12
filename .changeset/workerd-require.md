---
'@elysiumjs/mnemosyne-drizzle': patch
---

The bundle loads on Cloudflare Workers: the default Bun SQL driver and `migration:generate` read the module `require` only when they run, so the bundle has no top-level `createRequire(import.meta.url)`, which throws where `import.meta.url` is undefined.
