---
'@elysiumjs/moirai': patch
---

`@Projection.on()` and `@Reactor.on()` accept handlers with any return type, such as `async` methods returning `Promise<void>`.
