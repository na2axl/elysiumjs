---
'@elysiumjs/styx': patch
---

`routes:generate --out` (and `routes` in `.elysiumrc`) accepts an absolute path, and new projects ignore every `*.gen.ts` file instead of only `src/routes.gen.ts`.
