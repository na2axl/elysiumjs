# @elysiumjs/moirai

## 0.3.2

### Patch Changes

- [#55](https://github.com/na2axl/elysiumjs/pull/55) [`1e6a310`](https://github.com/na2axl/elysiumjs/commit/1e6a310c0ee5baed60fee971aa1980021ffbf30b) Thanks [@na2axl](https://github.com/na2axl)! - `Moirai.ask()` runs the query in the module that registers it, like `Moirai.execute()` does for actions, so the query can inject the private services of its module when it is asked from another module.
- Updated dependencies [[`ec07c41`](https://github.com/na2axl/elysiumjs/commit/ec07c410c417053df4e284d8ddc6d2c4da4e42ec)]:
  - @elysiumjs/core@0.17.1
  - @elysiumjs/heracles@0.8.6
  - @elysiumjs/mnemosyne@0.6.1

## 0.3.1

### Patch Changes

- Updated dependencies [[`762661e`](https://github.com/na2axl/elysiumjs/commit/762661e362444f431ea84576494322a9a7a81539)]:
  - @elysiumjs/core@0.17.0
  - @elysiumjs/heracles@0.8.6
  - @elysiumjs/mnemosyne@0.6.1

## 0.3.0

### Minor Changes

- [#50](https://github.com/na2axl/elysiumjs/pull/50) [`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9) Thanks [@na2axl](https://github.com/na2axl)! - `@Action.register()` and `@Query.register()` take `result` and `errors`. The static `result` and `errors` of the class give them back for routes (`response: TopUp.result, errors: TopUp.errors`); `errors` adds the problems of moirai that apply (invalid input, refused call, idempotency keys). A registration whose `errors` miss a DomainError that `handle()` gives does not compile. The problems of moirai describe their extension members.

### Patch Changes

- Updated dependencies [[`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9), [`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9)]:
  - @elysiumjs/core@0.16.0
  - @elysiumjs/mnemosyne@0.6.0
  - @elysiumjs/heracles@0.8.5

## 0.2.4

### Patch Changes

- Updated dependencies [[`d663d2e`](https://github.com/na2axl/elysiumjs/commit/d663d2ed95778079f71e53fcaf60a7f8ef570f6d)]:
  - @elysiumjs/core@0.15.0
  - @elysiumjs/heracles@0.8.4
  - @elysiumjs/mnemosyne@0.5.4

## 0.2.3

### Patch Changes

- Updated dependencies [[`359f157`](https://github.com/na2axl/elysiumjs/commit/359f1579b9ad69643da5360d9ca9e80104fbe2f1)]:
  - @elysiumjs/core@0.14.0
  - @elysiumjs/heracles@0.8.3
  - @elysiumjs/mnemosyne@0.5.3

## 0.2.2

### Patch Changes

- Updated dependencies [[`c8d9f53`](https://github.com/na2axl/elysiumjs/commit/c8d9f534eef32621eae121f7008f97dc24808141)]:
  - @elysiumjs/core@0.13.0
  - @elysiumjs/heracles@0.8.2
  - @elysiumjs/mnemosyne@0.5.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`651a755`](https://github.com/na2axl/elysiumjs/commit/651a7557173ce2c6155bcfa8d90cf388ac419821)]:
  - @elysiumjs/core@0.12.0
  - @elysiumjs/heracles@0.8.1
  - @elysiumjs/mnemosyne@0.5.1

## 0.2.0

### Minor Changes

- [#28](https://github.com/na2axl/elysiumjs/pull/28) [`1a5599c`](https://github.com/na2axl/elysiumjs/commit/1a5599c5421c98b5ee64b0c5cab87d158041d309) Thanks [@na2axl](https://github.com/na2axl)! - Type actions and queries with their errors, and let them take no input.

  - `Action<TInput, TResult, TErrors>` and `Query<TInput, TResult, TErrors>` take the DomainErrors their `handle()` returns as a third type parameter (any DomainError by default), and `HandlerResult<TResult, TErrors>` gives `TResult` or one of `TErrors`. `Moirai.execute()` and `Moirai.ask()` return them next to the result.
  - `input` is optional in `@Action.register()` and `@Query.register()`. A handler without an input schema takes no input, and `Moirai.ask(Categories)` or `Moirai.execute(Ping)` call it without one (`Moirai.execute(Ping, undefined, { idempotencyKey })` for an idempotent one). The input of `Moirai.execute()` and `Moirai.ask()` may be left out whenever `handle()` takes none or an optional one.

## 0.1.1

### Patch Changes

- Updated dependencies [[`4cd1ef2`](https://github.com/na2axl/elysiumjs/commit/4cd1ef217826164e69cd641ca99f74c6f5a7ebe7)]:
  - @elysiumjs/mnemosyne@0.5.0
  - @elysiumjs/core@0.11.1
  - @elysiumjs/heracles@0.8.0

## 0.1.0

### Minor Changes

- [#19](https://github.com/na2axl/elysiumjs/pull/19) [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562) Thanks [@na2axl](https://github.com/na2axl)! - Domain errors as classes with a code, returned as values.

  - `DomainError` is an Elysia `HTTPError`. Each error is a class made with `DomainError.for(code, status)`, which keeps its code and status as literal types, with `errors`, `retryAfterSeconds` (served as `retryAfter` and the Retry-After header) and extensions.
  - Ready-made errors: `BadRequestError`, `ValidationFailedError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError` and `ConflictError`.
  - `ProblemCatalogue`, extended through declaration merging, lists the codes of an application; once it has keys, `DomainError.for()` takes only those and `ELYSIUM_PROBLEM_CODES`.
  - Every problem carries `code`, `requestId` (from `problems.requestId`, a valid `x-request-id` header, or a random UUID) and `instance`. Its `type` is the kebab-case slug of the code, under `problems.typeBase`.
  - Errors as values: a handler, a flow step, `UnitOfWork.run()` or a `@Transactional()` method that returns a DomainError rolls back and sends or returns it like a thrown one. `Commands.execute()` and `Queries.ask()` return the DomainError that refused the call, and a returned error joins the route's response type for typed clients.

- [#21](https://github.com/na2axl/elysiumjs/pull/21) [`0035580`](https://github.com/na2axl/elysiumjs/commit/00355809c338a68e39d67335fb820ee098f36f89) Thanks [@na2axl](https://github.com/na2axl)! - Writes are actions and reads are queries. An action extends `Action` and is marked with `@Action.register()`; a query extends `Query` and is marked with `@Query.register()`. `Moirai.execute()` runs an action and `Moirai.ask()` runs a query, and their outcomes are `ActionOutcome` and `QueryOutcome`. Outbox handlers are marked with `@Outbox.handle(kind)`.

  The options, retry policy and lock are `ActionOptions`, `ActionRetry`, `ActionLock` (`MemoryActionLock`, `MOIRAI_ACTION_LOCK`), and a refused `authorize` is a `CallForbiddenError`. Idempotency records name their `action`, and the `idempotency_keys` table of `moiraiTables()` has an `action` column.

- [#23](https://github.com/na2axl/elysiumjs/pull/23) [`a680a17`](https://github.com/na2axl/elysiumjs/commit/a680a177e2d82a6e85d04a9491ffc8fc05fb0010) Thanks [@na2axl](https://github.com/na2axl)! - Domain events. `Event.publish(event, payload)` publishes an event in the open unit of work, and each `@Event.on(event, { consumer, retry })` handler gets it once that unit commits: through its own outbox row, so that it retries and dies on its own, and once, through an inbox record named by its consumer. `EventCatalogue` types the names and payloads, and `EventMeta` gives handlers the id, name, publication date and attempt.

  `registerEffect()` takes the attempts of a row, and the memory outbox and inbox stores drop what a unit of work that rolls back wrote.

- [#24](https://github.com/na2axl/elysiumjs/pull/24) [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4) Thanks [@na2axl](https://github.com/na2axl)! - Module stores: `Moirai.stores({ outbox, inbox, ... })` lists stores and options as private services of a module, such as the outbox and inbox tables of a domain. The actions and event handlers of the module, and the code that runs in it, use them instead of the ones of `MoiraiModule`; what a module leaves out comes from `MoiraiModule`. An action runs in the module that registers it, an `@Event.on` handler records its events in the inbox of its module, a `@Once()` job in the inbox of the module that registers the job, and the relay after a commit relays the outbox the rows went to. `Outbox.relay({ module })` and `Outbox.sweep({ module })` relay the outbox of one module; `Outbox.sweep()` relays the outbox of `MoiraiModule` and of every module with its own.

  Breaking: an invalid action or query input is a 422 `VALIDATION_FAILED` problem (was 400), and a missing idempotency key is a 400 `IDEMPOTENCY_KEY_REQUIRED` problem (was 428).

- [#20](https://github.com/na2axl/elysiumjs/pull/20) [`1738567`](https://github.com/na2axl/elysiumjs/commit/17385674c14991f0ddb27eb6ee967afbcebcc307) Thanks [@na2axl](https://github.com/na2axl)! - Scheduled fan-out, dead letters and one consumer per queue.

  - `@Scheduler.job(cron, { args })` dispatches a job on a cron with fixed arguments.
  - A class that extends `Scheduler` and is marked with `@Scheduler.register({ cron, job })` dispatches one job per case its `fanOut(tick)` returns, with arguments typed against the job and a dispatch id made of the scheduler, the case key and the tick. Schedulers are services, so they inject what they read.
  - `ScheduleRunner` runs the schedules on Bun and Node.js (the `heracles:schedule` command), and `Scheduler.jobsFor()` / `Scheduler.dispatch()` serve the cron triggers of Workers.
  - `@Once()` of `@elysiumjs/moirai/heracles` runs a job once per dispatch id, in a unit of work with an inbox record.
  - `HeraclesWorkersModule.with({ deadLetterQueue, onDead })` keeps the jobs that failed their last retry: sent to a dead letter queue with their failure, and handed to a hook.
  - Cron triggers dispatch at the trigger's time.
  - A named queue of a Worker has one consumer: two throw `DuplicateQueueConsumerError` when the Worker is created.

- [#17](https://github.com/na2axl/elysiumjs/pull/17) [`03e062d`](https://github.com/na2axl/elysiumjs/commit/03e062d9f5d8ec761c63f05574ce96a1084fe3ea) Thanks [@na2axl](https://github.com/na2axl)! - Commands, outbox, authentication and multi-step flows, on Bun, Node.js and Cloudflare Workers.

  Added:

  - `@elysiumjs/moirai`: commands and queries declared with `@Moirai.command()` and `@Moirai.query()`, run with `Commands.execute` and `Queries.ask`. Inputs are validated (400 problem), `authorize` refuses with a 403 problem, commands run in a unit of work and retry transient failures, idempotent commands replay their response for a repeated key (428 without a key, 422 for a key reused with another input), and `serializeBy` runs calls with the same key one after the other. `Outbox.enqueue` writes effects that relay once the unit of work commits, to `@Moirai.effect()` handlers, with a backoff and dead rows; `Outbox.sweep` relays what is due; `Inbox.once` processes a message once per consumer. `@elysiumjs/moirai/heracles` adds `job()`, an effect that dispatches a Heracles job. Memory stores for tests.
  - `@elysiumjs/moirai-drizzle`: Postgres stores for moirai through Drizzle ORM: `moiraiTables(schema?)`, `DrizzleIdempotencyStore`, `DrizzleOutboxStore` (claims with `FOR UPDATE SKIP LOCKED`), `DrizzleInboxStore` and `PgAdvisoryLock`.
  - `@elysiumjs/themis`: password hashing (argon2id on Bun, PBKDF2 everywhere, scrypt on `@elysiumjs/themis/scrypt`), JWT through jose, API keys, signed URLs, sessions (memory, Redis, Workers KV, or an encrypted cookie), `@Auth()` with session, JWT and API key guards (401 problem), picked by name through `AuthMiddleware.guards()` of core middleware, CSRF protection, TOTP and backup codes, OAuth 2.0 and OpenID Connect clients with PKCE through oauth4webapi, and passkeys through SimpleWebAuthn.
  - `@elysiumjs/ariadne`: multi-step flows as controllers: `@Flow.controller()` adds the start and state routes, each `@Flow.step()` method is a route that takes the `@Http.*()` parameter decorators, and `@Flow.state()` / `@Flow.context()` inject the flow. Replay of a repeated step id, refused steps that keep their state, back steps, guest and user owners, a flow that ends when `next` gives no step, and a memory store set by `AriadneModule.with({ store })`.
  - `@elysiumjs/ariadne-redis`: `RedisFlowStore`, whose claims and commits are atomic Lua scripts run with `EVAL`, which Upstash runs too.
  - `@elysiumjs/ariadne-workers`: `FlowStoreObject`, a Durable Object flow store, and `durableFlowStore(binding)`.

### Patch Changes

- Updated dependencies [[`6bc48fe`](https://github.com/na2axl/elysiumjs/commit/6bc48febd51f7090c582e73f349eaeff7261241c), [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148), [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82), [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4), [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562), [`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5), [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64), [`0057b67`](https://github.com/na2axl/elysiumjs/commit/0057b67df0e3abecab8a9accff6b55a6a64c21df), [`1738567`](https://github.com/na2axl/elysiumjs/commit/17385674c14991f0ddb27eb6ee967afbcebcc307), [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4), [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d), [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4), [`fbcc7da`](https://github.com/na2axl/elysiumjs/commit/fbcc7dad127db29da42e7a4a5c2124966731cd88), [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576), [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b)]:
  - @elysiumjs/core@0.11.0
  - @elysiumjs/mnemosyne@0.4.0
  - @elysiumjs/heracles@0.8.0
