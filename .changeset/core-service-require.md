---
'@elysiumjs/core': minor
---

`Service.require()` returns a service the code needs, visible from the current module context, at once, and throws a precise error when it is missing: `ServiceNotFoundError`, `ServiceNotVisibleError` or the environment errors, like `Service.resolve()`, which waits for the service's initialisation.
