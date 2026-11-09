---
'@elysiumjs/ariadne': minor
---

`AriadneModule` registers `FlowRouteTypes` in development, so `styx routes:generate` types flow controllers: the start route answers `FlowStart`, the state route `FlowStatus`, and each step `FlowStepReply` with the answer it advances with or returns. `Flow.advance()` keeps the type of its answer.
