---
'@elysiumjs/core': minor
'@elysiumjs/runtime-workers': minor
---

`Application.build()` builds the root Elysia app without listening, for hosts that own the server (Cloudflare Workers) and for ahead-of-time compilation with `elysia/plugin/aot`. Modules are registered but boot on the first request (once, shared by concurrent requests), so building runs no `onInit` work. A boot failure fails the requests.

HTTP and websocket controllers in the server scope, and middlewares, are now built on their first request instead of when the app is built. `serve` still boots every module before listening.

`@elysiumjs/runtime-workers` gets a `check:aot` script, run in CI: it compiles a sample app with the AOT plugin for workerd, checks that the bundle holds no `new Function` or `eval`, and serves a validated route and the OpenAPI document under Node.js with code generation from strings disallowed.
