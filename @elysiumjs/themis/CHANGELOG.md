# @elysiumjs/themis

## 0.2.1

### Patch Changes

- Updated dependencies [[`c8d9f53`](https://github.com/na2axl/elysiumjs/commit/c8d9f534eef32621eae121f7008f97dc24808141)]:
  - @elysiumjs/core@0.13.0

## 0.2.0

### Minor Changes

- [#34](https://github.com/na2axl/elysiumjs/pull/34) [`89fb829`](https://github.com/na2axl/elysiumjs/commit/89fb8296d6894f240513f6224093292af4046635) Thanks [@na2axl](https://github.com/na2axl)! - Secrets can be functions, and `Jwt` gains key rotation, a required expiry and a clock.

  - The `ThemisModule` secret, JWT secrets and signed URL secrets accept a function (sync or async) called each time the secret is used, such as one reading a Workers secrets binding during the request.
  - `Jwt.verify` takes `keys`, tried in order until one verifies the signature.
  - Breaking: `Jwt.verify` refuses a token without `exp` by default. `requiredClaims` sets the claims a token must carry (`[]` accepts one without `exp`).
  - `Jwt.verify` takes `currentDate`, and `Jwt.sign` takes `issuedAt`, which `expiresIn` counts from.

## 0.1.1

### Patch Changes

- Updated dependencies [[`651a755`](https://github.com/na2axl/elysiumjs/commit/651a7557173ce2c6155bcfa8d90cf388ac419821)]:
  - @elysiumjs/core@0.12.0

## 0.1.0

### Minor Changes

- [#19](https://github.com/na2axl/elysiumjs/pull/19) [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562) Thanks [@na2axl](https://github.com/na2axl)! - Domain errors as classes with a code, returned as values.

  - `DomainError` is an Elysia `HTTPError`. Each error is a class made with `DomainError.for(code, status)`, which keeps its code and status as literal types, with `errors`, `retryAfterSeconds` (served as `retryAfter` and the Retry-After header) and extensions.
  - Ready-made errors: `BadRequestError`, `ValidationFailedError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError` and `ConflictError`.
  - `ProblemCatalogue`, extended through declaration merging, lists the codes of an application; once it has keys, `DomainError.for()` takes only those and `ELYSIUM_PROBLEM_CODES`.
  - Every problem carries `code`, `requestId` (from `problems.requestId`, a valid `x-request-id` header, or a random UUID) and `instance`. Its `type` is the kebab-case slug of the code, under `problems.typeBase`.
  - Errors as values: a handler, a flow step, `UnitOfWork.run()` or a `@Transactional()` method that returns a DomainError rolls back and sends or returns it like a thrown one. `Commands.execute()` and `Queries.ask()` return the DomainError that refused the call, and a returned error joins the route's response type for typed clients.

- [#17](https://github.com/na2axl/elysiumjs/pull/17) [`03e062d`](https://github.com/na2axl/elysiumjs/commit/03e062d9f5d8ec761c63f05574ce96a1084fe3ea) Thanks [@na2axl](https://github.com/na2axl)! - Commands, outbox, authentication and multi-step flows, on Bun, Node.js and Cloudflare Workers.

  Added:

  - `@elysiumjs/moirai`: commands and queries declared with `@Moirai.command()` and `@Moirai.query()`, run with `Commands.execute` and `Queries.ask`. Inputs are validated (400 problem), `authorize` refuses with a 403 problem, commands run in a unit of work and retry transient failures, idempotent commands replay their response for a repeated key (428 without a key, 422 for a key reused with another input), and `serializeBy` runs calls with the same key one after the other. `Outbox.enqueue` writes effects that relay once the unit of work commits, to `@Moirai.effect()` handlers, with a backoff and dead rows; `Outbox.sweep` relays what is due; `Inbox.once` processes a message once per consumer. `@elysiumjs/moirai/heracles` adds `job()`, an effect that dispatches a Heracles job. Memory stores for tests.
  - `@elysiumjs/moirai-drizzle`: Postgres stores for moirai through Drizzle ORM: `moiraiTables(schema?)`, `DrizzleIdempotencyStore`, `DrizzleOutboxStore` (claims with `FOR UPDATE SKIP LOCKED`), `DrizzleInboxStore` and `PgAdvisoryLock`.
  - `@elysiumjs/themis`: password hashing (argon2id on Bun, PBKDF2 everywhere, scrypt on `@elysiumjs/themis/scrypt`), JWT through jose, API keys, signed URLs, sessions (memory, Redis, Workers KV, or an encrypted cookie), `@Auth()` with session, JWT and API key guards (401 problem), picked by name through `AuthMiddleware.guards()` of core middleware, CSRF protection, TOTP and backup codes, OAuth 2.0 and OpenID Connect clients with PKCE through oauth4webapi, and passkeys through SimpleWebAuthn.
  - `@elysiumjs/ariadne`: multi-step flows as controllers: `@Flow.controller()` adds the start and state routes, each `@Flow.step()` method is a route that takes the `@Http.*()` parameter decorators, and `@Flow.state()` / `@Flow.context()` inject the flow. Replay of a repeated step id, refused steps that keep their state, back steps, guest and user owners, a flow that ends when `next` gives no step, and a memory store set by `AriadneModule.with({ store })`.
  - `@elysiumjs/ariadne-redis`: `RedisFlowStore`, whose claims and commits are atomic Lua scripts run with `EVAL`, which Upstash runs too.
  - `@elysiumjs/ariadne-workers`: `FlowStoreObject`, a Durable Object flow store, and `durableFlowStore(binding)`.

### Patch Changes

- Updated dependencies [[`6bc48fe`](https://github.com/na2axl/elysiumjs/commit/6bc48febd51f7090c582e73f349eaeff7261241c), [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148), [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82), [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4), [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562), [`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5), [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64), [`0057b67`](https://github.com/na2axl/elysiumjs/commit/0057b67df0e3abecab8a9accff6b55a6a64c21df), [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4), [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d), [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4), [`fbcc7da`](https://github.com/na2axl/elysiumjs/commit/fbcc7dad127db29da42e7a4a5c2124966731cd88), [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576), [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b)]:
  - @elysiumjs/core@0.11.0
