---
'@elysiumjs/core': minor
---

`Service.ownersOf(service)` lists the modules that declare a service in their own scope, and `ModuleContext.outside(fn)` runs code outside of any module, so that lookups only see the global scope.
