---
'@elysiumjs/core': minor
---

`onRequest` middlewares registered on a module or a controller now run only for its routes. Elysia runs `onRequest` hooks on every request of the app, so such a middleware could reject requests meant for other modules.

They now run in the transform step of their own routes, so after routing and body parsing, and each one runs right before its own `onTransform`: module `onRequest`, module `onTransform`, then controller `onRequest`, controller `onTransform`. Any value they return still stops the request and is sent as the response. Application middlewares still run `onRequest` before routing, for every request.
