---
'@elysiumjs/olympus': minor
---

Make the locks of `serializeBy` and `Moirai.lock()` reentrant within one unit of work, whatever the lock driver: a key the unit of work already holds is not taken again, so an action locked on a key can call another action locked on the same key.
