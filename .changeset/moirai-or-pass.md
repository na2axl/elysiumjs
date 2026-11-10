---
'@elysiumjs/moirai': minor
---

`Moirai.execute()` and `Moirai.ask()` outcomes have `orPass()`, for a handler that calls another one: it resolves to the result or to a DomainError of the called handler, and throws `NestedCallRefusedError` (with the refusal as `refusal` and `cause`) for a refusal of moirai itself, such as an invalid input, a refused `authorize` or an idempotency key.
