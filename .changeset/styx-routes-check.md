---
'@elysiumjs/core': minor
'@elysiumjs/styx': minor
---

Add `styx routes:check`, which fails when a route declares no schema for its success response. `Http.describe()` now gives the `status` of each route and whether it `responds` with a declared success schema.
