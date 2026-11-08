---
'@elysiumjs/core': minor
---

Routes declare request headers: `@Http.header(name, schema?)` gives a header to the handler, and the `headers` route option declares the others. Both are validated before the handler runs and documented in OpenAPI. Missing or malformed headers get a 400 `BAD_REQUEST` problem with an `errors` list.
