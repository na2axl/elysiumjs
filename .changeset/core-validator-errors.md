---
'@elysiumjs/core': minor
---

A validator's `validate` and `authorize` may return a `DomainError`, answered as is with its own status, code and extensions. `false` still answers a generic 400 from `validate` and a 401 from `authorize`.
