---
'@elysiumjs/core': patch
---

The tenant set by a middleware, such as a `TenantMiddleware` reading its own header, is no longer replaced by the `x-tenant-id` header (or `public`) before the handler runs.
