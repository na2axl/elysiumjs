---
'@elysiumjs/core': minor
---

Routes document their problems. `DomainError.for(code, status, { extensions, description })` gives the class static `code`, `status` and `schema` (problem details with the literal code and status, and the extension members, which also type the constructor's `extensions`). The `errors` route option lists the problem classes of a route; OpenAPI documents them under their status, one union per status, next to those of the framework (422 validation, 400 malformed requests, 413 body limit, 429 rate limits, 500) and those that middlewares, interceptors and validators list in a static `errors`. `TransformInterceptor.with(transform, { schema })` describes what the interceptor returns, so routes declare the result of their handler and the transformed schema is documented, validated and serialized. New `InternalError` and `validationExtensions()`.
