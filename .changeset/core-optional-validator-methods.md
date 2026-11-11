---
'@elysiumjs/core': minor
---

`authorize()` and `validate()` are optional on a validator class: core calls each one only when the class has it, so a validator that holds only its schema works.
