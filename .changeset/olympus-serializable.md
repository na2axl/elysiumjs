---
'@elysiumjs/olympus': minor
---

Add `@Serializable({ name })`, which makes the instances of any class survive `Json`: they are written as their own fields and read back on the prototype of the class, without calling its constructor, and a DomainError is written as its problem and comes back with its class. A DomainError whose class is not serializable now survives `Json` as a plain DomainError with the same code and fields, and any other error as an `Error` with its name and message.
