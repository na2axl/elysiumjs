---
'@elysiumjs/olympus': minor
'@elysiumjs/bun': patch
'@elysiumjs/node': patch
'@elysiumjs/workers': patch
'@elysiumjs/drizzle': minor
---

Disks keep a `Cache-Control` header: `put()` takes `cacheControl`, `head()` and `get()` answer it, and the signed download route sends it. An upload purpose sets it on its ready files with a `cacheControl` getter. `uploadTtl`, `unclaimedTtl` and `maxPending` of `PithosModule.with({ files })` also take a function, read each time the value is used.

Files carry `metadata`, a JSON object of what their purpose tells about them, such as the length of a video. An upload purpose fills it with `metadata(file, bytes)` when the file is finished (typed by `Upload<TMetadata>`; throwing refuses the file), and `Files.describe(id, metadata)` adds to it later. `filesTable()` adds a `metadata jsonb not null default '{}'` column: generate a migration.
