---
'@elysiumjs/argus': patch
'@elysiumjs/hephaestus': patch
'@elysiumjs/hermes': patch
---

Ship the type declarations. The packages pointed `types` at `dist/index.d.ts` but their build never wrote it, so TypeScript projects got no types for them.
