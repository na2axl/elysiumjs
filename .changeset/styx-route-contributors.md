---
'@elysiumjs/styx': minor
---

`routes:generate` includes every controller of the app that a file of the project exports, whatever decorator declares it, instead of only files mentioning `Http.controller`. Route types contributors registered with `Http.RouteTypes` type the routes the method signature does not give, and fully typed controllers are included even when no file exports them.
