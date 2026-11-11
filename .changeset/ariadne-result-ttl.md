---
'@elysiumjs/ariadne': minor
---

A flow step may return a `Result` or an `AsyncResult`, unwrapped like a route's, and a flow's `ttl` may be a function, read each time a flow starts or a step is committed. The start and state routes of a flow declare their response schemas, so `styx routes:check` accepts them.
