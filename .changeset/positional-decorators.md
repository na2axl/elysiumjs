---
'@elysiumjs/core': minor
'@elysiumjs/ariadne': minor
'@elysiumjs/styx': patch
---

Decorators take their main identifier first and their options second.

- `@Http.controller(path, options)` and the route decorators `@Http.get(path, options)`, `post`, `put`, `patch`, `del`, `head`, `options`, `trace` and `sse`. The path defaults to `/`. `@Http.custom(method, path, options)` takes its method first. The options are `HttpControllerOptions` and `HttpRouteOptions`.
- `@Websocket.controller(path, options)`, where the options are those of the websocket server.
- `@Flow.controller(name, options)`, and `@Flow.step(name, options)` or `@Flow.step(options)` for a step named after its method.
- `@Lifecycle.on(event, options)` and `@Lifecycle.once(event, options)`, like their function forms `Lifecycle.on(event, handler)`.
- The styx controller stubs generate the same forms.
