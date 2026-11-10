# @elysiumjs/ariadne

## 0.3.3

### Patch Changes

- Updated dependencies [[`791048c`](https://github.com/na2axl/elysiumjs/commit/791048ca9eca4c69a8cb199482541fe95327c786)]:
  - @elysiumjs/core@0.22.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`5b79d5a`](https://github.com/na2axl/elysiumjs/commit/5b79d5a4b634347ce18766ef08aec12916328ff6), [`9bd29cb`](https://github.com/na2axl/elysiumjs/commit/9bd29cbd10131e4465505de91c78e7f39d242e71)]:
  - @elysiumjs/core@0.21.0

## 0.3.1

### Patch Changes

- [#68](https://github.com/na2axl/elysiumjs/pull/68) [`7dc7c59`](https://github.com/na2axl/elysiumjs/commit/7dc7c59f67b9f62159064f7958f529f4e6e27e65) Thanks [@na2axl](https://github.com/na2axl)! - Routes take a success `status` (`@Http.post('/', { status: 201 })`, `@Http.del('/:id', { status: 204 })` without a body), documented with the response schema. `Http.currentContext()` gives the context of the request being handled outside its handler. `Service.extension()` makes an extension point: a tag, a decorator that registers a service with its options, and `all()`, `find()` and `optionsOf()`, which refuse two services with the same name. Themis adds `@Auth.user()` for handler parameters, `Auth.currentUser()` returns the user of the request, and an `AuthUser` interface that apps augment to type the user everywhere.
- Updated dependencies [[`920b941`](https://github.com/na2axl/elysiumjs/commit/920b941a9c070c9006fe277abc7a187b9d140af7), [`9901020`](https://github.com/na2axl/elysiumjs/commit/99010200522c56bb37cbc44c7ffa311d69972599), [`7dc7c59`](https://github.com/na2axl/elysiumjs/commit/7dc7c59f67b9f62159064f7958f529f4e6e27e65)]:
  - @elysiumjs/core@0.20.0

## 0.3.0

### Minor Changes

- [#59](https://github.com/na2axl/elysiumjs/pull/59) [`af05b49`](https://github.com/na2axl/elysiumjs/commit/af05b498a2c4d4dafda44f361fe68c490f49a8c7) Thanks [@na2axl](https://github.com/na2axl)! - `AriadneModule` registers `FlowRouteTypes` in development, so `styx routes:generate` types flow controllers: the start route answers `FlowStart`, the state route `FlowStatus`, and each step `FlowStepReply` with the answer it advances with or returns. `Flow.advance()` keeps the type of its answer.

### Patch Changes

- Updated dependencies [[`af05b49`](https://github.com/na2axl/elysiumjs/commit/af05b498a2c4d4dafda44f361fe68c490f49a8c7), [`7ffe5eb`](https://github.com/na2axl/elysiumjs/commit/7ffe5eb3926d8a428c6cb14fdc9437758d4c99b5)]:
  - @elysiumjs/core@0.19.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`d471a6e`](https://github.com/na2axl/elysiumjs/commit/d471a6e69736e016eb972a0715987df1d7b62438)]:
  - @elysiumjs/core@0.18.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`762661e`](https://github.com/na2axl/elysiumjs/commit/762661e362444f431ea84576494322a9a7a81539)]:
  - @elysiumjs/core@0.17.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9)]:
  - @elysiumjs/core@0.16.0

## 0.2.0

### Minor Changes

- [#48](https://github.com/na2axl/elysiumjs/pull/48) [`d663d2e`](https://github.com/na2axl/elysiumjs/commit/d663d2ed95778079f71e53fcaf60a7f8ef570f6d) Thanks [@na2axl](https://github.com/na2axl)! - Flow routes declare their headers, so OpenAPI documents `x-flow-key` and `x-flow-step` on each step and `x-flow-owner` for guest flows.

### Patch Changes

- Updated dependencies [[`d663d2e`](https://github.com/na2axl/elysiumjs/commit/d663d2ed95778079f71e53fcaf60a7f8ef570f6d)]:
  - @elysiumjs/core@0.15.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`359f157`](https://github.com/na2axl/elysiumjs/commit/359f1579b9ad69643da5360d9ca9e80104fbe2f1)]:
  - @elysiumjs/core@0.14.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`c8d9f53`](https://github.com/na2axl/elysiumjs/commit/c8d9f534eef32621eae121f7008f97dc24808141)]:
  - @elysiumjs/core@0.13.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`651a755`](https://github.com/na2axl/elysiumjs/commit/651a7557173ce2c6155bcfa8d90cf388ac419821)]:
  - @elysiumjs/core@0.12.0

## 0.1.0

### Minor Changes

- [#24](https://github.com/na2axl/elysiumjs/pull/24) [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4) Thanks [@na2axl](https://github.com/na2axl)! - Breaking: a flow request without its `x-flow-key` or `x-flow-step` header is a 400 `BAD_REQUEST` problem (was 422 `VALIDATION_FAILED`). A body that does not match the step's schema stays a 422.

- [#19](https://github.com/na2axl/elysiumjs/pull/19) [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562) Thanks [@na2axl](https://github.com/na2axl)! - Domain errors as classes with a code, returned as values.

  - `DomainError` is an Elysia `HTTPError`. Each error is a class made with `DomainError.for(code, status)`, which keeps its code and status as literal types, with `errors`, `retryAfterSeconds` (served as `retryAfter` and the Retry-After header) and extensions.
  - Ready-made errors: `BadRequestError`, `ValidationFailedError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError` and `ConflictError`.
  - `ProblemCatalogue`, extended through declaration merging, lists the codes of an application; once it has keys, `DomainError.for()` takes only those and `ELYSIUM_PROBLEM_CODES`.
  - Every problem carries `code`, `requestId` (from `problems.requestId`, a valid `x-request-id` header, or a random UUID) and `instance`. Its `type` is the kebab-case slug of the code, under `problems.typeBase`.
  - Errors as values: a handler, a flow step, `UnitOfWork.run()` or a `@Transactional()` method that returns a DomainError rolls back and sends or returns it like a thrown one. `Commands.execute()` and `Queries.ask()` return the DomainError that refused the call, and a returned error joins the route's response type for typed clients.

- [#22](https://github.com/na2axl/elysiumjs/pull/22) [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64) Thanks [@na2axl](https://github.com/na2axl)! - Decorators take their main identifier first and their options second.

  - `@Http.controller(path, options)` and the route decorators `@Http.get(path, options)`, `post`, `put`, `patch`, `del`, `head`, `options`, `trace` and `sse`. The path defaults to `/`. `@Http.custom(method, path, options)` takes its method first. The options are `HttpControllerOptions` and `HttpRouteOptions`.
  - `@Websocket.controller(path, options)`, where the options are those of the websocket server.
  - `@Flow.controller(name, options)`, and `@Flow.step(name, options)` or `@Flow.step(options)` for a step named after its method.
  - `@Lifecycle.on(event, options)` and `@Lifecycle.once(event, options)`, like their function forms `Lifecycle.on(event, handler)`.
  - The styx controller stubs generate the same forms.

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
