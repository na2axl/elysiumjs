---
'@elysiumjs/styx': minor
---

New projects declare the variables they read in `src/env.ts` (`PORT`, and `DATABASE_URL`, `REDIS_URL` or the Upstash variables depending on the chosen parts), and the generated app reads them with `Env.get()` instead of `process.env`.
