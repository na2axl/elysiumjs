---
'@elysiumjs/olympus': patch
---

The routes of `StorageController` declare their responses: a download answers the bytes of the object (`StoredObjectView`) and an upload answers 204, so `styx routes:check` accepts an app with `PithosModule`. A `Response` a handler returns is answered with its own status, also on a route with a `status`.
