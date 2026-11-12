# @elysiumjs/olympus

The Elysium.js framework: an application built from modules of controllers and services, wired by dependency injection and declared with decorators, on top of [ElysiaJS](https://elysiajs.com/). It runs on Bun, Node.js and Cloudflare Workers.

## Installation

```bash
bun add @elysiumjs/olympus
```

Add a runtime package too: `@elysiumjs/bun`, `@elysiumjs/node` or `@elysiumjs/workers` (see [Runtimes](#runtimes)), and `@elysiumjs/pino` for pino logs (see [Logging](#logging)).

## Exports

| Import                               | Contents                                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@elysiumjs/olympus`                 | Application, modules, dependency injection, HTTP, WebSocket and WAMP controllers, middleware, interceptors, filters, problem details, configuration, environment, lifecycle events, console commands, OpenAPI. |
| `@elysiumjs/olympus/mnemosyne`       | Models, repositories with events, pruning jobs, the query DSL, units of work, caches, seeders and an in-memory backend.                                                                                        |
| `@elysiumjs/olympus/moirai`          | Actions and queries, idempotency, outbox, inbox and domain events.                                                                                                                                             |
| `@elysiumjs/olympus/moirai/heracles` | Outbox effect that dispatches heracles jobs. Import it once in the process that relays the outbox.                                                                                                             |
| `@elysiumjs/olympus/heracles`        | Background jobs: queues, schedules, fan-out, retries and dead letters. `MemoryTransport` runs jobs in the process.                                                                                             |
| `@elysiumjs/olympus/ariadne`         | Multi-step flows with server-side state and replayable steps.                                                                                                                                                  |
| `@elysiumjs/olympus/themis`          | Authentication: sessions, guards, API keys, CSRF, TOTP, OAuth and passkeys.                                                                                                                                    |
| `@elysiumjs/olympus/harpocrates`     | Secrets and cryptography: password hashing (`Password` and the `PasswordHasher` port), encryption (the `Cipher` port), JWTs, signed URLs and hashing helpers.                                                  |
| `@elysiumjs/olympus/cerberus`        | Ability-based roles and permissions.                                                                                                                                                                           |
| `@elysiumjs/olympus/hermes`          | `HermesModule` (the app logger), the `console` logger driver, request logs and `@Logged()`.                                                                                                                    |

Database drivers, stores and runtimes ship as separate packages, such as `@elysiumjs/drizzle` and `@elysiumjs/redis`.

## Usage

Create a controller class:

```typescript
import { Http } from '@elysiumjs/olympus';

@Http.controller('/users')
export class UserController {
	@Http.get('/:id')
	public getUser(id: string) {
		return { id };
	}
}
```

Create a module class. A module is the only way to register anything in an Elysium.js app:
controllers, commands, jobs and services are all declared by the module that owns them.

```typescript
import { Module } from '@elysiumjs/olympus';

import { UserController } from './controllers/http/user.controller';
import { UserService } from './services/user.service';

@Module.register({
	services: [UserService],
	controllers: [UserController]
})
export class MainModule extends Module {}
```

Create an application class. Modules that need configuration are bound to it with `with()`:

```typescript
import { Application } from '@elysiumjs/olympus';
import { HermesModule } from '@elysiumjs/olympus/hermes';

import '@elysiumjs/pino';

import { RedisModule } from '@elysiumjs/redis';

import { MainModule } from './main.module';

@Application.register({
	modules: [
		HermesModule.with({ level: 'debug', format: 'pretty' }),
		RedisModule.with({
			default: 'cache',
			connections: { cache: { url: process.env.REDIS_URL! } }
		}),
		MainModule
	],
	server: {
		name: 'Elysium',
		port: 3000
	}
})
export class App extends Application {}
```

Create an entrypoint file:

```typescript
import { App } from './app';

await App.start();
```

Start the server:

```bash
bun run index.ts serve
```

Or, if using `styx`, run:

```bash
bun styx serve
```

## Request values

Route parameters receive the parts of the request. Their schemas validate the request before the handler runs and document the route in OpenAPI:

```typescript
import { Http, t } from '@elysiumjs/olympus';

@Http.controller('/users')
export class UserController {
	@Http.patch('/:id', { headers: t.Object({ 'if-match': t.Optional(t.String()) }) })
	public update(
		@Http.param('id') id: string,
		@Http.body(t.Object({ name: t.String() })) body: { name: string },
		@Http.query(t.Object({ notify: t.Optional(t.String()) })) query: { notify?: string },
		@Http.header('x-tenant-id') tenant: string
	) {
		return { id, tenant, ...body };
	}
}
```

- `@Http.param()`, `@Http.body()` and `@Http.query()` give the URL parameter, the body and the query. A value that does not match its schema gets a 422 `VALIDATION_FAILED` problem.
- `@Http.header()` gives a header, a required string unless a schema says otherwise. The `headers` option declares headers the handler does not read itself. Missing or malformed headers get a 400 `BAD_REQUEST` problem.

## Responses and problems

A route declares the schema of its handler's result in `response`, and the problems it answers with in `errors`. Both are documented in OpenAPI.

```typescript
import { DomainError, Http, t } from '@elysiumjs/olympus';

export class InsufficientFunds extends DomainError.for('INSUFFICIENT_FUNDS', 409, {
	extensions: { missing: t.Integer() }
}) {}

const Wallet = t.Object({ id: t.String(), balance: t.Integer() });

@Http.controller('/wallets')
export class WalletController {
	@Http.post('/:id/pay', { response: Wallet, errors: [InsufficientFunds] })
	public pay(
		@Http.param('id') id: string,
		@Http.body(t.Object({ amount: t.Integer() })) body: { amount: number }
	) {
		if (body.amount > 100)
			return new InsufficientFunds('Top up first.', { extensions: { missing: body.amount - 100 } });
		return { id, balance: 100 - body.amount };
	}
}
```

- A class made with `DomainError.for(code, status, { extensions })` has static `code`, `status` and `schema`. `schema` is the problem details it is sent as, with the code and the status as literals and the extension members; the constructor's `extensions` are typed from them.
- The problems of one status are documented as a union. A schema the route gives for that status in `response` wins over them.
- The framework adds its own: 422 `VALIDATION_FAILED` when the body or the query is validated (400 with `problems.validationStatus`), 400 `BAD_REQUEST` for a body to parse or declared headers, 413 `PAYLOAD_TOO_LARGE` under the body limit, 429 `RATE_LIMITED` with a rate limit, and 500 `INTERNAL_ERROR` on every route.
- A middleware, an interceptor or a validator that answers with problems lists their classes in a static `errors`, and the routes they apply to document them.
- `status` sets the status of a successful response: `@Http.post('/', { status: 201, response: Wallet })` answers 201 and documents `Wallet` under it, and `@Http.del('/:id', { status: 204 })` answers without a body. A handler that sets `ctx.set.status` keeps its own.
- `Http.currentContext()` gives the context of the request being handled to code outside the handler, such as a service, and `undefined` outside a request.

An interceptor that changes the shape of results describes it, so that routes declare the result of their handler. `TransformInterceptor.with(transform, { schema })` passes the success schemas of the routes it wraps through `schema`, in the order results go through the interceptors (route, controller, module, then application). The new schema is the one documented, validated and serialized, and `schema` must leave alone what `transform` leaves alone:

```typescript
const Envelope = TransformInterceptor.with(
	(result) => (isEnveloped(result) ? result : { data: result }),
	{ schema: (schema) => (isEnvelopedSchema(schema) ? schema : t.Object({ data: schema })) }
);
```

### Results

A check or a call that may fail returns a `Result`: the value it passed with, or the `DomainError` it failed with. A handler may return one: a passed result answers its value, a failed one its problem. `AsyncResult` is the result to come of a promise, with the same methods, and a handler may return it too.

```typescript
import { AsyncResult, ForbiddenError, Result } from '@elysiumjs/olympus';

const mayBuy = (account: Account): Result<Buyer, ForbiddenError> =>
	account.adult ? Result.pass({ id: account.id }) : Result.fail(new ForbiddenError('Adults only.'));

const buyer = mayBuy(account);
if (!buyer.check()) return buyer.error;
buyer.result.id;

return mayBuy(account).errorOr((buyer) => view.render(buyer));

const wallet = await AsyncResult.from(wallets.open(userId)).orThrow();
```

- `check()` narrows the result: `result` is the value on the passed side, `error` the problem on the failed side.
- `orThrow()` gives the value or throws the error, `orError()` gives the value or the error, and `errorOr(transform)` gives the error or the transformed value, as a handler returns it.
- `map(transform)` transforms the value and `andThen(next)` chains the next result; a failure skips both.
- `Result.of(value)` and `AsyncResult.from(promise)` make a result of a `T | DomainError` union, and keep a result as it is. `Result.is(value)` tells a result from other values.
- `Result` is not a thenable, so awaiting one gives the result itself. Awaiting an `AsyncResult` gives its `Result`.

## Environment

The app and its modules declare the environment variables they read as TypeBox objects. They are validated when the app runs or is built, with every missing or invalid variable listed, and read with `Env.get()`. A file that declares a schema also augments `AppEnv`, so that `Env.get()` knows each name and its type:

```typescript
// src/env.ts
import type { Env } from '@elysiumjs/olympus';

import { Secret, t } from '@elysiumjs/olympus';

export const env = t.Object({
	PORT: t.Number({ default: 3000 }),
	DATABASE_URL: Secret.schema()
});

declare module '@elysiumjs/olympus' {
	interface AppEnv extends Env.Infer<typeof env> {}
}
```

The app passes the schema as its `env` option, and a module as its `envSchema` option, declared the same way in its own file. Then:

```typescript
Env.get('PORT'); // number
Env.get('DATABASE_URL').reveal(); // string: a Secret prints as [secret] in logs and JSON
Env.get('PROT'); // compile error: not declared
```

- Once any variable is declared, `Env.get()` only accepts declared names. Without any, it takes any name and returns the raw string.
- A variable is typed even when its module is inactive in the current environment: declare the variables of such a module with `t.Optional()`.
- In an app with a schema, reading `Env` before the environment is validated throws `EnvironmentNotReadyError`. Read it in `onInit`, a service, or a `with()` factory.
- The runtime's `env()` stays the raw environment, before validation.

## Time

Code that decides on time, such as expiries, schedules and the instants it records, reads it from `Clock` instead of `new Date()`. Moirai, Heracles schedules and Themis tokens, sessions and signed URLs do. Tests and development can then freeze it or move it:

```ts
import { Clock } from '@elysiumjs/olympus';

Clock.now(); // a Date
Clock.epochMs(); // milliseconds since the epoch

Clock.freeze('2026-01-01T00:00:00Z');
Clock.travel(14 * 24 * 3600 * 1000); // 14 days later, frozen or running
Clock.reset();
```

`freeze()` and `travel()` throw `ClockAdjustmentRefusedError` outside `development` and `test`. `Clock.use(source)` takes the time from another `ClockSource`. Durations that only measure the machine, such as request timings and locks, keep the real time.

## Ports

A port is an extension point whose drivers register by name. `Port(name)` makes one, `@X.driver(name)` registers a class, and `X.for(name, options)` builds the driver. The names and the options are typed by declaration merging, so a typo fails to compile.

```ts
import { Port } from '@elysiumjs/olympus';

export interface SearchDriver {
	query(index: string, text: string): Promise<object[]>;
}

declare module '@elysiumjs/olympus' {
	interface Ports {
		search: SearchDriver;
	}
	interface PortDrivers {
		'search:meilisearch': typeof MeiliSearchDriver;
	}
}

export class Search extends Port('search') {}

@Search.driver('meilisearch')
export class MeiliSearchDriver implements SearchDriver {
	constructor(private readonly options: { url: string }) {}

	public async query(index: string, text: string): Promise<object[]> {
		// ...
		return [];
	}
}

const search = Search.for('meilisearch', { url: 'http://localhost:7700' });
```

`Search.drivers()` lists the registered names. `.for()` throws `UnknownPortDriverError` for a name nobody registered: import the package that provides it.

## Locks

`Lock` is a port: one holder per key at a time, until it lets go or its time to live ends. The `memory` driver ships here; backend packages add others, such as `redis` from `@elysiumjs/redis`, `durable-object` from `@elysiumjs/workers` and `postgres` from `@elysiumjs/drizzle`. Each domain takes its own lock: `HeraclesModule.with({ lock })` for the ticks of `heracles:schedule` processes, `MoiraiModule.with({ lock })` for `serializeBy` and `Moirai.lock()`.

```ts
import { Lock } from '@elysiumjs/olympus';

const lock = Lock.for('memory');

const handle = await lock.acquire('report:daily', 60_000); // null when another holder has it
if (handle) {
	await lock.extend(handle, 60_000);
	await lock.release(handle);
}

// Waits up to 5 seconds, runs the work, and lets go afterwards.
const run = await lock.run('report:daily', 60_000, () => buildReport(), { wait: 5_000 });
if (run.acquired) console.log(run.value);
```

The locks of `serializeBy` and `Moirai.lock()` are let go when their unit of work commits or rolls back. In case their holder dies first, they also end after `lockTtl` milliseconds (`MoiraiModule.with({ lockTtl: 30_000 })`, 60 seconds by default): keep it longer than your slowest unit of work.

## Repositories

`Repository(Model)` from `@elysiumjs/olympus/mnemosyne` gives a model its CRUD, listing and counting. The backend comes from the model: `DrizzleModel()` from `@elysiumjs/drizzle` runs on PostgreSQL, and `MemoryModel()` keeps rows in the process, for tests and prototypes. Writes join the transaction open on the connection, and the table is resolved for the current tenant on each call.

```ts
import { Service } from '@elysiumjs/olympus';
import { MemoryModel, Repository } from '@elysiumjs/olympus/mnemosyne';

type Book = { id: string; title: string; authorId: string };

class BookModel extends MemoryModel<Book>('books') {}

@Service.register()
export class BookRepository extends Repository(BookModel) {}

const books = new BookRepository();
const book = await books.insert({ title: 'Dune', authorId: 'a-1' });
await books.update(book.id, { title: 'Dune Messiah' });
const page = await books.list(query); // a ParsedQuery from Listing.parse()
```

`find`, `update`, `delete` and `exists` take the key of a row: its value, or an object of the values of its key columns when the key spans several. Custom queries use `this.db`, the backend's own connection, typed for it (the Drizzle connection for Drizzle models). The scope that `list()`, `count()` and `deleteWhere()` take is a condition in the backend's terms: an SQL condition with Drizzle, a predicate in memory. `deleteWhere()` needs a scope: `deleteAll()` deletes every row. The memory backend refuses a second row with the same key, compares values strictly (dates by time, arrays and objects by content) and sorts missing values last in ascending order, as PostgreSQL does. It does not join transactions: a rolled-back unit of work keeps its rows.

### Events

A repository class carries events: `creating`, `updating` and `deleting` run before the write, may change `data` in place, and refuse the write by returning an error, which the method throws; `created`, `updated` and `deleted` run once the unit of work commits, and not at all when it rolls back (set `static afterCommit = false` to run them right after the write). Listeners run one after the other, in the order they subscribed, and the listeners after a refusal do not run. The listeners of a repository class also run for its subclasses. An error a listener throws reaches the caller as it is. Bulk methods (`updateAll`, `deleteAll`, `deleteWhere`) and custom queries do not fire events.

```ts
BookRepository.on('creating', ({ data }) => {
	if (!data.title?.trim()) return new InvalidTitleError();
});
```

An observer groups the listeners in a class, one method per event, typed against the events of its repository. Registered as a service and listed by a module, it is resolved from the container and runs in that module, so it can inject others; the module must be loaded when the repository fires an event. An observer that is not a service is built once, without arguments.

```ts
@Service.register()
@Repository.observer(OrderRepository)
export class OrderObserver {
	constructor(@Service.inject() private readonly mailer: Mailer) {}

	public async created({ row }: { row: Order }) {
		await this.mailer.sendConfirmation(row.id);
	}
}
```

### Pruning

`Pruner(Model)` is a job that deletes stale rows chunk by chunk. `prunable` names them, `chunkSize` sets the rows per statement (1,000 by default), and both are getters, read on each run. Without a `pruning(rows)` hook, rows are deleted without being loaded; with one, each chunk is loaded, given to it first, then deleted by the table's primary key. A `prunable` of `undefined` prunes nothing on that run. A pruner works on the table of the tenant in context when it runs: with per-tenant tables, run it once per tenant.

```ts
@Job.register({ queue: 'maintenance' })
@Scheduler.job('0 3 * * *')
export class PruneSessions extends Pruner(SessionModel) {
	protected get prunable() {
		return lt(sessions.expiresAt, new Date());
	}
}
```

### Other backends

A backend package provides a `RepositoryAdapter` through its model adapter (`ModelAdapter.repository`), and declares the types of its tables, connection and scope so that `this.db` and the scopes are typed:

```ts
declare module '@elysiumjs/olympus/mnemosyne' {
	interface RepositoryDrivers {
		sqlite: { table: SQLiteTable; connection: SQLiteConnection; scope: SQL };
	}
}
```

## Passwords and encryption

`@elysiumjs/olympus/harpocrates` holds the cryptography the other domains use, on Web Crypto and `node:crypto` (Cloudflare Workers need the `nodejs_compat` flag).

`Password` hashes with the drivers of the `PasswordHasher` port. New hashes come from scrypt unless `Password.use()` picks another driver; `verify` recognises the hashes of every registered driver by their prefix, and `needsRehash` tells when to replace a hash after a successful login:

```ts
import { Password } from '@elysiumjs/olympus/harpocrates';

const hash = await Password.hash('correct horse battery staple');

if (await Password.verify(input, hash)) {
	if (Password.needsRehash(hash)) await users.updateHash(userId, await Password.hash(input));
}
```

The drivers are `scrypt` (the default, N=16384, r=8, p=1) and `pbkdf2` (PBKDF2-HMAC-SHA256 through Web Crypto); `@elysiumjs/bun` adds `bun`, Argon2id through `Bun.password`. Pick one with options through the port: `Password.use(PasswordHasher.for('scrypt', { N: 32768 }))`. On Bun, call `Password.use('bun')` at startup to keep making Argon2id hashes; otherwise `needsRehash` asks to replace them with scrypt ones. Cloudflare Workers cap PBKDF2 at 100,000 iterations, so a PBKDF2 hash made elsewhere with more does not verify there.

`Cipher` encrypts strings. The `aes-gcm` driver uses AES-256-GCM over a keyring of secrets of at least 32 bytes; each ciphertext names its key, so you can add a key, make it current, and still decrypt the values of the older ones. The context binds a ciphertext to where it belongs: decrypting it under another context fails with `DecryptionFailedError`.

```ts
import { Cipher } from '@elysiumjs/olympus/harpocrates';

const cipher = Cipher.for('aes-gcm', {
	keys: { '2026-01': oldKey, '2026-06': currentKey },
	current: '2026-06'
});

const sealed = await cipher.encrypt('+33 6 12 34 56 78', 'contacts.phone');
const phone = await cipher.decrypt(sealed, 'contacts.phone');
```

`Jwt` signs and verifies tokens, `SignedUrl` signs links that expire, and `randomToken`, `sha256`, `hmac` and `verifyHmac` cover the smaller needs.

## Logging

`getLogger()` answers the app's `logger` service, or a plain console logger when there is none. `HermesModule` from `@elysiumjs/olympus/hermes` provides that service from the `Logger` port, through the driver its `transport` names:

- `console` (in `@elysiumjs/olympus/hermes`): one JSON object per line through `console`, with no dependency. The default on Cloudflare Workers, and wherever no other driver is loaded.
- `pino` (in `@elysiumjs/pino`): JSON lines, or readable ones with `format: 'pretty'`. Importing the package registers it and makes it the default.

```ts
import { getLogger } from '@elysiumjs/olympus';
import { HermesModule } from '@elysiumjs/olympus/hermes';

import '@elysiumjs/pino';

HermesModule.with({ name: 'shop', level: 'debug', format: 'pretty' });

getLogger({ module: 'orders' }).info('Order placed', { orderId: 'o-1' });
```

A logging package registers its driver with `@Logger.driver(name)` on a class that implements `LoggerInterface` and takes `LoggerOptions` (`name`, `level`, `format`), and declares the name so that `transport` and `Logger.for()` accept it:

```ts
declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'logger:datadog': typeof DatadogLogger;
	}
}

@Logger.driver('datadog')
export class DatadogLogger implements LoggerInterface {
	// ...
}
```

## Jobs in tests

`MemoryTransport` runs the jobs of a queue in the process, with no worker or backend. In a test, `MemoryTransport.settled()` waits until every dispatched job, its retries included, has finished:

```ts
import { Heracles, HeraclesModule, MemoryTransport } from '@elysiumjs/olympus/heracles';

const app = await Application.testing({
	modules: [
		HeraclesModule.with({ queues: { default: { transport: MemoryTransport } } }),
		MailModule
	]
});

await Heracles.dispatch(SendWelcomeMail, ['ada@example.com']);
await MemoryTransport.settled();
```

## Encrypted jobs

A job registered with `encrypted: true` has its arguments encrypted before they reach the transport, with the context `heracles:<job name>`, and decrypted in the worker, so that a queue backend never stores them in clear. The `job()` outbox effect of moirai encrypts them too, before they reach the outbox. Give the module a cipher; dispatching an encrypted job without one throws `MissingJobCipherError`. The arguments travel as JSON, on the in-memory transport too.

Only the arguments are encrypted: the job name, the job id and the dispatch options stay in clear. A job that derives its id from its arguments, through `generateJobId()`, should hash them first with `hmac` from harpocrates.

When the arguments do not decrypt, the job does not run: it fails on the in-memory and Redis transports, and on Cloudflare Workers it is retried within its `maxRetries`, then goes to the dead letters. To rotate keys without losing jobs, add the new key to the keyring of every worker first, then make it current where jobs are dispatched.

```ts
import { Cipher } from '@elysiumjs/olympus/harpocrates';
import { HeraclesModule, Job } from '@elysiumjs/olympus/heracles';

HeraclesModule.with({
	cipher: Cipher.for('aes-gcm', { keys: { main: () => readSecret('JOBS_KEY') } })
});

@Job.register({ encrypted: true })
class SendStatement extends Job {
	constructor(private readonly iban: string) {
		super();
	}

	protected async execute(): Promise<void> {
		// ...
	}
}
```

## Queued actions

`Moirai.enqueue(action, input, call?)` runs an action later, as a Heracles job, on the queue the call names, else the `queue` of `@Action.register()`, else `default`. The call is checked right away, as `Moirai.execute()` checks it: the input, `authorize`, and that an idempotent action has a key, whose owner is read then. It answers once the job is accepted, with the ids of the job and of its dispatch. The job runs the action through the same path as `execute()`: its unit of work, retries, idempotency and outbox. The call may also set `scheduledFor` and `priority`.

```ts
import { ActionJob } from '@elysiumjs/olympus/moirai/heracles';

@Action.register({ input: t.Object({ userId: t.String() }), errors: [], queue: 'mail' })
class SendDigest extends Action<{ userId: string }> {
	public async handle(input: { userId: string }) {
		// ...
	}
}

@Module.register({ jobs: [ActionJob] })
class AppModule extends Module {}

const { jobId } = await Moirai.enqueue(SendDigest, { userId }).orThrow();
```

List `ActionJob` in the `jobs` of one module, next to `HeraclesModule`, in the processes that queue actions and in those that run them; the latter must import the actions too. Without it, `enqueue()` throws `QueuedActionsUnavailableError`. A call made in a unit of work dispatches its job once the unit commits, through the outbox when there is one, and not at all when it rolls back.

The job runs without the caller's context, such as the current user: what the handler needs goes in the input, which travels as JSON, in clear. An input that does not survive JSON, such as a `Date`, is refused with `QueuedInputError`. The job finds the action by its name, so two action classes cannot share one (`DuplicateActionNameError`).

A refusal of the handler ends the job, logged. A thrown error fails it, and Heracles retries it within the `maxRetries` of the queue (never for an action registered with `retry: false`). A job may run more than once, so give an action that must not an idempotency key: a second run replays the stored response. The job trusts its queue: `authorize` ran when the call was queued, so anything that can write to the queue can run any registered action.

## Services

A service is identified by its class. Give it a name with `@Service.register({ name })` to look it up by that string instead. Class names are never used as identifiers, so services resolve the same way after a bundler renames classes (`bun run check:minified` builds a minified app and checks it).

```typescript
import { Service, ServiceScope } from '@elysiumjs/olympus';

@Service.register()
export class UserRepository {}

@Service.register({ name: 'mailer' })
export class MailerService {}

@Service.register()
export class UserService {
	constructor(
		@Service.inject(UserRepository) private readonly users: UserRepository,
		@Service.inject('mailer') private readonly mailer: MailerService
	) {}
}
```

`@Service.inject()` without an argument injects the class of the parameter type, read from `emitDecoratorMetadata`. Pass the class or the name when the type is an interface or is missing; Elysium throws at declaration time when it cannot tell which service to inject.

A service has one of three scopes:

| Scope                    | Instances                                                   |
| ------------------------ | ----------------------------------------------------------- |
| `ServiceScope.SINGLETON` | One for the app (the default)                               |
| `ServiceScope.FACTORY`   | A new one each time the service is resolved                 |
| `ServiceScope.REQUEST`   | One per HTTP request, shared by its middlewares and handler |

A request-scoped service resolves only inside a request: resolving it elsewhere throws `OutsideRequestScopeError`. Code outside a route, such as a job or a test, opens a scope with `Service.runInRequestScope(fn)`; every request-scoped service resolved inside `fn`, including after an `await`, is shared for that run. A singleton, or a controller with the default server scope, cannot depend on a request-scoped service, since it would keep the first request's instance: Elysium throws `ScopeMismatchError`. Use a request-scoped controller (`scope: HttpControllerScope.REQUEST`), or inject the service in the route handler's parameters.

### Tags

A tag groups services: each service registered with it is injected together with the others. Use it for extension points that modules contribute to, such as health checks or permission rules.

```typescript
import { Service } from '@elysiumjs/olympus';

export const HealthChecks = Service.tag<HealthCheck>('health.checks');

@Service.register({ tags: [HealthChecks] })
export class DatabaseCheck implements HealthCheck {}

@Service.register()
export class Health {
	constructor(@Service.injectAll(HealthChecks) private readonly checks: HealthCheck[]) {}
}
```

`@Service.injectAll(tag)` and `Service.getAll(tag)` give the tagged services in registration order, and an empty array when there is none; `Service.resolveAll(tag)` also waits for their `onInit`. A module receives the tagged services of every module of the application, including the ones it does not import, while getting one of them by its class still follows the module's imports and exports. Scopes apply to each tagged service as they do to `@Service.inject()`.

### Extension points

When each service of a tag carries options of its own, such as a name and a channel, `Service.extension()` makes the tag, the decorator that registers a service with its options, and the lookups. Names must be unique among the active services: `all()` throws `DuplicateExtensionError` otherwise.

```typescript
type TransportOptions = { name: string; channel: 'email' | 'sms'; devOnly?: boolean };

export const Transports = Service.extension<Transport, TransportOptions>(
	'notifications.transports',
	{
		env: (options) => (options.devOnly ? Environments.local : undefined)
	}
);

@Transports.register({ name: 'resend', channel: 'email' })
export class ResendTransport implements Transport {}

Transports.all(); // [{ service, options }], in registration order
Transports.find('resend'); // the service, or undefined
Transports.optionsOf(ResendTransport); // { name: 'resend', channel: 'email' }
```

`Transports.tag` is the tag, for `@Service.injectAll()`. `settings.scope` and `settings.global` apply to every service of the extension point.

`Service.invoke(target, method, args)` calls a method whose parameters take services with `@Service.inject()` or `@Service.injectAll()`: each of them receives its service, resolved in the current module context, and the other parameters receive `args` in order.

`Service.get()` answers `null` for a service that is not visible: keep it for optional services. For a service the code needs, use `Service.require()`, which returns it at once, or `Service.resolve()`, which waits for its initialisation: both throw a precise error when it is missing.

## Background work

Background scopes wrap every unit of background work (a job, an event handler, an outbox handler), the way interceptors wrap requests: they set what the work needs once, such as a config or an actor scope. A scope is a service registered with `@Background.scope()`; scopes nest in the order the modules register them, the first one outermost.

```typescript
import type { BackgroundScope, BackgroundWork } from '@elysiumjs/olympus';

import { Background } from '@elysiumjs/olympus';

@Background.scope()
export class SystemActorScope implements BackgroundScope {
	public run<T>(work: BackgroundWork, next: () => Promise<T>): Promise<T> {
		return Actor.run(Actor.system(work.name), next);
	}
}
```

`work.kind` says what runs (`job`, `event` or `outbox`), and `work.name` names it. `Background.run(work, fn)` runs other work in the scopes.

## Lazy boot

A CLI command boots lazily: running `app:cmd` initialises the command's own module and the modules it imports, not the whole graph. `help <cmd>` is always lazy, even for commands with `static boot = true`.

- **Sync helpers are safe** (`Service.get()`, `Database.getConnection()`, `Redis.getConnection()`, ...) when the module that owns the service initialises synchronously. Elysium then initialises that module on the spot, even if the command does not import it.
- **Use `await Service.resolve(...)`** when the owning module has an asynchronous `onInit`. A sync `get` then throws `ServiceNotReadyError`, which names the module.
- **Use `static boot = true`** on a command that needs every module initialised before it runs (workers, servers). It initialises every module and builds every service first.
- Service factories receive a synchronous `get`; it may only read services whose owning modules initialise synchronously, otherwise it throws `ServiceNotReadyError`.

## Runtimes

Olympus never calls a host API directly. Environment variables, timers, the HTTP server, process exit and shutdown signals come from a runtime, which ships as its own package:

| Package              | Exports                             | Notes                                                                                                     |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@elysiumjs/bun`     | `runtime`                           | `Bun.env`, `Bun.sleep`, `listen`, process exit and signals                                                |
| `@elysiumjs/node`    | `runtime`                           | Same on Node.js, served on a `node:http` server; no adapter to configure                                  |
| `@elysiumjs/workers` | `runtime`, `createRuntime({ env })` | Env from `process.env` (`nodejs_compat`) or `env`; no `serve` (export the app's `fetch`), exit or signals |

Each package exports `runtime` (rename it at import if you like). Pass it to the application, or call `Runtime.use()` before anything needs it:

```ts
import { runtime } from '@elysiumjs/bun';
import { Application } from '@elysiumjs/olympus';

@Application.register({ runtime, modules: [] })
class App extends Application {}
```

Without a runtime, `Runtime.get()` throws `RuntimeNotConfiguredError`; only the environment name falls back to `development`. `bun run check:runtime` bundles the root export, fails if it touches the `Bun` global, and boots an application from the bundle under Node.js.

## Contributing

Issues for bugs and questions are welcome on [GitHub](https://github.com/na2axl/elysiumjs/issues). Pull requests are welcome too; they are reviewed to keep the framework consistent with its design.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](https://github.com/na2axl/elysiumjs/blob/main/LICENSE) file for more information.
