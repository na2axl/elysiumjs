---
'@elysiumjs/core': minor
---

Add service tags (multi-binding). `Service.tag<T>(name)` creates a tag, `@Service.register({ tags })` (or `tags` on a factory definition) adds a service to it, and `@Service.injectAll(tag)`, `Service.getAll(tag)` and `Service.resolveAll(tag)` give every tagged service of the application in registration order. Tagged services follow the usual scope rules, and an overridden service keeps its tags.
