---
'@elysiumjs/moirai': minor
---

`@Action.register()` and `@Query.register()` take `result` and `errors`. The static `result` and `errors` of the class give them back for routes (`response: TopUp.result, errors: TopUp.errors`); `errors` adds the problems of moirai that apply (invalid input, refused call, idempotency keys). A registration whose `errors` miss a DomainError that `handle()` gives does not compile. The problems of moirai describe their extension members.
