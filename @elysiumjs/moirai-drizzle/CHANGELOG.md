# @elysiumjs/moirai-drizzle

## 0.4.1

### Patch Changes

- Updated dependencies [[`2cfba22`](https://github.com/na2axl/elysiumjs/commit/2cfba227331e720b8ff79a6a4cdfeb3c251a450e), [`2cfba22`](https://github.com/na2axl/elysiumjs/commit/2cfba227331e720b8ff79a6a4cdfeb3c251a450e)]:
  - @elysiumjs/core@0.24.1
  - @elysiumjs/mnemosyne-drizzle@0.9.0
  - @elysiumjs/moirai@0.8.1

## 0.4.0

### Minor Changes

- [#97](https://github.com/na2axl/elysiumjs/pull/97) [`7eb3d1c`](https://github.com/na2axl/elysiumjs/commit/7eb3d1ccf4c5602fe67b7f3fac0da587047f168a) Thanks [@na2axl](https://github.com/na2axl)! - `moiraiTables(schema, { partitioned: true })` partitions `events` by `occurred_at` and `outbox` by `created_at`, with that column in their primary and unique keys.

### Patch Changes

- Updated dependencies [[`4d5809f`](https://github.com/na2axl/elysiumjs/commit/4d5809f264de7195ad865c2676d12fe3e96da859), [`7eb3d1c`](https://github.com/na2axl/elysiumjs/commit/7eb3d1ccf4c5602fe67b7f3fac0da587047f168a)]:
  - @elysiumjs/mnemosyne-drizzle@0.8.0

## 0.3.6

### Patch Changes

- Updated dependencies [[`94c990e`](https://github.com/na2axl/elysiumjs/commit/94c990e794e91a1b3ed3bc005ebd7e535b862e8d)]:
  - @elysiumjs/core@0.24.0
  - @elysiumjs/mnemosyne-drizzle@0.7.1
  - @elysiumjs/moirai@0.8.1

## 0.3.5

### Patch Changes

- Updated dependencies [[`7a3e076`](https://github.com/na2axl/elysiumjs/commit/7a3e07630ccbd5c90f48ff23430a94a0b08c9909)]:
  - @elysiumjs/mnemosyne-drizzle@0.7.0

## 0.3.4

### Patch Changes

- Updated dependencies [[`9a5f13a`](https://github.com/na2axl/elysiumjs/commit/9a5f13a9d432da0ae901b93e676262bc2ce17586)]:
  - @elysiumjs/moirai@0.8.0

## 0.3.3

### Patch Changes

- Updated dependencies [[`8235094`](https://github.com/na2axl/elysiumjs/commit/823509464b9f71a80fdac117418b7e3e1213103c)]:
  - @elysiumjs/core@0.23.0
  - @elysiumjs/mnemosyne-drizzle@0.6.3
  - @elysiumjs/moirai@0.7.1

## 0.3.2

### Patch Changes

- Updated dependencies [[`791048c`](https://github.com/na2axl/elysiumjs/commit/791048ca9eca4c69a8cb199482541fe95327c786), [`f2eba2d`](https://github.com/na2axl/elysiumjs/commit/f2eba2d01400fb76a3b4f49642f45a4b692ccf03)]:
  - @elysiumjs/core@0.22.0
  - @elysiumjs/moirai@0.7.0
  - @elysiumjs/mnemosyne-drizzle@0.6.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`5b79d5a`](https://github.com/na2axl/elysiumjs/commit/5b79d5a4b634347ce18766ef08aec12916328ff6), [`38389af`](https://github.com/na2axl/elysiumjs/commit/38389af7e6965d0ed2259a526700462ca3535475), [`9bd29cb`](https://github.com/na2axl/elysiumjs/commit/9bd29cbd10131e4465505de91c78e7f39d242e71)]:
  - @elysiumjs/core@0.21.0
  - @elysiumjs/moirai@0.6.0
  - @elysiumjs/mnemosyne-drizzle@0.6.1

## 0.3.0

### Minor Changes

- [#67](https://github.com/na2axl/elysiumjs/pull/67) [`9901020`](https://github.com/na2axl/elysiumjs/commit/99010200522c56bb37cbc44c7ffa311d69972599) Thanks [@na2axl](https://github.com/na2axl)! - `Clock` in core: `Clock.now()` and `Clock.epochMs()` give the application time, which `Clock.freeze()` and `Clock.travel()` stop or move in development and test, and `Clock.use()` takes from another source. Moirai (event, stream, projection and outbox instants, idempotency records), the projection store of moirai-drizzle, Heracles scheduler ticks and Themis (JWT issue and expiry checks, sessions, signed URLs, TOTP) read the time from it.

- [#72](https://github.com/na2axl/elysiumjs/pull/72) [`a1d976f`](https://github.com/na2axl/elysiumjs/commit/a1d976ff4d52e9e6604c3540444f2981bb81f76a) Thanks [@na2axl](https://github.com/na2axl)! - Mnemosyne's list helpers are named `Listing` (`Listing.define()`, `Listing.parse()`, `Listing.mapPage()` and more), so they no longer share a name with the queries of moirai. `Listing.filterPage(page, keep)` filters the rows of a page and keeps its pagination. Repositories take a `RowKey`, a scalar id or an object: `DrizzleRepository` finds rows by the table's primary key, composite keys included, or by the columns named in `DrizzleRepository(model, { key })`, and throws `RepositoryKeyError` for a key that does not match. `list(query, scope)` and `count(query, scope)` take an extra condition. The moirai-drizzle stores accept tables in a domain's own schema with extra columns and another primary key (`StoreTable<T>`).

- [#70](https://github.com/na2axl/elysiumjs/pull/70) [`14cadae`](https://github.com/na2axl/elysiumjs/commit/14cadae051a805b1c9c2ed16122ac09cf1a69f66) Thanks [@na2axl](https://github.com/na2axl)! - `Moirai.lock(key)` serializes work from inside a handler, for a key known after a read, until the unit of work ends. `Moirai.execute()` and `Moirai.ask()` return an `Outcome` whose `orThrow()` gives the result alone and throws the refusal, and `Moirai.ErrorsOf<C>` names the DomainErrors of a handler without moirai's own. `errors` is now required by `@Action.register()` and `@Query.register()` (`[]` when `handle()` gives none). Outbox handlers get a context whose `replacePayload()` replaces the payload of their row once they succeed; `OutboxStore.replacePayload()` is implemented by the memory and Drizzle stores.

### Patch Changes

- Updated dependencies [[`920b941`](https://github.com/na2axl/elysiumjs/commit/920b941a9c070c9006fe277abc7a187b9d140af7), [`9901020`](https://github.com/na2axl/elysiumjs/commit/99010200522c56bb37cbc44c7ffa311d69972599), [`a1d976f`](https://github.com/na2axl/elysiumjs/commit/a1d976ff4d52e9e6604c3540444f2981bb81f76a), [`7dc7c59`](https://github.com/na2axl/elysiumjs/commit/7dc7c59f67b9f62159064f7958f529f4e6e27e65), [`14cadae`](https://github.com/na2axl/elysiumjs/commit/14cadae051a805b1c9c2ed16122ac09cf1a69f66)]:
  - @elysiumjs/core@0.20.0
  - @elysiumjs/moirai@0.5.0
  - @elysiumjs/mnemosyne-drizzle@0.6.0

## 0.2.0

### Minor Changes

- [#62](https://github.com/na2axl/elysiumjs/pull/62) [`ae64ba6`](https://github.com/na2axl/elysiumjs/commit/ae64ba68a356eb6e9fbac2a6088dc324a4f50df9) Thanks [@na2axl](https://github.com/na2axl)! - `DrizzleEventStore` and `DrizzleProjectionStorage`, with the `events` and `projections` tables in `moiraiTables()`.

### Patch Changes

- Updated dependencies [[`ae64ba6`](https://github.com/na2axl/elysiumjs/commit/ae64ba68a356eb6e9fbac2a6088dc324a4f50df9)]:
  - @elysiumjs/moirai@0.4.0

## 0.1.9

### Patch Changes

- Updated dependencies [[`af05b49`](https://github.com/na2axl/elysiumjs/commit/af05b498a2c4d4dafda44f361fe68c490f49a8c7), [`7ffe5eb`](https://github.com/na2axl/elysiumjs/commit/7ffe5eb3926d8a428c6cb14fdc9437758d4c99b5)]:
  - @elysiumjs/core@0.19.0
  - @elysiumjs/mnemosyne-drizzle@0.5.3
  - @elysiumjs/moirai@0.3.4

## 0.1.8

### Patch Changes

- Updated dependencies [[`d471a6e`](https://github.com/na2axl/elysiumjs/commit/d471a6e69736e016eb972a0715987df1d7b62438)]:
  - @elysiumjs/core@0.18.0
  - @elysiumjs/mnemosyne-drizzle@0.5.2
  - @elysiumjs/moirai@0.3.3

## 0.1.7

### Patch Changes

- Updated dependencies [[`762661e`](https://github.com/na2axl/elysiumjs/commit/762661e362444f431ea84576494322a9a7a81539)]:
  - @elysiumjs/core@0.17.0
  - @elysiumjs/mnemosyne-drizzle@0.5.1
  - @elysiumjs/moirai@0.3.1

## 0.1.6

### Patch Changes

- Updated dependencies [[`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9), [`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9), [`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9)]:
  - @elysiumjs/core@0.16.0
  - @elysiumjs/mnemosyne-drizzle@0.5.0
  - @elysiumjs/moirai@0.3.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`d663d2e`](https://github.com/na2axl/elysiumjs/commit/d663d2ed95778079f71e53fcaf60a7f8ef570f6d)]:
  - @elysiumjs/core@0.15.0
  - @elysiumjs/mnemosyne-drizzle@0.4.5
  - @elysiumjs/moirai@0.2.4

## 0.1.4

### Patch Changes

- Updated dependencies [[`359f157`](https://github.com/na2axl/elysiumjs/commit/359f1579b9ad69643da5360d9ca9e80104fbe2f1)]:
  - @elysiumjs/core@0.14.0
  - @elysiumjs/mnemosyne-drizzle@0.4.4
  - @elysiumjs/moirai@0.2.3

## 0.1.3

### Patch Changes

- Updated dependencies [[`c8d9f53`](https://github.com/na2axl/elysiumjs/commit/c8d9f534eef32621eae121f7008f97dc24808141)]:
  - @elysiumjs/core@0.13.0
  - @elysiumjs/mnemosyne-drizzle@0.4.3
  - @elysiumjs/moirai@0.2.2

## 0.1.2

### Patch Changes

- Updated dependencies [[`651a755`](https://github.com/na2axl/elysiumjs/commit/651a7557173ce2c6155bcfa8d90cf388ac419821)]:
  - @elysiumjs/core@0.12.0
  - @elysiumjs/mnemosyne-drizzle@0.4.2
  - @elysiumjs/moirai@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`1a5599c`](https://github.com/na2axl/elysiumjs/commit/1a5599c5421c98b5ee64b0c5cab87d158041d309)]:
  - @elysiumjs/moirai@0.2.0

## 0.1.0

### Minor Changes

- [#21](https://github.com/na2axl/elysiumjs/pull/21) [`0035580`](https://github.com/na2axl/elysiumjs/commit/00355809c338a68e39d67335fb820ee098f36f89) Thanks [@na2axl](https://github.com/na2axl)! - Writes are actions and reads are queries. An action extends `Action` and is marked with `@Action.register()`; a query extends `Query` and is marked with `@Query.register()`. `Moirai.execute()` runs an action and `Moirai.ask()` runs a query, and their outcomes are `ActionOutcome` and `QueryOutcome`. Outbox handlers are marked with `@Outbox.handle(kind)`.

  The options, retry policy and lock are `ActionOptions`, `ActionRetry`, `ActionLock` (`MemoryActionLock`, `MOIRAI_ACTION_LOCK`), and a refused `authorize` is a `CallForbiddenError`. Idempotency records name their `action`, and the `idempotency_keys` table of `moiraiTables()` has an `action` column.

- [#17](https://github.com/na2axl/elysiumjs/pull/17) [`03e062d`](https://github.com/na2axl/elysiumjs/commit/03e062d9f5d8ec761c63f05574ce96a1084fe3ea) Thanks [@na2axl](https://github.com/na2axl)! - Commands, outbox, authentication and multi-step flows, on Bun, Node.js and Cloudflare Workers.

  Added:

  - `@elysiumjs/moirai`: commands and queries declared with `@Moirai.command()` and `@Moirai.query()`, run with `Commands.execute` and `Queries.ask`. Inputs are validated (400 problem), `authorize` refuses with a 403 problem, commands run in a unit of work and retry transient failures, idempotent commands replay their response for a repeated key (428 without a key, 422 for a key reused with another input), and `serializeBy` runs calls with the same key one after the other. `Outbox.enqueue` writes effects that relay once the unit of work commits, to `@Moirai.effect()` handlers, with a backoff and dead rows; `Outbox.sweep` relays what is due; `Inbox.once` processes a message once per consumer. `@elysiumjs/moirai/heracles` adds `job()`, an effect that dispatches a Heracles job. Memory stores for tests.
  - `@elysiumjs/moirai-drizzle`: Postgres stores for moirai through Drizzle ORM: `moiraiTables(schema?)`, `DrizzleIdempotencyStore`, `DrizzleOutboxStore` (claims with `FOR UPDATE SKIP LOCKED`), `DrizzleInboxStore` and `PgAdvisoryLock`.
  - `@elysiumjs/themis`: password hashing (argon2id on Bun, PBKDF2 everywhere, scrypt on `@elysiumjs/themis/scrypt`), JWT through jose, API keys, signed URLs, sessions (memory, Redis, Workers KV, or an encrypted cookie), `@Auth()` with session, JWT and API key guards (401 problem), picked by name through `AuthMiddleware.guards()` of core middleware, CSRF protection, TOTP and backup codes, OAuth 2.0 and OpenID Connect clients with PKCE through oauth4webapi, and passkeys through SimpleWebAuthn.
  - `@elysiumjs/ariadne`: multi-step flows as controllers: `@Flow.controller()` adds the start and state routes, each `@Flow.step()` method is a route that takes the `@Http.*()` parameter decorators, and `@Flow.state()` / `@Flow.context()` inject the flow. Replay of a repeated step id, refused steps that keep their state, back steps, guest and user owners, a flow that ends when `next` gives no step, and a memory store set by `AriadneModule.with({ store })`.
  - `@elysiumjs/ariadne-redis`: `RedisFlowStore`, whose claims and commits are atomic Lua scripts run with `EVAL`, which Upstash runs too.
  - `@elysiumjs/ariadne-workers`: `FlowStoreObject`, a Durable Object flow store, and `durableFlowStore(binding)`.

### Patch Changes

- Updated dependencies [[`6bc48fe`](https://github.com/na2axl/elysiumjs/commit/6bc48febd51f7090c582e73f349eaeff7261241c), [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148), [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82), [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4), [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562), [`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5), [`0035580`](https://github.com/na2axl/elysiumjs/commit/00355809c338a68e39d67335fb820ee098f36f89), [`a680a17`](https://github.com/na2axl/elysiumjs/commit/a680a177e2d82a6e85d04a9491ffc8fc05fb0010), [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4), [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64), [`0057b67`](https://github.com/na2axl/elysiumjs/commit/0057b67df0e3abecab8a9accff6b55a6a64c21df), [`1738567`](https://github.com/na2axl/elysiumjs/commit/17385674c14991f0ddb27eb6ee967afbcebcc307), [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4), [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d), [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4), [`fbcc7da`](https://github.com/na2axl/elysiumjs/commit/fbcc7dad127db29da42e7a4a5c2124966731cd88), [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576), [`03e062d`](https://github.com/na2axl/elysiumjs/commit/03e062d9f5d8ec761c63f05574ce96a1084fe3ea), [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b)]:
  - @elysiumjs/core@0.11.0
  - @elysiumjs/moirai@0.1.0
  - @elysiumjs/mnemosyne-drizzle@0.4.0
