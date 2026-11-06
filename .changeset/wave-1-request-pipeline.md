---
'@elysiumjs/core': minor
'@elysiumjs/runtime-bun': minor
'@elysiumjs/runtime-node': minor
'@elysiumjs/runtime-workers': minor
'@elysiumjs/mnemosyne': minor
'@elysiumjs/heracles': patch
'@elysiumjs/styx': patch
---

The request pipeline: problem details, exception filters, interceptors, typed configuration, HTTP security options and an HTTP test client, checked on Bun, Node.js, workerd and AOT-compiled Workers.

Breaking changes:

- Error responses are RFC 9457 problem details (`application/problem+json`). Request validation errors answer 422 with an `errors` list of JSON pointers (`problems.validationStatus: 400` keeps 400). Server errors only show their message and stack in development. Thrown statuses (`c.status(...)`) are sent as they are.
- Client errors (4xx) are no longer reported to `onError`, the `elysium:error` event or the trace.
- `Runtime.serve` may return a handle with `close()`, which the application calls on shutdown.
- Request bodies are limited to 1 MiB by default (`http.bodyLimit`), also when chunked.
- The environment schema is validated when the app is built or run, with every error reported at once, instead of in the constructor.

Features:

- `DomainError`, with `status`, `type`, `title`, `detail` and extensions, and shortcuts such as `DomainError.notFound()`.
- Exception filters (`@Catch()`, `filters` on routes, controllers, modules and the app) and interceptors (`interceptors` on the same levels), with `TimingInterceptor`, `TransformInterceptor` and mnemosyne's `CacheInterceptor`.
- Typed configuration: `Secret` values, module `envSchema`s merged into the app's, `InvalidEnvironmentError`.
- `http` options: CORS, security headers, body limits and trusted proxies (`ctx.ip`). Runtimes report the client address through `clientAddress`.
- `createTestingHttpApp` and `createHttpClient` send requests to an app in memory, with `expectStatus()`.

Fixes:

- App-level `onRequest` middlewares run in the request scope.
- On Workers, the request scope of a streamed response is disposed when the body ends, not when `fetch` returns.
- `KeyvWorkersKV.clear()` stays within an operation budget (`maxOperations`).
- The Node.js bridge treats a destroyed socket as a client abort.
- Heracles performance metrics report through the Redis port (`connection` or `client`), not a Bun client.
- `styx routes:generate` names anonymous default controllers after their file; `styx create` pins `@elysiumjs/*` packages to the versions it was released with; invalid names are reported as Elysium errors.
