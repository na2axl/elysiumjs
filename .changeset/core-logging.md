---
'@elysiumjs/core': minor
'@elysiumjs/hermes': patch
---

Route the framework's own diagnostics through the logger service.

Breaking changes:

- `@Event.listen()` with a mode other than `on` or `once` now throws an `ElysiumError` when the class is defined, instead of logging to the console and ignoring the listener.

Fixes and additions:

- `getLogger(context?)` and `LOGGER_SERVICE` (`'logger'`) are exported by `@elysiumjs/core`. `getLogger()` returns the `logger` service when one is registered (such as the one `HermesModule` provides), and a `ConsoleLogger` otherwise or when the service cannot be built. It is resolved at call time, and returns a child logger bound to `context` when one is given.
- `Middleware.logger` (used by `RequestLoggerMiddleware`) falls back to a `ConsoleLogger` when no `logger` service is registered. It threw before.
- Core diagnostics go through the logger with structured context instead of `console.*`: the debug-mode request log (`debug`, with `method` and `url`), `onDestroy` failures on shutdown (`error`, with `target` and `error`), WAMP connection attempts (`warn` while retrying, `error` when giving up, with `connection`, `attempt`/`attempts`, `maxRetries` and `error`), and WAMP registrations and subscriptions (`info`, with `connection`, `topic` and the registration or subscription id).
- A failed WAMP registration or subscription is logged at `error` level and emitted as `elysium:error` with an error naming the topic and the connection, instead of becoming an unhandled rejection.
- The `elysium:error` emitted for a WAMP client error names the connection and its URL and includes the client's message, with the original error as `cause`.
- `HermesLogger` serialises an `error` field of the log context like pino's `err` (type, message and stack), so logged errors keep their stack trace. Elysium logs errors under `error`.
- `@Logged` resolves its fallback logger with `getLogger()`.
