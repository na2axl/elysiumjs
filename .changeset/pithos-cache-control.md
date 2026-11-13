---
'@elysiumjs/olympus': minor
'@elysiumjs/bun': patch
'@elysiumjs/node': patch
'@elysiumjs/workers': patch
---

Disks keep a `Cache-Control` header: `put()` takes `cacheControl`, `head()` and `get()` answer it, and the signed download route sends it. An upload purpose sets it on its ready files with a `cacheControl` getter. `uploadTtl`, `unclaimedTtl` and `maxPending` of `PithosModule.with({ files })` also take a function, read each time the value is used.
