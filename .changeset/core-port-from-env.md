---
'@elysiumjs/core': patch
---

When `server.port` is not set, the app listens on the validated `PORT` variable from its environment schema, then the raw `PORT` variable, then `3000`.
