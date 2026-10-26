---
'@elysiumjs/core': minor
---

WebSocket controllers now run the middlewares registered on them with `@Middleware.register()`. Their hooks run on the upgrade request, so a middleware can refuse the connection by returning a response, for example from `onBeforeHandle`.
