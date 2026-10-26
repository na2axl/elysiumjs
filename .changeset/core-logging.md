---
'@elysiumjs/core': minor
'@elysiumjs/hermes': patch
---

Route the framework's own diagnostics through the logger service.

Breaking changes:

- `@Event.listen()` with a mode other than `on` or `once` now throws an `ElysiumError` when the class is defined, instead of logging to the console and ignoring the listener.

Fixes and additions:

- `getLogger(context?)` and `LOGGER_SERVICE` (`'logger'`) are exported by `@elysiumjs/core`. `getLogger()` returns the `logger` service when one is registered (such as the one `HermesModule` provides), and a `ConsoleLogger` otherwise or when the service cannot be built or fails to create a child logger. It is resolved at call time from the global scope only, so a module's own `logger` service does not replace it, and returns a child logger bound to `context` when one is given.
- `Middleware.logger` (used by `RequestLoggerMiddleware`) falls back to a `ConsoleLogger` when no `logger` service is registered. It threw before.
- Core diagnostics go through the logger with structured context instead of `console.*`: the debug-mode request log (`debug`, with `method` and `url`), `onDestroy` failures on shutdown (`error`, with `target` and `error`), WAMP connection attempts (`warn` while retrying, `error` when giving up, with `connection`, `attempt`/`attempts`, `maxRetries` and `error`), and WAMP registrations and subscriptions (`info`, with `connection`, `topic` and the registration or subscription id).
- In debug mode, incoming requests are logged through the logger at `debug` level instead of printed with `console.log`. With `HermesModule`, they show only when its `level` is `debug` or `trace`.
- A failed WAMP registration or subscription is logged at `error` level and emitted as `elysium:error` with an error naming the topic and the connection, instead of becoming an unhandled rejection.
- The `elysium:error` emitted for a WAMP client error names the connection and its URL and includes the client's message (or the value it reported, when it is not an `Error`), with that value as `cause` when there is one.
- `HermesLogger` serialises an `error` field of the log context like pino's `err` (type, message and stack), so logged errors keep their stack trace. Elysium logs errors under `error`.
- `@Logged` resolves its fallback logger with `getLogger()`, and logs a thrown error whole under `error` (it logged only its message), so its stack trace is kept.
- The `elysium:error` emitted when a WAMP connection gives up states the number of attempts actually made (the first one plus the retries), as the logged `attempts` does. It stated `maxRetries` before.
