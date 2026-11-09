# @elysiumjs/ariadne-workers

## 0.1.2

### Patch Changes

- Updated dependencies [[`af05b49`](https://github.com/na2axl/elysiumjs/commit/af05b498a2c4d4dafda44f361fe68c490f49a8c7)]:
  - @elysiumjs/ariadne@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`d663d2e`](https://github.com/na2axl/elysiumjs/commit/d663d2ed95778079f71e53fcaf60a7f8ef570f6d)]:
  - @elysiumjs/ariadne@0.2.0

## 0.1.0

### Minor Changes

- [#17](https://github.com/na2axl/elysiumjs/pull/17) [`03e062d`](https://github.com/na2axl/elysiumjs/commit/03e062d9f5d8ec761c63f05574ce96a1084fe3ea) Thanks [@na2axl](https://github.com/na2axl)! - Commands, outbox, authentication and multi-step flows, on Bun, Node.js and Cloudflare Workers.

  Added:

  - `@elysiumjs/moirai`: commands and queries declared with `@Moirai.command()` and `@Moirai.query()`, run with `Commands.execute` and `Queries.ask`. Inputs are validated (400 problem), `authorize` refuses with a 403 problem, commands run in a unit of work and retry transient failures, idempotent commands replay their response for a repeated key (428 without a key, 422 for a key reused with another input), and `serializeBy` runs calls with the same key one after the other. `Outbox.enqueue` writes effects that relay once the unit of work commits, to `@Moirai.effect()` handlers, with a backoff and dead rows; `Outbox.sweep` relays what is due; `Inbox.once` processes a message once per consumer. `@elysiumjs/moirai/heracles` adds `job()`, an effect that dispatches a Heracles job. Memory stores for tests.
  - `@elysiumjs/moirai-drizzle`: Postgres stores for moirai through Drizzle ORM: `moiraiTables(schema?)`, `DrizzleIdempotencyStore`, `DrizzleOutboxStore` (claims with `FOR UPDATE SKIP LOCKED`), `DrizzleInboxStore` and `PgAdvisoryLock`.
  - `@elysiumjs/themis`: password hashing (argon2id on Bun, PBKDF2 everywhere, scrypt on `@elysiumjs/themis/scrypt`), JWT through jose, API keys, signed URLs, sessions (memory, Redis, Workers KV, or an encrypted cookie), `@Auth()` with session, JWT and API key guards (401 problem), picked by name through `AuthMiddleware.guards()` of core middleware, CSRF protection, TOTP and backup codes, OAuth 2.0 and OpenID Connect clients with PKCE through oauth4webapi, and passkeys through SimpleWebAuthn.
  - `@elysiumjs/ariadne`: multi-step flows as controllers: `@Flow.controller()` adds the start and state routes, each `@Flow.step()` method is a route that takes the `@Http.*()` parameter decorators, and `@Flow.state()` / `@Flow.context()` inject the flow. Replay of a repeated step id, refused steps that keep their state, back steps, guest and user owners, a flow that ends when `next` gives no step, and a memory store set by `AriadneModule.with({ store })`.
  - `@elysiumjs/ariadne-redis`: `RedisFlowStore`, whose claims and commits are atomic Lua scripts run with `EVAL`, which Upstash runs too.
  - `@elysiumjs/ariadne-workers`: `FlowStoreObject`, a Durable Object flow store, and `durableFlowStore(binding)`.

### Patch Changes

- Updated dependencies [[`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4), [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562), [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64), [`03e062d`](https://github.com/na2axl/elysiumjs/commit/03e062d9f5d8ec761c63f05574ce96a1084fe3ea)]:
  - @elysiumjs/ariadne@0.1.0
