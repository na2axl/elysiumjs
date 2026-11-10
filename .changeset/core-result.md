---
'@elysiumjs/core': minor
---

Add `Result` and `AsyncResult`: the outcome of a check or a call, passed with a value or failed with a `DomainError`. They narrow with `check()`, and offer `orThrow()`, `orError()`, `errorOr(transform)`, `map(transform)` and `andThen(next)`. A handler that returns a `Result` or an `AsyncResult` answers its value, or its problem.
