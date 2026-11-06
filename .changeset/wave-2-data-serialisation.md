---
'@elysiumjs/core': minor
'@elysiumjs/mnemosyne': minor
'@elysiumjs/mnemosyne-drizzle': minor
'@elysiumjs/redis': minor
'@elysiumjs/runtime-workers': minor
---

Resources, queries, units of work and rate limits.

Breaking:

- A route with a `response` schema serializes its handler result through it: fields the schema does not declare are dropped, a `Date` becomes an ISO string (`YYYY-MM-DD` for `format: 'date'`), and an object with `toJSON()` becomes what it returns. Set `serialize: false` on a route to send the result as it is.

Added:

- `Resource.hidden(schema)` marks a field that never reaches responses nor the OpenAPI document. `Resource.serialize()` and `Resource.project()` are exported for use outside routes.
- Sparse fieldsets: `?fields=id,title` keeps only those fields of an object, of each item of an array, or of each item of a `data` array. An unknown or hidden field answers a 400 problem.
- Rate limits on routes, controllers and the app (`rateLimit: { window, max, key?, store?, name? }`), with fixed windows. Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and `RateLimit-Policy`; a client over the limit gets a 429 problem with `Retry-After`. Counts are kept by a `RateLimitStore`: `MemoryRateLimitStore` (core), `RedisRateLimitStore` (`@elysiumjs/redis`) or `DurableObjectRateLimitStore` with its `RateLimiterObject` (`@elysiumjs/runtime-workers`).
- `ModelResource(model, { hidden, pick, omit, extend })` (`@elysiumjs/mnemosyne`) builds a response schema from a model.
- `Query.define(model, spec)` declares the filters (`filter[field][op]=value`), sorts, page size and cursor a list accepts; `Query.schema()` gives its query schema, `Query.parse()` turns a request query into a `ParsedQuery` and answers a 400 problem with a pointer per mistake, and `Query.page()` / `Query.pageSchema()` build cursor pages (`{ data, nextCursor }`).
- `DrizzleRepository.list(query)` and `count(query)` run a `ParsedQuery` with keyset pagination (`@elysiumjs/mnemosyne-drizzle`), and `compileQuery()` gives its `where` and `orderBy`.
- Units of work: `UnitOfWork.run()` and the `@Transactional()` method decorator run work in one transaction, and `UnitOfWork.afterCommit()` / `afterRollback()` defer work, such as sending a message, until the outermost transaction has ended. `transactional` routes open a unit of work too.
