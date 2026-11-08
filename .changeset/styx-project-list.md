---
'@elysiumjs/styx': patch
---

Inside a project, `styx`, `styx list` and `styx help` show Styx's commands (generators, `routes:generate`, build tools) beside the app's, and loading an app that imports `cloudflare:*` modules works. A generator given a module missing from `.elysiumrc` refuses instead of writing under `undefined/`. The validator stub types its request with `Static<typeof X.schema>` and returns promises without `async`.
