---
'@elysiumjs/core': minor
---

`onRequest` middlewares registered on a module or a controller now run only for its routes. Elysia runs `onRequest` hooks on every request of the app, so such a middleware could reject requests meant for other modules. They now run first in the transform step of their own routes, after routing and body parsing. Application middlewares still run `onRequest` before routing, for every request.
