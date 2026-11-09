---
'@elysiumjs/moirai': patch
---

`Moirai.ask()` runs the query in the module that registers it, like `Moirai.execute()` does for actions, so the query can inject the private services of its module when it is asked from another module.
