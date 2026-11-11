---
'@elysiumjs/moirai': minor
---

An action or a query refused with a DomainError that its `errors` do not list now throws `UndeclaredRefusalError`, with the refusal as its `cause`, so that a route answers 500 instead of a problem it never declared. This makes `orThrow()` inside a handler safe: a nested refusal reaches the client only when the caller declares it.
