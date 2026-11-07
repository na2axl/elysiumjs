---
'@elysiumjs/styx': patch
---

Styx commands load apps that import `cloudflare:workers` (to export a Durable Object, such as the flow store of `@elysiumjs/ariadne-workers`): stand-ins of the `cloudflare:*` modules are registered while Styx reads the app's code.
