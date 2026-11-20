---
'@elysiumjs/olympus': minor
'@elysiumjs/workers': minor
'@elysiumjs/drizzle': minor
---

Uploads in parts for large files. A purpose with `multipart` uploads straight to the file's key in parts: `Uploads.open()` answers a ticket with `mode: 'multipart'`, `Uploads.signParts()` signs part URLs with their exact sizes and extends the deadline up to `uploadTtlMax`, `Uploads.listParts()` lets a client resume, `Uploads.finish()` joins the parts and reads only the first `sniffBytes`, and `Uploads.abort()` gives an upload up. Purposes gain `admit(request)`, to refuse an upload with an application problem and keep declared values in the pending file's metadata, and per purpose `uploadTtl`. Disks gain an optional `multipart` capability and `get(key, { range })`; `memory` and `r2` support both. The `elysium:pithos:expired` event is emitted for uploads given up or never finished. `filesTable()` gains a `multipart` column.

`Uploads.open()` now answers `UploadTicket | MultipartTicket`: narrow on `mode` before reading `url`.
