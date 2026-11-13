---
'@elysiumjs/styx': patch
---

`routes:generate` imports a controller only when a route reads its methods, so a route answered by a view without parameters, query or body no longer leaves an unused import in `routes.gen.ts`.
