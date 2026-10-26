---
'@elysiumjs/core': minor
---

WebSocket controllers now run the middlewares registered on them with `@Middleware.register()`, on the upgrade request. `onRequest`, `onTransform` and `onBeforeHandle` can refuse the connection by returning a response. `onAfterHandle` and `onAfterResponse` run after the upgrade, with no response to read.
