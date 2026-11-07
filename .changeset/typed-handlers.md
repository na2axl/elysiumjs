---
'@elysiumjs/moirai': minor
---

Type actions and queries with their errors, and let them take no input.

- `Action<TInput, TResult, TErrors>` and `Query<TInput, TResult, TErrors>` take the DomainErrors their `handle()` returns as a third type parameter (any DomainError by default), and `HandlerResult<TResult, TErrors>` gives `TResult` or one of `TErrors`. `Moirai.execute()` and `Moirai.ask()` return them next to the result.
- `input` is optional in `@Action.register()` and `@Query.register()`. A handler without an input schema takes no input, and `Moirai.ask(Categories)` or `Moirai.execute(Ping)` call it without one (`Moirai.execute(Ping, undefined, { idempotencyKey })` for an idempotent one). The input of `Moirai.execute()` and `Moirai.ask()` may be left out whenever `handle()` takes none or an optional one.
