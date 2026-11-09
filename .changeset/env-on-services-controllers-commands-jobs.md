---
'@elysiumjs/core': minor
'@elysiumjs/heracles': minor
'@elysiumjs/styx': patch
---

Services, factory definitions, HTTP controllers, commands and jobs take an `env` option, as modules do: the `NODE_ENV` values in which they are active. In any other environment they are left out when their module loads: an inactive service is not registered (nor returned by `injectAll`), an inactive controller mounts no routes, an inactive command is not listed and an inactive job is neither dispatched nor scheduled. `Environments` reads and records them, and `ModuleGraph.own()` lists the active controllers, commands or jobs of a module.
