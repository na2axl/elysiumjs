---
'@elysiumjs/core': minor
'@elysiumjs/mnemosyne': minor
'@elysiumjs/moirai': minor
'@elysiumjs/ariadne': minor
'@elysiumjs/themis': minor
---

Domain errors as classes with a code, returned as values.

- `DomainError` is an Elysia `HTTPError`. Each error is a class made with `DomainError.for(code, status)`, which keeps its code and status as literal types, with `errors`, `retryAfterSeconds` (served as `retryAfter` and the Retry-After header) and extensions.
- Ready-made errors: `BadRequestError`, `ValidationFailedError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError` and `ConflictError`.
- `ProblemCatalogue`, extended through declaration merging, lists the codes of an application; once it has keys, `DomainError.for()` takes only those and `ELYSIUM_PROBLEM_CODES`.
- Every problem carries `code`, `requestId` (from `problems.requestId`, a valid `x-request-id` header, or a random UUID) and `instance`. Its `type` is the kebab-case slug of the code, under `problems.typeBase`.
- Errors as values: a handler, a flow step, `UnitOfWork.run()` or a `@Transactional()` method that returns a DomainError rolls back and sends or returns it like a thrown one. `Commands.execute()` and `Queries.ask()` return the DomainError that refused the call, and a returned error joins the route's response type for typed clients.
