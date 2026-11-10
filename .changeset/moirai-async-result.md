---
'@elysiumjs/moirai': minor
---

`Moirai.execute()` and `Moirai.ask()` give an `Outcome`, the `AsyncResult` of the call: awaited, it is a `Result` that passed with the value of the handler or failed with the DomainError that refused the call. `orThrow()`, `orError()`, `errorOr()`, `map()` and `andThen()` come from `AsyncResult`; `orPass()` gives the result with the DomainErrors of the called handler only. `handle()` may return a `Result`, and `Streams.act()` gives the `AsyncResult` of its command, which may return a `Result` too. `ActionOutcome`, `QueryOutcome` and `ActOutcome` are now `Result` types; `ActionErrors`, `QueryErrors`, `ValueOf` and `ErrorOf` are new.
