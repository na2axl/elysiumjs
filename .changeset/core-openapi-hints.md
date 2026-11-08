---
'@elysiumjs/core': minor
---

The OpenAPI document describes request bodies and query parameters:

- `@Http.query(schema)` schemas are passed to Elysia, so the query is validated (422 when it does not match) and documented.
- The body limit reads bodies sent without a content-length in `onRequest` instead of a global parser, so Elysia keeps its own parsers and each body keeps its media types in the document.
