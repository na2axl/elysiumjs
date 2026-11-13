# @elysiumjs/olympus

## 0.25.0

### Minor Changes

- [#112](https://github.com/na2axl/elysiumjs/pull/112) [`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023) Thanks [@na2axl](https://github.com/na2axl)! - `@elysiumjs/olympus` is the framework in one package. The root export holds the application, modules, dependency injection, controllers, middleware, problem details, configuration, lifecycle events, logging (`LoggerModule`), JSON with serializers, ports and locks. Subpaths hold the domains:

  - `/mnemosyne`: database and caching, a `Repository(Model)` over a `RepositoryAdapter` port, repository events and pruners.
  - `/moirai`: actions, queries, outbox, inbox and domain events; `Moirai.enqueue()` runs actions as jobs, with `ActionJob` from `/moirai/heracles`.
  - `/heracles`: background jobs.
  - `/ariadne`: multi-step flows.
  - `/harpocrates`: password hashing (scrypt by default), encryption, JWT and signed URLs.
  - `/themis`: authentication.
  - `/cerberus`: permission rules per domain, composed over the facts of an actor and cached per version; route guards and the `authorize` hook of calls.
  - `/hermes`: notifications over channels with fallbacks, an inbox and mail; queued sends with `NotificationJob` from `/hermes/heracles`.
  - `/pithos`: storage disks, file records and uploads sent straight to a disk through signed URLs; `FilesPruner` from `/pithos/heracles`.

  Backends are drivers of ports (`Port('name')`, `@X.driver()`, `X.for()`), provided by `@elysiumjs/bun`, `@elysiumjs/node`, `@elysiumjs/workers`, `@elysiumjs/redis`, `@elysiumjs/drizzle` and `@elysiumjs/pino`.

### Patch Changes

- [#112](https://github.com/na2axl/elysiumjs/pull/112) [`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023) Thanks [@na2axl](https://github.com/na2axl)! - `@Abilities.rules()` accepts rules classes over the facts the application declares, and `@Upload.purpose()` accepts purposes whose constructor injects services.

## 0.24.1

### Patch Changes

- [#99](https://github.com/na2axl/elysiumjs/pull/99) [`2cfba22`](https://github.com/na2axl/elysiumjs/commit/2cfba227331e720b8ff79a6a4cdfeb3c251a450e) Thanks [@na2axl](https://github.com/na2axl)! - Command spinners and progress bars write plain lines when the runtime has no terminal, such as the workers runtime, instead of throwing `RuntimeNotSupportedError`. Prompts still throw.

## 0.24.0

### Minor Changes

- [#91](https://github.com/na2axl/elysiumjs/pull/91) [`94c990e`](https://github.com/na2axl/elysiumjs/commit/94c990e794e91a1b3ed3bc005ebd7e535b862e8d) Thanks [@na2axl](https://github.com/na2axl)! - Seeders: `@Seeder.register()` classes listed in a module's `seeders`, run by `styx db:seed` in their module and in a transaction of their own, ordered by `after` (seeder classes), with default names from the module and class, `manual`, `env`, `connection`, `--only`, `--file`, `--arg` and `--list`. `styx make:seeder` generates one. Packages add their own module lists by augmenting `ModuleCollections`.

## 0.23.1

### Patch Changes

- [#87](https://github.com/na2axl/elysiumjs/pull/87) [`17bfb6b`](https://github.com/na2axl/elysiumjs/commit/17bfb6b8be3b7b12a1bfb5f658569ce42358c4eb) Thanks [@na2axl](https://github.com/na2axl)! - `Resource.serialize` serializes an object through the union branch it belongs to: the first object branch whose required properties it has and whose literals it matches, keeping the most of its properties. It used to take the first object branch, which stripped the fields of the others.

## 0.23.0

### Minor Changes

- [#82](https://github.com/na2axl/elysiumjs/pull/82) [`8235094`](https://github.com/na2axl/elysiumjs/commit/823509464b9f71a80fdac117418b7e3e1213103c) Thanks [@na2axl](https://github.com/na2axl)! - `authorize()` and `validate()` are optional on a validator class: core calls each one only when the class has it, so a validator that holds only its schema works.

## 0.22.0

### Minor Changes

- [#79](https://github.com/na2axl/elysiumjs/pull/79) [`791048c`](https://github.com/na2axl/elysiumjs/commit/791048ca9eca4c69a8cb199482541fe95327c786) Thanks [@na2axl](https://github.com/na2axl)! - Add `Result` and `AsyncResult`: the outcome of a check or a call, passed with a value or failed with a `DomainError`. They narrow with `check()`, and offer `orThrow()`, `orError()`, `errorOr(transform)`, `map(transform)` and `andThen(next)`. A handler that returns a `Result` or an `AsyncResult` answers its value, or its problem.

## 0.21.0

### Minor Changes

- [#74](https://github.com/na2axl/elysiumjs/pull/74) [`5b79d5a`](https://github.com/na2axl/elysiumjs/commit/5b79d5a4b634347ce18766ef08aec12916328ff6) Thanks [@na2axl](https://github.com/na2axl)! - `Service.require()` returns a service the code needs, visible from the current module context, at once, and throws a precise error when it is missing: `ServiceNotFoundError`, `ServiceNotVisibleError` or the environment errors, like `Service.resolve()`, which waits for the service's initialisation.

- [#77](https://github.com/na2axl/elysiumjs/pull/77) [`9bd29cb`](https://github.com/na2axl/elysiumjs/commit/9bd29cbd10131e4465505de91c78e7f39d242e71) Thanks [@na2axl](https://github.com/na2axl)! - Add `styx routes:check`, which fails when a route declares no schema for its success response. `Http.describe()` now gives the `status` of each route and whether it `responds` with a declared success schema.

## 0.20.0

### Minor Changes

- [#73](https://github.com/na2axl/elysiumjs/pull/73) [`920b941`](https://github.com/na2axl/elysiumjs/commit/920b941a9c070c9006fe277abc7a187b9d140af7) Thanks [@na2axl](https://github.com/na2axl)! - `@Background.scope()` registers a service that wraps every unit of background work, the way interceptors wrap requests: heracles jobs (`kind: 'job'`), moirai event handlers (`'event'`) and outbox handlers (`'outbox'`) run inside the scopes, which nest in registration order. `Service.invoke(target, method, args)` calls a method whose parameters take services. Heracles types the constructor arguments of every job class in `Heracles.dispatch()`, scheduler cases and `JobClass<any, any>`, and the parameters of `execute()` take services with `@Service.inject()`. `heracles:schedule --list` prints the scheduled jobs and their cron triggers, and `--check <wrangler.jsonc>` fails when the `triggers.crons` of the file differ from them.

- [#67](https://github.com/na2axl/elysiumjs/pull/67) [`9901020`](https://github.com/na2axl/elysiumjs/commit/99010200522c56bb37cbc44c7ffa311d69972599) Thanks [@na2axl](https://github.com/na2axl)! - `Clock` in core: `Clock.now()` and `Clock.epochMs()` give the application time, which `Clock.freeze()` and `Clock.travel()` stop or move in development and test, and `Clock.use()` takes from another source. Moirai (event, stream, projection and outbox instants, idempotency records), the projection store of moirai-drizzle, Heracles scheduler ticks and Themis (JWT issue and expiry checks, sessions, signed URLs, TOTP) read the time from it.

- [#68](https://github.com/na2axl/elysiumjs/pull/68) [`7dc7c59`](https://github.com/na2axl/elysiumjs/commit/7dc7c59f67b9f62159064f7958f529f4e6e27e65) Thanks [@na2axl](https://github.com/na2axl)! - Routes take a success `status` (`@Http.post('/', { status: 201 })`, `@Http.del('/:id', { status: 204 })` without a body), documented with the response schema. `Http.currentContext()` gives the context of the request being handled outside its handler. `Service.extension()` makes an extension point: a tag, a decorator that registers a service with its options, and `all()`, `find()` and `optionsOf()`, which refuse two services with the same name. Themis adds `@Auth.user()` for handler parameters, `Auth.currentUser()` returns the user of the request, and an `AuthUser` interface that apps augment to type the user everywhere.

## 0.19.0

### Minor Changes

- [#59](https://github.com/na2axl/elysiumjs/pull/59) [`af05b49`](https://github.com/na2axl/elysiumjs/commit/af05b498a2c4d4dafda44f361fe68c490f49a8c7) Thanks [@na2axl](https://github.com/na2axl)! - `Http.RouteTypes` is the tag of route types contributors (`HttpRouteTypesContributor`), which type routes in `styx routes:generate` when the controller method signature does not, such as routes a decorator adds. `Service.tagsOf()` gives the tags of a service class.

- [#61](https://github.com/na2axl/elysiumjs/pull/61) [`7ffe5eb`](https://github.com/na2axl/elysiumjs/commit/7ffe5eb3926d8a428c6cb14fdc9437758d4c99b5) Thanks [@na2axl](https://github.com/na2axl)! - Routes take a `parse` option: how the request body is parsed before the handler runs (`none`, `text`, `json`, `formdata`, `urlencoded` or `arrayBuffer`). By default it follows the request's `Content-Type`. `parse: 'none'` leaves the body unread, so the handler reads it from the request, such as to check a webhook signature over the exact bytes. A route with `parse: 'none'` cannot take `@Http.body()`: mounting it throws.

## 0.18.0

### Minor Changes

- [#57](https://github.com/na2axl/elysiumjs/pull/57) [`d471a6e`](https://github.com/na2axl/elysiumjs/commit/d471a6e69736e016eb972a0715987df1d7b62438) Thanks [@na2axl](https://github.com/na2axl)! - Services, factory definitions, HTTP controllers, commands and jobs take an `env` option, as modules do: the `NODE_ENV` values in which they are active. In any other environment they are left out when their module loads: an inactive service is not registered (nor returned by `injectAll`), an inactive controller mounts no routes, an inactive command is not listed and an inactive job is neither dispatched nor scheduled. `Environments` reads and records them, and `ModuleGraph.own()` lists the active controllers, commands or jobs of a module. Commands no longer have a static `dev` flag: `@Command.register({ env })` (or the module's `env`) says where a command is available.

  Elysium knows three environments: `development`, `test` and `production`. `Environment` types every `env` option and `currentEnvironment()`, still accepting an app's own names such as `staging`. `Environments.isDevelopment()`, `isTest()` and `isProduction()` tell which one is current, and `Environments.local` (`['development', 'test']`) lists the environments that run on a developer's machine. The detail and stack of server errors are shown in `test` as well as in `development`.

## 0.17.1

### Patch Changes

- [#54](https://github.com/na2axl/elysiumjs/pull/54) [`ec07c41`](https://github.com/na2axl/elysiumjs/commit/ec07c410c417053df4e284d8ddc6d2c4da4e42ec) Thanks [@na2axl](https://github.com/na2axl)! - When `server.port` is not set, the app listens on the validated `PORT` variable from its environment schema, then the raw `PORT` variable, then `3000`.

## 0.17.0

### Minor Changes

- [#52](https://github.com/na2axl/elysiumjs/pull/52) [`762661e`](https://github.com/na2axl/elysiumjs/commit/762661e362444f431ea84576494322a9a7a81539) Thanks [@na2axl](https://github.com/na2axl)! - `Env.get()` is typed from the environment schemas:

  - `AppEnv` is empty in core. The app and its modules augment it next to their schemas with `interface AppEnv extends Env.Infer<typeof schema> {}`. Once any variable is declared, `Env.get()` only accepts declared names and returns their validated types, with a `Secret` for each `Secret.schema()` variable. Without any, it takes any name and returns the raw string.
  - `Env.Infer<typeof schema>` gives the validated type of an environment schema, and `Secret.schema()` keeps the type of its schema.
  - In an app with an `env` schema, reading `Env` before the environment is validated throws `EnvironmentNotReadyError`, instead of returning raw values.

## 0.16.0

### Minor Changes

- [#50](https://github.com/na2axl/elysiumjs/pull/50) [`afcb25c`](https://github.com/na2axl/elysiumjs/commit/afcb25c31ee29f358a46bc801dba8ecf53f30df9) Thanks [@na2axl](https://github.com/na2axl)! - Routes document their problems. `DomainError.for(code, status, { extensions, description })` gives the class static `code`, `status` and `schema` (problem details with the literal code and status, and the extension members, which also type the constructor's `extensions`). The `errors` route option lists the problem classes of a route; OpenAPI documents them under their status, one union per status, next to those of the framework (422 validation, 400 malformed requests, 413 body limit, 429 rate limits, 500) and those that middlewares, interceptors and validators list in a static `errors`. `TransformInterceptor.with(transform, { schema })` describes what the interceptor returns, so routes declare the result of their handler and the transformed schema is documented, validated and serialized. New `InternalError` and `validationExtensions()`.

## 0.15.0

### Minor Changes

- [#48](https://github.com/na2axl/elysiumjs/pull/48) [`d663d2e`](https://github.com/na2axl/elysiumjs/commit/d663d2ed95778079f71e53fcaf60a7f8ef570f6d) Thanks [@na2axl](https://github.com/na2axl)! - Routes declare request headers: `@Http.header(name, schema?)` gives a header to the handler, and the `headers` route option declares the others. Both are validated before the handler runs and documented in OpenAPI. Missing or malformed headers get a 400 `BAD_REQUEST` problem with an `errors` list.

## 0.14.0

### Minor Changes

- [#46](https://github.com/na2axl/elysiumjs/pull/46) [`359f157`](https://github.com/na2axl/elysiumjs/commit/359f1579b9ad69643da5360d9ca9e80104fbe2f1) Thanks [@na2axl](https://github.com/na2axl)! - The OpenAPI document describes request bodies and query parameters:

  - `@Http.query(schema)` schemas are passed to Elysia, so the query is validated (422 when it does not match) and documented.
  - The body limit reads bodies sent without a content-length in `onRequest` instead of a global parser, so Elysia keeps its own parsers and each body keeps its media types in the document.

## 0.13.0

### Minor Changes

- [#38](https://github.com/na2axl/elysiumjs/pull/38) [`c8d9f53`](https://github.com/na2axl/elysiumjs/commit/c8d9f534eef32621eae121f7008f97dc24808141) Thanks [@na2axl](https://github.com/na2axl)! - A validator's `validate` and `authorize` may return a `DomainError`, answered as is with its own status, code and extensions. `false` still answers a generic 400 from `validate` and a 401 from `authorize`.

## 0.12.0

### Minor Changes

- [#32](https://github.com/na2axl/elysiumjs/pull/32) [`651a755`](https://github.com/na2axl/elysiumjs/commit/651a7557173ce2c6155bcfa8d90cf388ac419821) Thanks [@na2axl](https://github.com/na2axl)! - Add service tags (multi-binding). `Service.tag<T>(name)` creates a tag, `@Service.register({ tags })` (or `tags` on a factory definition) adds a service to it, and `@Service.injectAll(tag)`, `Service.getAll(tag)` and `Service.resolveAll(tag)` give every tagged service of the application in registration order. Tagged services follow the usual scope rules, and an overridden service keeps its tags.

## 0.11.2

### Patch Changes

- [#30](https://github.com/na2axl/elysiumjs/pull/30) [`79c5c18`](https://github.com/na2axl/elysiumjs/commit/79c5c180f48e31b0be083beb84f6f6c60752a9bf) Thanks [@na2axl](https://github.com/na2axl)! - The OpenAPI page is served on Cloudflare Workers when the app is compiled ahead of time: on the Workers runtime the page embeds the spec, so the route compiled by the build matches the one workerd mounts.

## 0.11.1

### Patch Changes

- [#26](https://github.com/na2axl/elysiumjs/pull/26) [`4cd1ef2`](https://github.com/na2axl/elysiumjs/commit/4cd1ef217826164e69cd641ca99f74c6f5a7ebe7) Thanks [@na2axl](https://github.com/na2axl)! - Type the query string of the query DSL. `Query.define` keeps the names of the filters, their operators and the sortable fields, `Query.Params<typeof spec>` types the parameter that `@Http.query()` decorates (`filter[status]`, `filter[status][in]`, `sort`, `cursor`, `limit`, `fields`, each an optional string), and `Query.schema(spec)` returns a schema of that type. Because the generated routes read the parameter's type, clients get typed query keys. Core re-exports TypeBox's `TOptional` and `TString` types.

## 0.11.0

### Minor Changes

- [#8](https://github.com/na2axl/elysiumjs/pull/8) [`6bc48fe`](https://github.com/na2axl/elysiumjs/commit/6bc48febd51f7090c582e73f349eaeff7261241c) Thanks [@na2axl](https://github.com/na2axl)! - `Application.build()` builds the root Elysia app without listening, for hosts that own the server (Cloudflare Workers) and for ahead-of-time compilation with `elysia/plugin/aot`. Modules are registered but boot on the first request (once, shared by concurrent requests), so building runs no `onInit` work. A boot failure fails the requests.

  HTTP and websocket controllers in the server scope, and middlewares, are now built on their first request instead of when the app is built. `serve` still boots every module before listening.

  `@elysiumjs/runtime-workers` gets a `check:aot` script, run in CI: it compiles a sample app with the AOT plugin for workerd, checks that the bundle holds no `new Function` or `eval`, and serves a validated route and the OpenAPI document under Node.js with code generation from strings disallowed.

- [#7](https://github.com/na2axl/elysiumjs/pull/7) [`e9c3d98`](https://github.com/na2axl/elysiumjs/commit/e9c3d98dd2714b69100215f7c8a80046da463148) Thanks [@na2axl](https://github.com/na2axl)! - Elysium runs on Elysia 2 (`elysia@^2.0.0-rc.1`), with TypeBox 1 (`typebox`), `@elysia/openapi` and `@elysia/opentelemetry`.

  Breaking:

  - `TSchema` and `Static` are re-exported from `typebox` instead of `@sinclair/typebox`; `Value` comes from `typebox/value` and `Value.Errors()` returns an array.
  - `Application.onError()` receives a `ServerError` (exported from core). Elysia now names its errors in kebab case; the default error response keeps the upper snake case names (`VALIDATION`, `NOT_FOUND`, `UNKNOWN` for other errors).
  - `AppHttpContext` is a plain interface with `decorator`, `store` and `derive` records (Elysia 2 renamed `resolve` to `derive`).
  - Websocket controllers install Elysia's `websocket()` capability themselves.

  A module or controller `onRequest` middleware that answers now stops the request: Elysia 2 ignores values returned from a transform hook, so the response is thrown as a status and sent as is, without going through `onError`.

  `mnemosyne` builds date columns with `t.Codec` (TypeBox 1 dropped `Transform`). `argus` traces every route of the app it is installed on and ends each span once, keeping the error status when the request failed.

- [#5](https://github.com/na2axl/elysiumjs/pull/5) [`557a3ca`](https://github.com/na2axl/elysiumjs/commit/557a3cab7af8053a8bab9944e492e5022d91aa82) Thanks [@na2axl](https://github.com/na2axl)! - Core runs outside Bun. Environment variables, timers, the HTTP server, process exit and shutdown signals now come from a `Runtime` set with the new `runtime` option of `@Application.register()` or with `Runtime.use()`. Runtimes ship as packages, each exporting `runtime`: `@elysiumjs/runtime-bun`, `@elysiumjs/runtime-node` and `@elysiumjs/runtime-workers` (which also exports `createRuntime({ env })`).

  Breaking: an application needs a runtime (add `runtime` from `@elysiumjs/runtime-bun`), and `Redis` and `RedisModule` moved from core to the new `@elysiumjs/redis` package, which also accepts a `client` factory for runtimes without `Bun.RedisClient`.

  Console colours are plain ANSI codes instead of `Bun.color`, `node:readline` is loaded only when a prompt runs, and core's dist is built for the `node` target so `node:` imports keep their prefix. `check:runtime` scripts in core and runtime-workers fail when their bundles touch the `Bun` global.

  `create-elysium` gets a runtime step: it installs the chosen runtime package and sets it in the generated app. Bun is selectable today; Node.js and Cloudflare Workers are listed as coming later.

- [#24](https://github.com/na2axl/elysiumjs/pull/24) [`ccc3f5b`](https://github.com/na2axl/elysiumjs/commit/ccc3f5bb904d1bf52d8c72ebf7ea8d10f617a8c4) Thanks [@na2axl](https://github.com/na2axl)! - `Service.ownersOf(service)` lists the modules that declare a service in their own scope, and `ModuleContext.outside(fn)` runs code outside of any module, so that lookups only see the global scope.

- [#19](https://github.com/na2axl/elysiumjs/pull/19) [`6789879`](https://github.com/na2axl/elysiumjs/commit/678987976ecfd46b534b65276e0de3f448977562) Thanks [@na2axl](https://github.com/na2axl)! - Domain errors as classes with a code, returned as values.

  - `DomainError` is an Elysia `HTTPError`. Each error is a class made with `DomainError.for(code, status)`, which keeps its code and status as literal types, with `errors`, `retryAfterSeconds` (served as `retryAfter` and the Retry-After header) and extensions.
  - Ready-made errors: `BadRequestError`, `ValidationFailedError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError` and `ConflictError`.
  - `ProblemCatalogue`, extended through declaration merging, lists the codes of an application; once it has keys, `DomainError.for()` takes only those and `ELYSIUM_PROBLEM_CODES`.
  - Every problem carries `code`, `requestId` (from `problems.requestId`, a valid `x-request-id` header, or a random UUID) and `instance`. Its `type` is the kebab-case slug of the code, under `problems.typeBase`.
  - Errors as values: a handler, a flow step, `UnitOfWork.run()` or a `@Transactional()` method that returns a DomainError rolls back and sends or returns it like a thrown one. `Commands.execute()` and `Queries.ask()` return the DomainError that refused the call, and a returned error joins the route's response type for typed clients.

- [#20](https://github.com/na2axl/elysiumjs/pull/20) [`87299fd`](https://github.com/na2axl/elysiumjs/commit/87299fd9da82d1a408ced1891c0c3d42991444e5) Thanks [@na2axl](https://github.com/na2axl)! - The framework event bus is `Lifecycle`: `Lifecycle.on`, `Lifecycle.once`, `Lifecycle.emit`, `Lifecycle.off`, `@Lifecycle.on()` and `@Lifecycle.once()`, with the `LifecycleEvent` and `LifecycleHandler` types. It carries the framework's own signals (`elysium:error`, app and server lifecycle, heracles queue events) and in-process listeners.

- [#22](https://github.com/na2axl/elysiumjs/pull/22) [`bee66bd`](https://github.com/na2axl/elysiumjs/commit/bee66bdc874b8f23fea356f7d3adf7555a48ca64) Thanks [@na2axl](https://github.com/na2axl)! - Decorators take their main identifier first and their options second.

  - `@Http.controller(path, options)` and the route decorators `@Http.get(path, options)`, `post`, `put`, `patch`, `del`, `head`, `options`, `trace` and `sse`. The path defaults to `/`. `@Http.custom(method, path, options)` takes its method first. The options are `HttpControllerOptions` and `HttpRouteOptions`.
  - `@Websocket.controller(path, options)`, where the options are those of the websocket server.
  - `@Flow.controller(name, options)`, and `@Flow.step(name, options)` or `@Flow.step(options)` for a step named after its method.
  - `@Lifecycle.on(event, options)` and `@Lifecycle.once(event, options)`, like their function forms `Lifecycle.on(event, handler)`.
  - The styx controller stubs generate the same forms.

- [#10](https://github.com/na2axl/elysiumjs/pull/10) [`0057b67`](https://github.com/na2axl/elysiumjs/commit/0057b67df0e3abecab8a9accff6b55a6a64c21df) Thanks [@na2axl](https://github.com/na2axl)! - `styx routes:generate` writes the route types of an app to `src/routes.gen.ts`: an `AppRoutes` type for Eden (`treaty<AppRoutes>(url)`), built from the controllers of every module. Request types come from the method parameters decorated with `@Http.param`, `@Http.query` and `@Http.body`, and response types from the method return types. The file holds types only; requests are served by the decorated controllers. New projects run the command in their `typecheck` script and keep the file out of git.

  `Http.describe(controller)` reports the routes of an HTTP controller, and `Application.moduleGraph()` builds the module graph of an app class without booting it.

- [#11](https://github.com/na2axl/elysiumjs/pull/11) [`632d77b`](https://github.com/na2axl/elysiumjs/commit/632d77b561fc43ade605fb69b06ac1b9b9a2ffc4) Thanks [@na2axl](https://github.com/na2axl)! - Services are identified by their class, or by the name given to `@Service.register({ name })`. Class names are never used as identifiers, so services resolve the same way in minified builds; `bun run check:minified` in core bundles a minified app and checks that every service resolves. `@Service.inject()` without an argument injects the class of the parameter type, and throws when the type is unknown. Factory services in a module's `services` take a class or a name in `name`.

  `ServiceScope.REQUEST` gives one instance per HTTP request, shared by the request's middlewares, controller and handler. `Service.runInRequestScope(fn)` opens a request scope outside a route. Resolving a request-scoped service outside a request throws `OutsideRequestScopeError`, and a singleton (or a server-scoped controller) depending on one throws `ScopeMismatchError`.

  `HermesModule` registers the logger by the `HermesLogger` class and as `logger`.

- [#13](https://github.com/na2axl/elysiumjs/pull/13) [`1ea417e`](https://github.com/na2axl/elysiumjs/commit/1ea417e3583250bc2f975d795f398b7ff736115d) Thanks [@na2axl](https://github.com/na2axl)! - Hardening of the runtimes, the container and the CLI, checked by a conformance suite that runs on Bun, Node.js and workerd.

  Breaking changes:

  - `Runtime` gains the required `argv()`, `write(stream, text)` and `terminal()` members: core reaches the host's arguments, output streams and terminal only through the runtime. Custom runtimes must implement them.
  - The third parameter of `InteractsWithConsole.write` is now `'stdout' | 'stderr'`.
  - The WebSocket options are narrowed to `idleTimeout`, `maxPayloadLength` and `perMessageDeflate`, and the `bun` WebSocket types are replaced by `ElysiumWebSocket`.
  - Redis connections are `RedisConnection`s, a port any Redis client can implement, instead of `Bun.RedisClient`.
  - `styx create @scope/name` creates the project in `name/`, and refuses project and module names with upper-case letters.
  - Queue handlers no longer reject the batch: after the handlers ran, each message is acked or retried on its own. `@Workers.queue(name, { each: true })` receives one message at a time, so a failure retries only that message.

  Fixes:

  - Request-scoped services are destroyed when the request ends, also on failure, and an async `onInit` is awaited. A second dispose of a request scope waits for the one in progress, so a Worker's `waitUntil` covers an async `onDestroy`.
  - A failed module or service `onInit` no longer breaks later requests: the boot is retried, and the module's event listeners are unwired.
  - `@elysiumjs/runtime-node` serves through `node:http`, keeping the Host header authoritative.
  - `styx create` validates names before creating files, ships `.gitignore`, declares the dependencies of created projects and imports their default controllers.

- [#14](https://github.com/na2axl/elysiumjs/pull/14) [`0956186`](https://github.com/na2axl/elysiumjs/commit/0956186db0ca5a83c0a6636aeb2a4c81a0033de4) Thanks [@na2axl](https://github.com/na2axl)! - The request pipeline: problem details, exception filters, interceptors, typed configuration, HTTP security options and an HTTP test client, checked on Bun, Node.js, workerd and AOT-compiled Workers.

  Breaking changes:

  - Error responses are RFC 9457 problem details (`application/problem+json`). Request validation errors answer 422 with an `errors` list of JSON pointers (`problems.validationStatus: 400` keeps 400). Server errors only show their message and stack in development. Thrown statuses (`c.status(...)`) are sent as they are.
  - Client errors (4xx) are no longer reported to `onError`, the `elysium:error` event or the trace.
  - `Runtime.serve` may return a handle with `close()`, which the application calls on shutdown.
  - Request bodies are limited to 1 MiB by default (`http.bodyLimit`), also when chunked.
  - The environment schema is validated when the app is built or run, with every error reported at once, instead of in the constructor.

  Features:

  - `DomainError`, with `status`, `type`, `title`, `detail` and extensions, and shortcuts such as `DomainError.notFound()`.
  - Exception filters (`@Catch()`, `filters` on routes, controllers, modules and the app) and interceptors (`interceptors` on the same levels), with `TimingInterceptor`, `TransformInterceptor` and mnemosyne's `CacheInterceptor`.
  - Typed configuration: `Secret` values, module `envSchema`s merged into the app's, `InvalidEnvironmentError`.
  - `http` options: CORS, security headers, body limits and trusted proxies (`ctx.ip`). Runtimes report the client address through `clientAddress`.
  - `createTestingHttpApp` and `createHttpClient` send requests to an app in memory, with `expectStatus()`.

  Fixes:

  - App-level `onRequest` middlewares run in the request scope.
  - On Workers, the request scope of a streamed response is disposed when the body ends, not when `fetch` returns.
  - `KeyvWorkersKV.clear()` stays within an operation budget (`maxOperations`).
  - The Node.js bridge treats a destroyed socket as a client abort.
  - Heracles performance metrics report through the Redis port (`connection` or `client`), not a Bun client.
  - `styx routes:generate` names anonymous default controllers after their file; `styx create` pins `@elysiumjs/*` packages to the versions it was released with; invalid names are reported as Elysium errors.

- [#15](https://github.com/na2axl/elysiumjs/pull/15) [`fbcc7da`](https://github.com/na2axl/elysiumjs/commit/fbcc7dad127db29da42e7a4a5c2124966731cd88) Thanks [@na2axl](https://github.com/na2axl)! - Resources, queries, units of work and rate limits.

  Breaking:

  - A route with a `response` schema serializes its handler result through it: fields the schema does not declare are dropped, a `Date` becomes an ISO string (`YYYY-MM-DD` for `format: 'date'`), and an object with `toJSON()` becomes what it returns. Set `serialize: false` on a route to send the result as it is.

  Added:

  - `Resource.hidden(schema)` marks a field that never reaches responses nor the OpenAPI document. `Resource.serialize()` and `Resource.project()` are exported for use outside routes.
  - Sparse fieldsets: `?fields=id,title` keeps only those fields of an object, of each item of an array, or of each item of a `data` array. An unknown or hidden field answers a 400 problem.
  - Rate limits with `@RateLimit({ window, max, key?, store?, name? })` on routes and controllers (`@RateLimit(false)` turns one off), and a default limit and store in the app's `rateLimit` option, with fixed windows. Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and `RateLimit-Policy`; a client over the limit gets a 429 problem with `Retry-After`. Counts are kept by a `RateLimitStore`: `MemoryRateLimitStore` (core), `RedisRateLimitStore` (`@elysiumjs/redis`) or `WorkersRateLimitStore` over a Cloudflare rate limiting binding (`@elysiumjs/runtime-workers`), which only decides whether a hit is over the limit, so its responses carry no `RateLimit-Reset`.
  - `ModelResource(model, { hidden, pick, omit, extend })` (`@elysiumjs/mnemosyne`) builds a response schema from a model.
  - `Query.define(model, spec)` declares the filters (`filter[field][op]=value`), sorts, page size and cursor a list accepts; `Query.schema()` gives its query schema, `Query.parse()` turns a request query into a `ParsedQuery` and answers a 400 problem with a pointer per mistake, and `Query.page()` / `Query.pageSchema()` build cursor pages (`{ data, nextCursor }`).
  - `DrizzleRepository.list(query)` and `count(query)` run a `ParsedQuery` with keyset pagination (`@elysiumjs/mnemosyne-drizzle`), and `compileQuery()` gives its `where` and `orderBy`.
  - Units of work: `UnitOfWork.run()` and the `@Transactional()` method decorator run work in one transaction, and `UnitOfWork.afterCommit()` / `afterRollback()` defer work, such as sending a message, until the outermost transaction has ended. `transactional` routes open a unit of work too.

- [#16](https://github.com/na2axl/elysiumjs/pull/16) [`ac96e55`](https://github.com/na2axl/elysiumjs/commit/ac96e55874b0ffe350b287c4278cd85afecb7576) Thanks [@na2axl](https://github.com/na2axl)! - Redis, databases, logs, jobs and builds on Bun, Node.js and Cloudflare Workers.

  Breaking:

  - The level shortcuts of `InteractsWithConsole` (`info`, `success`, `warning`, `error` and `debug`) write a tag (`[I]`, `[S]`, `[W]`, `[E]` and `[D]`, in color) before the message, which `InteractsWithConsole.useTags()` changes. `trace()` writes to stderr.
  - Outside Bun, a Drizzle connection needs a `driver`. Without one, the `connection` and `client` props are a Bun SQL connection, which is only available on Bun; elsewhere the connection throws `MissingDriverError`, which names the drivers.

  Added:

  - Redis adapters (`@elysiumjs/redis`): `ioredis(create)` plugs an ioredis client into the Redis port on Node.js, and `upstash({ token, url?, fetch? })` talks to Upstash over its REST API, for Workers (no pub/sub). `bunRedis` explains which adapter to use when it runs outside Bun.
  - Drizzle drivers (`@elysiumjs/mnemosyne-drizzle`): a `DrizzleDriver` port set with the `driver` prop of a connection, and drivers on subpaths so that only the chosen database client is imported: `/bun-sql` (`bunSql()`), `/postgres-js` (`postgresJs()`), `/node-postgres` (`nodePostgres()`) and `/hyperdrive` (`hyperdrive({ binding, driver })`, a client per Worker invocation over a Cloudflare Hyperdrive binding). `DrizzleModule` closes connections through their driver, and `migration:run` runs on any driver.
  - `InteractsWithConsole.write()` and `Runtime.write()` take the level of the line (`OutputLevel`), which the level shortcuts pass. On Cloudflare Workers, a line is written with the console method of its level, so Workers Logs keep it.
  - `JsonConsoleLogger` (`@elysiumjs/hermes`): JSON lines through the console of the runtime (warnings and errors on stderr), with levels, error serialization and `child()`. `HermesModule.with({ transport: 'console' | 'pino' })` picks it, and it is the default on Workers. `RequestLogInterceptor` writes one structured line per request: method, route, status, duration, client address and request id.
  - Scheduled jobs (`@elysiumjs/heracles`): `@Schedule(cron, { timezone, args })` on a job class, a five-field cron parser (`Cron`, with lists, ranges, steps and names), and a `Scheduler` that dispatches the jobs on time on Bun and Node.js, taking a Redis lock per tick when a Redis connection is set. The `heracles:schedule` command runs it.
  - `@elysiumjs/heracles-workers`: `CloudflareQueueTransport` sends jobs to a Cloudflare Queue (dispatch delays become `delaySeconds`), and `HeraclesWorkersModule` consumes them in the Worker's `queue` handler (ack on success, retry with a delay up to the job's retries) and dispatches the `@Schedule()` jobs whose expression is the cron of a trigger.
  - Queue handlers (`@elysiumjs/runtime-workers`) can settle a message themselves with `ack()` or `retry({ delaySeconds })`; the messages they leave are acked when no handler failed on them.
  - `styx build --target node` (`@elysiumjs/hephaestus`) bundles the app into one ES module for Node.js, with decorator metadata emitted at build time, run with `node dist/server.js serve`. `styx build --target workers` runs from the CLI, resolves packages to their browser entry, and leaves Node.js modules imported by bare names to workerd (`nodejs_compat`).
  - `styx create` (`@elysiumjs/styx`) takes `--runtime bun|node|workers`, `--database`, `--cache` and `--package-manager bun|npm|pnpm`. Each runtime gets its entry, tsconfig types, scripts and drivers: postgres.js and ioredis on Node.js; Hyperdrive, Upstash, console logs and a `wrangler.jsonc` on Workers.

- [#12](https://github.com/na2axl/elysiumjs/pull/12) [`98a16aa`](https://github.com/na2axl/elysiumjs/commit/98a16aae889d46f7a9fb5573188f4cbe3629dd3b) Thanks [@na2axl](https://github.com/na2axl)! - `createWorker(app)` from `@elysiumjs/runtime-workers` builds an application and returns the handlers a Cloudflare Worker exports: `fetch` serves the routes, `queue` hands each batch to the service methods marked `@Workers.queue(name)`, and `scheduled` calls the methods marked `@Workers.cron(expression)`. Each invocation runs with its own env and execution context: `Workers.env()`, `Workers.context()` and `Workers.binding(name)` read them, and `WorkersModule` provides them, and the bindings it lists, as request-scoped services injected with `@Workers.inject(name)`. `KeyvWorkersKV` stores mnemosyne caches in a KV namespace. `bun run check:wrangler` runs a sample Worker in `wrangler dev`.

  `MnemosyneModule` takes other Keyv stores in `cache.stores`, read with `Cache.store(name)`.

  `styx build --target workers` (Hephaestus `hephaestus:build --target workers`, `WorkersBuilder`) bundles a Worker with its routes compiled ahead of time and refuses a bundle that generates code at runtime.

  In core, `Application.boot()` initialises the modules once, for hosts that handle more than requests; `Kernel.serviceClasses(node)` lists the service classes of a module; console output falls back to `console` where the host has no output streams; and a singleton depending on a request-scoped service throws `ScopeMismatchError` even when it is built outside a request.

## 0.10.0

### Minor Changes

- [`68a0cdd`](https://github.com/na2axl/elysiumjs/commit/68a0cdd8b2e4a003d6e0af2d78985623cae40428) Thanks [@na2axl](https://github.com/na2axl)! - Route the framework's own diagnostics through the logger service.

  Breaking changes:

  - `@Event.listen()` with a mode other than `on` or `once` now throws an `ElysiumError` when the class is defined, instead of logging to the console and ignoring the listener.

  Fixes and additions:

  - `getLogger(context?)` and `LOGGER_SERVICE` (`'logger'`) are exported by `@elysiumjs/core`. `getLogger()` returns the `logger` service when one is registered (such as the one `HermesModule` provides), and a `ConsoleLogger` otherwise or when the service cannot be built or fails to create a child logger. It is resolved at call time from the global scope only, so a module's own `logger` service does not replace it, and returns a child logger bound to `context` when one is given.
  - `Middleware.logger` (used by `RequestLoggerMiddleware`) falls back to a `ConsoleLogger` when no `logger` service is registered. It threw before.
  - Core diagnostics go through the logger with structured context instead of `console.*`: the debug-mode request log (`debug`, with `method` and `url`), `onDestroy` failures on shutdown (`error`, with `target` and `error`), WAMP connection attempts (`warn` while retrying, `error` when giving up, with `connection`, `attempt`/`attempts`, `maxRetries` and `error`), and WAMP registrations and subscriptions (`info`, with `connection`, `topic` and the registration or subscription id).
  - In debug mode, incoming requests are logged through the logger at `debug` level instead of printed with `console.log`. With `HermesModule`, they show only when its `level` is `debug` or `trace`.
  - A failed WAMP registration or subscription is logged at `error` level and emitted as `elysium:error` with an error naming the topic and the connection, instead of becoming an unhandled rejection.
  - The `elysium:error` emitted for a WAMP client error names the connection and its URL and includes the client's message (or the value it reported, when it is not an `Error`), with that value as `cause` when there is one.
  - `HermesLogger` serialises an `error` field of the log context like pino's `err` (type, message and stack), so logged errors keep their stack trace. Elysium logs errors under `error`.
  - `@Logged` resolves its fallback logger with `getLogger()`, and logs a thrown error whole under `error` (it logged only its message), so its stack trace is kept.
  - The `elysium:error` emitted when a WAMP connection gives up states the number of attempts actually made (the first one plus the retries), as the logged `attempts` does. It stated `maxRetries` before.

- [`76ba0ff`](https://github.com/na2axl/elysiumjs/commit/76ba0ff18f3c196cebc2189426328f67cb699f46) Thanks [@na2axl](https://github.com/na2axl)! - `onRequest` middlewares registered on a module or a controller now run only for its routes. Elysia runs `onRequest` hooks on every request of the app, so such a middleware could reject requests meant for other modules.

  They now run in the transform step of their own routes, so after routing and body parsing, and each one runs right before its own `onTransform`: module `onRequest`, module `onTransform`, then controller `onRequest`, controller `onTransform`. Any value they return still stops the request and is sent as the response. Application middlewares still run `onRequest` before routing, for every request.

- [`bacce71`](https://github.com/na2axl/elysiumjs/commit/bacce7146f667a1a46bf474dc0344fb0111ae12a) Thanks [@na2axl](https://github.com/na2axl)! - WebSocket controllers now run the middlewares registered on them with `@Middleware.register()`, on the upgrade request. `onRequest`, `onTransform` and `onBeforeHandle` can refuse the connection by returning a response. `onAfterHandle` and `onAfterResponse` run after the upgrade, with no response to read.

### Patch Changes

- [`2c49acd`](https://github.com/na2axl/elysiumjs/commit/2c49acd3b552aa43765d70339fa216961499e1b5) Thanks [@na2axl](https://github.com/na2axl)! - The tenant set by a middleware, such as a `TenantMiddleware` reading its own header, is no longer replaced by the `x-tenant-id` header (or `public`) before the handler runs.

- [`4ebf029`](https://github.com/na2axl/elysiumjs/commit/4ebf029611e6d753a4f1bfdbe247a75d954d9ded) Thanks [@na2axl](https://github.com/na2axl)! - WAMP clients use Bun's own `WebSocket` again. The subclass that faked the `protocol` field is gone, since Bun now fills it (oven-sh/bun#18744).

## 0.9.0

### Minor Changes

- [`5fef4a7`](https://github.com/na2axl/elysiumjs/commit/5fef4a7199f502fc4fe035299e7670739459a108) Thanks [@na2axl](https://github.com/na2axl)! - Fix tenant isolation, transactions and query caching in the database layer.

  Breaking changes:

  - `TenantMiddleware.validateTenant()` now rejects every tenant unless you override it, and tenant identifiers must match `TENANT_ID_PATTERN` (1 to 63 ASCII letters, digits, `_` or `-`, not starting with `pg_` and other than `information_schema`, in any case) before it is called. Requests that send any other tenant now fail with `Invalid tenant`. Requests without a tenant still resolve to `public` on `SimpleTenantMiddleware`. To migrate, check the tenant against your own data:

    ```ts
    class OrganizationMiddleware extends SimpleTenantMiddleware {
    	protected async validateTenant(tenant: string): Promise<boolean> {
    		return Organization.exists(tenant);
    	}
    }
    ```

  - `getTenantSchema()`, `registerTenantSchema()` and `wrapTenantSchema()` throw on tenant identifiers that do not match `TENANT_ID_PATTERN`.
  - `setConnectionTenant()` is removed. It set the tenant on a pooled connection for the whole session, so the tenant leaked to other requests. Use `withRLS()`, or `Database.transaction()` in RLS mode, which scope the tenant to a transaction.
  - `RepositoryInterface.update()` and `delete()`, and the `DrizzleRepository` implementations, return `null` when no row has the id. They returned `undefined` while typed as a row. `DrizzleRepository` also requires a model whose table has an `id` column.
  - `@transactional` handlers run through the `db.transaction` service that `DrizzleModule` provides (its name is exported by `@elysiumjs/core` as `DATABASE_TRANSACTION_SERVICE`, and still re-exported by `@elysiumjs/mnemosyne`). A transactional handler without a database module now fails with an error naming the service.
  - `@transactional` generator handlers commit only when the whole stream was sent. A stream closed early, or whose client disconnects (even while the handler is waiting), rolls back.
  - In RLS mode, a transaction is bound to one tenant for its whole life: the tenant set (with a transaction-local `set_config`) when `Database.transaction()`, a `@transactional` handler, `withRLS()` or `withIsolation()` opens it, from the explicit tenant or the current one (`public` when there is none). Work that finds a transaction open on its connection (`withRLS()`, `withIsolation()`, `Database.transaction()`, repository calls) joins it only when its tenant is the transaction's tenant, and throws `TenantMismatchError` otherwise, without running anything: the tenant of an open transaction never changes. Inside a transaction, `Database.getConnection()` only returns it to work for its tenant (the current tenant, or `public`), and throws `TenantMismatchError` otherwise, so raw queries never run for another tenant; queries on the `tx` handle a callback received run as the transaction's tenant. Work for several tenants, such as an admin fan-out, must use one `withRLS()` per tenant outside any transaction, not nested in one.
  - In RLS mode, each repository call made outside a transaction runs in its own transaction bound to the current tenant: `BEGIN`, `set_config` of the tenant, the query, `COMMIT`. These calls do not use the query cache, since the cache is bypassed inside transactions. Group calls in `Database.transaction()` or `withRLS()` to share one transaction.
  - In RLS mode, code running without a tenant in context (background jobs, CLI commands, scripts) is scoped to the `public` tenant. Set the tenant with `withTenant(tenant, () => ...)` around the work (repository calls and `Database.transaction()` then use it), or with `withRLS(tenant, (tx) => ...)`.
  - `migration:run` validates `--tenant` against `TENANT_ID_PATTERN`. Without a terminal it no longer creates a missing schema: pass `--create-schema` (which also skips the question in a terminal), or it fails.
  - Query cache keys start with the connection name, and each connection has its own cache transaction scope. When several applications or environments share one cache store and use the same connection names for different databases, set `cache: { prefix }` on each connection: the prefix comes before the connection name in every key (empty by default).
  - `DrizzleDatabaseCache` keys and values changed: entries written by earlier versions are ignored. The default TTL of cached queries (including with `cache: true`) is now 60 seconds instead of 1 second, and is set with `cache: { ttl }` in seconds.
  - `Cache.memory` keeps a separate LRU per tag namespace, so `lruSize` applies to each namespace.

  Fixes and additions:

  - In RLS mode, repository operations outside a transaction run in one bound to the current tenant, through the strategy's `withIsolation()`. Transactions opened with `Database.transaction()` or by `@transactional` handlers set the tenant variable when they open. `withIsolation()` and `withRLS()` expose their transaction to repositories and `Database.getConnection()`. `TenantMismatchError` is exported.
  - `Database.transaction(callback, connection?)` opens a transaction and registers it for the callback. When a transaction is already open on the same connection, the callback joins it (no savepoint: an error rolls back the whole transaction); in RLS mode only if the current tenant is the transaction's tenant (see above). Transactions are tracked by connection, so every name of a connection (`default` and the name it aliases) sees them, and named connections take part in transactions. `Database.getBaseConnection()`, `Database.inTransaction()` and `Database.runInTransaction()` are added. The `db:tx` context entry is still set for the default connection.
  - `@transactional` generator handlers keep their transaction open until the stream ends, then commit (or roll back if the handler throws). They previously committed before running and failed with `generator.next is not a function`. Generator handlers also see the request context (`tenant`, `http:context`).
  - The query cache is scoped to the connection and the current tenant, is shared correctly by several app instances (table versions stored in the cache), is not read or written inside transactions, and invalidates the tables a transaction changed once it commits. A result is only stored when no mutation happened since its query started, including when concurrent queries of the same key finish out of order. Cached queries honour Drizzle's `ex`, `px`, `exat`, `pxat` and `keepTtl` options.
  - Cache namespaces (`Cache.redis.tags(...)`, `Cache.memory.tags(...)`) no longer overwrite each other: reads, deletes and `clear()` stay within their namespace.
  - `getSessionTenant()` reads the Bun SQL result correctly, and `getCurrentTenant()` works without an application instance (for example under `Application.testing`).
  - `migration:run` takes an advisory lock per tenant, adds a unique index on `elysium_migrations.name` (also to existing tables), finds the migrations from the project root (`.elysiumrc`), sets the `search_path` for the transaction only, asks before opening the transaction whether to create a missing schema, and always closes its client. Existing duplicate migration names must be removed before the unique index can be created.
  - `migration:generate` only removes `"public".` qualifiers from the migration it generates, and leaves string literals, comments and dollar-quoted bodies (`DO` blocks, functions) untouched.
  - `DatabaseDriver.createConnection()` receives the connection name as an optional second argument.
  - `KeyvRedis` deletes with a single `UNLINK` (or `DEL`) per call or batch and reports failed deletes in `clear()` as `error` events.

## 0.8.0

### Minor Changes

- [`8ac91ab`](https://github.com/na2axl/elysiumjs/commit/8ac91ab676b1119b4eecf0ddb3fd0a3e84017cac) Thanks [@na2axl](https://github.com/na2axl)! - Upgrade dependencies to their latest major versions: wampy 8, zod 4, commander 15, @casl/ability 7, OpenTelemetry SDK 2 (sdk-node 0.300, resources 3), @sentry/bun 11. Generated projects now use TypeScript 7.

  Breaking in `@elysiumjs/mnemosyne-drizzle`: it now requires drizzle-orm 1.0 (release candidate) and generated projects use drizzle-kit 1.0. `ColumnsWithTable` is no longer re-exported. `migration:generate` writes 1.0 migration folders (`<timestamp>_<name>/migration.sql`), and `migration:run` tracks those by folder name while still running flat `*.sql` files. Existing projects can upgrade their migrations folder with `drizzle-kit up`: `migration:run` recognises the moved migrations as already applied and renames their records. The `make:model` stub now generates a `pgTable` and a `DrizzleModel` built from it.

  Breaking in `@elysiumjs/core`: the deprecated `@elysiajs/swagger` plugin is replaced by `@elysiajs/openapi`, and the app option `swagger` is renamed `openapi` (typed `ElysiaOpenAPIConfig | false`). Without a `path`, the docs now live at `/openapi` instead of `/swagger`. The UI options `scalarConfig` and `swaggerOptions` are now `scalar` and `swagger`. Elysia stays on 1.4 (now `^1.4.30`) until Elysia 2 and its OpenAPI plugin are stable.

  Also in `@elysiumjs/core`: the WAMP `onChallenge` callback must return a string (or a promise of one); `null` is no longer accepted. `onError` now receives the error and `onReconnectSuccess` receives wampy's details object. `WampClient` is now wampy's own `Wampy` type. `onOpen` is called by Elysium once the connection is established, since wampy 8 no longer has that callback.

- [`3625883`](https://github.com/na2axl/elysiumjs/commit/3625883dba92f1596e7444ee52f9399d8e9b049f) Thanks [@na2axl](https://github.com/na2axl)! - Drop the `reflect-metadata` dependency. Decorator metadata now lives in a small store in `@elysiumjs/core`, exported as `Metadata` (`define`, `get`, `getOwn`, `has`). Use it instead of `Reflect.defineMetadata` and `Reflect.getMetadata` to read or write Elysium metadata.

  Apps no longer need `import 'reflect-metadata'` in their entrypoint, and generated projects leave it out. Keep `emitDecoratorMetadata` enabled: `@Service.inject()` and `@Command.arg()` still infer types from it. An app that loads `reflect-metadata` for another library keeps working; Elysium also reads the types stored there.

- [`07236b3`](https://github.com/na2axl/elysiumjs/commit/07236b386c2506590d74e8753ce847c1e184b3ee) Thanks [@na2axl](https://github.com/na2axl)! - Introduce the module system. Modules are now the only way to register anything in an Elysium.js app. This is a breaking change with no compatibility layer.

  Breaking changes:

  - `@Module.register()` takes `imports`, `services`, `exports`, `controllers`, `commands`, `jobs`, `prefix` and `env`. Services are private to their module unless exported (or global). The `beforeRegister` and `afterRegister` hooks are replaced by `onInit`, `onServe` and `onDestroy`.
  - Configurable modules are bound with `with()`, for example `HermesModule.with({ level: 'debug' })`. `with()` accepts an object or a function.
  - Decorators only record metadata. Importing a file no longer registers commands, services or event wiring, and the side-effect imports of the packages are removed. List commands, jobs and services in the module that owns them.
  - `@Application.register()` no longer takes `database`, `redis`, `wamp` or `'elysium:hermes'`/`'elysium:cerberus'` keys. Use `DrizzleModule`, `RedisModule`, `WampModule`, `HermesModule` and `CerberusModule`. Package plugins are replaced by modules: add `SentryModule` instead of the `plugin()` function. `plugins` still accepts plain Elysia plugin factories.
  - Constructing an `Application` no longer runs it. Use `await App.start()`; `Application.testing()` boots a module graph for tests. The `styx` binary loads `src/app.ts` (or `index.ts`) and starts the exported application, so a project entry no longer needs to import commands.
  - The job system of core (`Job`, `Worker`, `WorkerPool`, `commandWork`) is removed. `@elysiumjs/heracles` is the only job system: extend its `Job`, list jobs in a module's `jobs`, declare queues with `HeraclesModule.with({ queues })`, and dispatch with `Heracles.dispatch()`.
  - `@elysiumjs/styx` ships `StyxModule`, active in development only. The `migration:generate` and `migration:run` commands move to `DrizzleModule` and are available in production.
  - `@elysiumjs/mnemosyne` ships `MnemosyneModule` for its caches (`redis: false` or `memory: false` opts out). `DrizzleModule` imports it.
  - New modules: `HephaestusModule`, `ArgusModule` (`serviceName` is required), `SentryModule` (needs a `dsn` or `SENTRY_DSN`) and `CerberusModule` (`getSubject` is required).
  - Module and service code throws typed errors (for example `InvalidModuleConfigError`) instead of exiting the process. `Application.run()` prints them and exits; command `run()` methods may still exit, and package plugin factories are unchanged.
  - `Application.register` merges subclass props over the parent's (own props, then own metadata, then parent, then defaults), and concatenates `modules` parent first. Previously defaults and parent values won, so `openapi` could not be enabled.
  - `Heracles.dispatch` starts a stopped queue on first use, so producers no longer start queues. `Queue.start()` is idempotent.
  - `create-elysium` generates apps that use modules, and adds Sentry and Hephaestus to the `modules` list.
  - `@Event.on`/`@Event.once` method listeners on classes in a loaded module's `services` or `controllers` are wired by the kernel and run in their module's context. Jobs, commands and middlewares are not wired, and an instance listener on a class that is not a service throws `EventListenerNotSupportedError`. Listeners on classes not listed in a loaded module no longer fire.
  - New typed errors: `CircularDependencyError` (services that depend on each other, in sync and async resolution), `DuplicateModuleNameError` (two different module classes sharing a name; module scopes and config tokens are name based) and `EventListenerNotSupportedError`.
  - Lazy boot contract: a CLI command initialises only its own module and that module's imports. Sync helpers such as `Database.getConnection()` work when the owning module's `onInit` is synchronous; otherwise they throw `ServiceNotReadyError` naming the module. Use `await Service.resolve()` or set `static boot = true` on the command.

## 0.6.0

### Minor Changes

- Extract tenancy module with multi-tenant support (strict, simple, and custom modes).
- Enhance dependency injection with lazy registration.
- Add new base abstractions for commands, middlewares, and repositories.
- Add built-in `ConsoleLogger` and `RequestLoggerMiddleware`.
- Remove usage of `ELYSIUM_BUILD` macro.
