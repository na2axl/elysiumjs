---
'@elysiumjs/core': major
'@elysiumjs/argus': minor
'@elysiumjs/mnemosyne': minor
'@elysiumjs/plugin-sentry': major
'@elysiumjs/runtime-bun': patch
'@elysiumjs/runtime-node': patch
'@elysiumjs/runtime-workers': patch
'create-elysium': patch
---

Elysium runs on Elysia 2 (`elysia@^2.0.0-rc.1`), with TypeBox 1 (`typebox`), `@elysia/openapi` and `@elysia/opentelemetry`.

Breaking:

- `TSchema` and `Static` are re-exported from `typebox` instead of `@sinclair/typebox`; `Value` comes from `typebox/value` and `Value.Errors()` returns an array.
- `Application.onError()` receives a `ServerError` (exported from core). Elysia now names its errors in kebab case; the default error response keeps the upper snake case names (`VALIDATION`, `NOT_FOUND`, `UNKNOWN` for other errors).
- `AppHttpContext` is a plain interface with `decorator`, `store` and `derive` records (Elysia 2 renamed `resolve` to `derive`).
- Websocket controllers install Elysia's `websocket()` capability themselves.

A module or controller `onRequest` middleware that answers now stops the request: Elysia 2 ignores values returned from a transform hook, so the response is thrown as a status and sent as is, without going through `onError`.

`mnemosyne` builds date columns with `t.Codec` (TypeBox 1 dropped `Transform`). `argus` traces every route of the app it is installed on and ends each span once, keeping the error status when the request failed.
