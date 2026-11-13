# @elysiumjs/olympus

The Elysium.js framework: an application built from modules of controllers and services, wired by dependency injection and declared with decorators, on top of [ElysiaJS](https://elysiajs.com/). It runs on Bun, Node.js and Cloudflare Workers.

## Installation

```bash
bun add @elysiumjs/olympus
```

Add a runtime package too: `@elysiumjs/bun`, `@elysiumjs/node` or `@elysiumjs/workers` (see [Runtimes](#runtimes)), and `@elysiumjs/pino` for pino logs (see [Logging](#logging)).

## Exports

| Import                               | Contents                                                                                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@elysiumjs/olympus`                 | Application, modules, dependency injection, HTTP, WebSocket and WAMP controllers, middleware, interceptors, filters, problem details, configuration, environment, lifecycle events, logging, console commands, OpenAPI. |
| `@elysiumjs/olympus/mnemosyne`       | Models, repositories with events, pruning jobs, the query DSL, units of work, caches, seeders and an in-memory backend.                                                                                                 |
| `@elysiumjs/olympus/moirai`          | Actions and queries, idempotency, outbox, inbox and domain events.                                                                                                                                                      |
| `@elysiumjs/olympus/moirai/heracles` | Outbox effect that dispatches heracles jobs. Import it once in the process that relays the outbox.                                                                                                                      |
| `@elysiumjs/olympus/heracles`        | Background jobs: queues, schedules, fan-out, retries and dead letters. `MemoryTransport` runs jobs in the process.                                                                                                      |
| `@elysiumjs/olympus/ariadne`         | Multi-step flows with server-side state and replayable steps.                                                                                                                                                           |
| `@elysiumjs/olympus/themis`          | Authentication: sessions, guards, API keys, CSRF, TOTP, OAuth and passkeys.                                                                                                                                             |
| `@elysiumjs/olympus/harpocrates`     | Secrets and cryptography: password hashing (`Password` and the `PasswordHasher` port), encryption (the `Cipher` port), JWTs, signed URLs and hashing helpers.                                                           |
| `@elysiumjs/olympus/cerberus`        | Abilities: rules per domain composed over the facts of an actor, cached per version, and route and call checks.                                                                                                         |
| `@elysiumjs/olympus/hermes`          | Notifications: channels with fallback chains, the inbox, mail and broadcast channels, queued notifications and test fakes.                                                                                              |
| `@elysiumjs/olympus/hermes/heracles` | `NotificationJob`, which delivers queued notifications. List it in a module's `jobs`.                                                                                                                                   |
| `@elysiumjs/olympus/pithos`          | Storage and files: disks (the `Storage` port and the `memory` disk), signed URLs, file records (the `FileStore` port), claims and deferred uploads.                                                                     |
| `@elysiumjs/olympus/pithos/heracles` | `FilesPruner`, the base of the job that prunes files.                                                                                                                                                                   |

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
import { Application, LoggerModule } from '@elysiumjs/olympus';

import '@elysiumjs/pino';

import { RedisModule } from '@elysiumjs/redis';

import { MainModule } from './main.module';

@Application.register({
	modules: [
		LoggerModule.with({ level: 'debug', format: 'pretty' }),
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

## JSON and serializers

`Json` writes and reads JSON that keeps more than JSON does, for values that leave the process and come back. Each value a registered serializer supports is written as `{ "$type": "<name>", "$value": <serialized> }` and read back as it was, at any depth. Dates, maps, sets, bigints and byte arrays (`Uint8Array`, and `Buffer` where the runtime has it) are supported out of the box (subclasses of `Map` and `Set` are not, since they would read back as plain ones), and `@elysiumjs/olympus/mnemosyne` adds model instances; a plain object that already has the shape of a tagged value is escaped, so that it reads back unchanged.

```ts
import { Json } from '@elysiumjs/olympus';

const text = Json.stringify({ remindAt: new Date('2026-01-01T09:00:00Z'), tags: ['a'] });
Json.parse<{ remindAt: Date }>(text).remindAt; // a Date

Json.parse<{ tags: Set<string> }>(Json.stringify({ tags: new Set(['a']) })).tags; // a Set
Json.survives({ cache: new WeakMap() }); // false: no serializer supports a weak map
```

The caches of `@elysiumjs/olympus/mnemosyne` write their values with `Json` in every store, the memory store included, so a read answers a copy, with its dates, model instances and the values of the registered serializers.

A serializer extends `Serializer<TIn, TOut>` and is registered with a name, which every written value carries, so keep it stable across deploys:

```ts
import { Serializer } from '@elysiumjs/olympus';

@Serializer.register({ name: 'money' })
export class MoneySerializer extends Serializer<Money, { amount: string; currency: string }> {
	public supports(value: unknown): boolean {
		return value instanceof Money;
	}

	public serialize(money: Money) {
		return { amount: money.amount.toString(), currency: money.currency };
	}

	public deserialize(value: { amount: string; currency: string }) {
		return new Money(BigInt(value.amount), value.currency);
	}
}
```

- Serializers are asked highest `priority` first (0 by default, as the built-in serializers), and the first that supports a value writes it. A serializer with a higher priority replaces a built-in one.
- What `serialize()` answers is written with `Json` again, so it may hold dates or other serializable values; `deserialize()` receives it read back.
- Registering two classes under one name throws `DuplicateSerializerError`. Reading a value whose serializer is not registered throws `UnknownSerializerError`: only registered serializers rebuild values, so stored JSON cannot create other classes. Import the serializers in every process that reads the values, such as the workers of a queue.

`Json.encode()` and `Json.decode()` do the same on values, for a transport that serializes on its own. `Json.survives()` accepts only `null`, booleans, finite numbers, strings, values a serializer supports, and arrays and plain objects of those.

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

Repositories answer instances of their model: each holds the column values of a row as its own properties, typed by the model's select type, with the getters and methods of the model class. `hidden` names the columns left out of the JSON form of an instance, and `appends` the getters written in it; `ModelResource(Model)` follows both. A custom query on `this.db` answers rows: `this.hydrate(rows)` turns them into instances. A column a model class names again is declared with `declare`, so that a class field does not reset it.

```ts
class ArticleModel extends MemoryModel<Article>('articles') {
	public static override readonly hidden = ['editToken'] as const;
	public static override readonly appends = ['isPublished'] as const;

	public get isPublished(): boolean {
		return this.publishedAt !== null;
	}
}
```

Each model has a `modelName`, unique and stable across deploys: the name the backend gives its table by default (`schema.table` with Drizzle). Instances are written by `Json` as their model name and columns, and read back as instances of the same class, so they survive the caches and the inputs of queued actions. A model is known by name once a repository is created over it, it hydrates rows, or one of its instances is written; `Models.register(Model)` registers one by hand. Two classes with the same name are refused: a subclass of a model inherits its name, so it gives itself another.

Repositories can read through a cache. `MnemosyneModule.with({ repositories: { cache } })` sets the cache of every repository; a repository class merges its own `static cache` over it, or sets it to `false` to never cache. Without either, a repository does not cache.

```ts
MnemosyneModule.with({
	cache: { stores: { redis: () => new KeyvRedis({ connection: 'cache' }) } },
	repositories: { cache: { store: 'redis', ttl: 300_000 } }
});

export class SessionRepository extends Repository(SessionModel) {
	public static override readonly cache = { ttl: 30_000 }; // over the defaults
}

export class LedgerRepository extends Repository(LedgerEntryModel) {
	public static override readonly cache = false; // never cached
}
```

`find()` reads a row by its key through the cache, and `findBy()` caches the key of the row it found, then reads the row by its key and checks its value, which suits unique columns. Rows are kept for `ttl` milliseconds, one hour by default, per model, digest of the table's columns, tenant and connection: a change of the columns never reads back rows cached before it, and the rows of a model without tenancy are shared by every tenant, unless tenancy uses row-level security. Missing rows are not cached, and `insert()` leaves the cache as it is.

Each cached row is stamped with the version of its row and the generation of the tenant's rows. `update()` and `delete()` give their row a new version, right away and once the unit of work or the transaction commits; `updateAll()`, `deleteAll()` and `deleteWhere()` give the tenant's rows a new generation. A read that loaded a row while a write changed it therefore never leaves that row in the cache. A repository that does not read through the cache still forgets its writes in the cache of the module, so that the repositories of its model that do cache never read them stale. Reads skip the cache while a unit of work or a transaction is open, so that it never holds rows that may roll back. A cache that fails, or that does not exist, costs a read of the database, never the call, and is logged.

Custom queries on `this.db` do not go through the cache: a repository that writes with them calls `this.forgetCached(id)` or `this.forgetAllCached()` for what they change.

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

`getLogger()` answers the app's `logger` service, or a plain console logger when there is none. `LoggerModule` provides that service from the `Logger` port, through the driver its `transport` names:

- `console` (in olympus): one JSON object per line through `console`, with no dependency. The default on Cloudflare Workers, and wherever no other driver is loaded.
- `pino` (in `@elysiumjs/pino`): JSON lines, or readable ones with `format: 'pretty'`. Importing the package registers it and makes it the default.

```ts
import { getLogger, LoggerModule } from '@elysiumjs/olympus';

import '@elysiumjs/pino';

LoggerModule.with({ name: 'shop', level: 'debug', format: 'pretty' });

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

The job runs without the caller's context, such as the current user: what the handler needs goes in the input, which travels as JSON, in clear. It is written with `Json`, so dates and the values of registered serializers come back as they were; an input that `Json.survives()` refuses, such as a function or a class instance without a serializer, is refused with `QueuedInputError`. The input is validated again once it is read back, so the schema of a value read by a serializer must accept its instance. The job finds the action by its name, so two action classes cannot share one (`DuplicateActionNameError`).

A refusal of the handler ends the job, logged. A thrown error fails it, and Heracles retries it within the `maxRetries` of the queue (never for an action registered with `retry: false`). A job may run more than once, so give an action that must not an idempotency key: a second run replays the stored response. The job trusts its queue: `authorize` ran when the call was queued, so anything that can write to the queue can run any registered action.

## Notifications

A notification is a class built with its data. `channels()` says where it goes for each notifiable, and each channel has a method, named after it, that answers the message of that channel. An entry of `channels()` is a channel, or a fallback chain tried in order until one channel delivers:

```ts
import type { Notifiable } from '@elysiumjs/olympus/hermes';

import { InboxMessage, LogMessage, MailMessage, Notification } from '@elysiumjs/olympus/hermes';

@Notification.register({ type: 'invoice.paid', queue: 'notifications' })
export class InvoicePaid extends Notification<{ invoiceId: string; amount: number }> {
	public channels() {
		// Keep it in the inbox, and send a mail, or write to the log when no mail can go.
		return ['inbox', ['mail', 'log']] as const;
	}

	public canSend(notifiable: Notifiable, channel: string) {
		return true; // such as the preferences of the user
	}

	public inbox() {
		return new InboxMessage({ invoiceId: this.data.invoiceId, amount: this.data.amount });
	}

	public mail() {
		return new MailMessage()
			.subject('Your invoice is paid')
			.greeting('Hello!')
			.line(`We received ${this.data.amount}.`)
			.action('See the invoice', `https://example.com/invoices/${this.data.invoiceId}`);
	}

	public log() {
		return new LogMessage('An invoice was paid, with no mail address to send it to');
	}
}

await Notification.send(user, new InvoicePaid({ invoiceId, amount: 1200 }));
await Notification.route('mail', 'ada@example.com').notify(
	new InvoicePaid({ invoiceId, amount: 1200 })
);
```

A notifiable implements `Notifiable`: a `notifiableId` (the key of its inbox), an optional `notifiableType`, `routeNotificationFor(channel)` (an address, a phone number, or `null`, or a promise of it) and, optionally, `preferredLocale()`. `Notification.route()` reaches someone at an address only, with no inbox.

`@Notification.register()` type-checks that the class has a method for each channel its `channels()` names, answering the message that channel accepts, and that its constructor takes its data only. A channel of a chain is passed over when `canSend()` refuses it, when the channel is not available (`isAvailable()`), or when it throws `ChannelRejected`; any other error fails that delivery.

- `Notification.send()` checks the channels first, and for a queued notification its data and routes, so that a mistake throws at the call. It then queues the notification when it is registered with a `queue`, and delivers it right away otherwise. In a unit of work, it waits for the commit and is dropped on rollback, unless registered with `afterCommit: false`; a delivery that fails after the commit is logged.
- `Notification.sendNow()` delivers right away and answers, for each notifiable and entry, the channel that delivered it (`null` when none could).
- A delivery that fails does not stop the others: once they are done, `NotificationDeliveryError` lists the failures, with the deliveries that went through.
- The channels emit `elysium:hermes:sending`, `elysium:hermes:sent` and `elysium:hermes:failed`, with the notification, the notifiable, the message, and what the channel answered or the error. A listener that throws is logged, and does not fail the delivery.

### Queued notifications

A queued notification becomes one Heracles job per notifiable and per entry; a fallback chain runs in order inside its job. List `NotificationJob` from `@elysiumjs/olympus/hermes/heracles` in a module's `jobs`, next to `HeraclesModule` and its queue:

```ts
import { NotificationJob } from '@elysiumjs/olympus/hermes/heracles';

@Module.register({ jobs: [NotificationJob] })
class AppModule extends Module {}
```

`delay` (in milliseconds, or one per channel, read from the first channel of the entry), `priority` and `maxRetries` in `@Notification.register()` apply to its jobs. In a unit of work, the jobs go to the outbox of moirai when the module has one, so that they are dispatched once the unit commits even if the process stops in between; without an outbox, they are dispatched after the commit.

The job rebuilds the notification from its type and data, so the data must pass `Json.survives()`. The notifiable is recorded as its id, its type, its locale and its routes for the channels of the entry, which travel in clear on the queue. In the job, `canSend()`, the channels and the channel methods receive that record, unless a resolver is registered for the `notifiableType`: the notifiable is then read again, so that the job sees its current routes and preferences, and a resolver that answers `null` drops the notification:

```ts
@Notification.resolver('user')
@Service.register()
export class UserResolver implements NotifiableResolver {
	constructor(@Service.inject() private readonly users: UserRepository) {}

	async resolve(id: string) {
		const user = await this.users.find(id);
		return user ? new UserRecipient(user) : null;
	}
}
```

A job may run more than once. Each delivery has an id, kept with the job: the inbox keeps one notification per delivery id, and mail transports receive it as `id`, to drop a second mail. With the inbox store of moirai and a database, a delivery that completed is recorded and does not run again.

### Channels

| Channel     | Message            | What it does                                                                                                      |
| ----------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `inbox`     | `InboxMessage`     | Keeps the data in the notification store, for notifiables with an id. Read it with `Notification.store()`.        |
| `mail`      | `MailMessage`      | Draws the message with the mail renderer and sends it through the mail transport, to the `mail` route.            |
| `broadcast` | `BroadcastMessage` | Emits `elysium:hermes:broadcast` with the event name and data, for a WebSocket or a stream of the app to forward. |
| `log`       | `LogMessage`       | Writes a line to the application log.                                                                             |

An app or a package adds a channel with a class and its message, declared in `NotificationChannels`:

```ts
export class SmsMessage {
	constructor(public readonly text: string) {}
}

declare module '@elysiumjs/olympus/hermes' {
	interface NotificationChannels {
		sms: SmsMessage;
	}
}

@Notification.channel('sms', { message: SmsMessage })
export class SmsChannel implements NotificationChannel<SmsMessage> {
	async isAvailable(notifiable: Notifiable) {
		return (await notifiable.routeNotificationFor('sms')) !== null;
	}

	async send(notifiable: Notifiable, message: SmsMessage, context: ChannelContext) {
		const to = await notifiable.routeNotificationFor('sms');
		const response = await provider.send(to, message.text, { idempotencyKey: context.id });
		if (response.status === 400) throw new ChannelRejected('Unknown number');
		return { id: response.id };
	}
}
```

A channel or resolver that needs services is listed in a module's `services`; it then runs in that module.

### Inbox and mail

`HermesModule.with()` provides the notification store (`memory` by default; `@elysiumjs/drizzle` provides a PostgreSQL one), the mail transport (`log` by default, which writes mails to the log), the mail renderer (`basic` by default) and the default sender:

```ts
HermesModule.with({
	store: () => NotificationStore.for('drizzle', { table: notifications }),
	mail: { transport: () => new SmtpTransport(), from: 'Example <hello@example.com>' }
});

const owner = { notifiableId: user.id, notifiableType: 'user' };
const page = await Notification.store().list(owner, { unread: true, limit: 20 });
await Notification.store().markAsRead(owner, [page.items[0].id]);
```

An inbox belongs to a `notifiableId` and its `notifiableType`, since two types may share ids. The store pages newest first, by the time each notification was kept, counts unread notifications, marks them as read and deletes them. The `basic` renderer lays out the greeting, lines, buttons and salutation as text and HTML; a message drawn with `view(name, data)` needs a renderer of the app, given as `mail.renderer`, that implements `MailRendererDriver`. `Mail.send()` sends a mail through the transport outside notifications too, with the default sender when the mail names none.

### Notifications in tests

```ts
using notifications = Notification.fake();
using mails = Mail.fake();

await Moirai.execute(PayInvoice, { invoiceId });

notifications.assertSentTo(user, InvoicePaid, (n) => n.data.invoiceId === invoiceId);
notifications.assertNotSentTo(admin, InvoicePaid);
mails.assertNothingSent();
```

A faked notification records what `channels()` answered for each notifiable, and delivers nothing; a queued one still has its data and routes checked. `restore()`, or the end of a `using` block, turns a fake off, and `HermesModule` turns both off when the application stops.

## Storage and files

`@elysiumjs/olympus/pithos` stores files on disks, follows each file in a record, and lets clients upload straight to a disk.

### Disks

`Storage` is a port. A disk stores objects under keys such as `avatars/42.webp`: `put(key, body, { contentType, metadata })`, `get(key)` (a stream with `bytes()` and `text()`), `head`, `exists`, `delete`, `list({ prefix, cursor, limit })`, `copy`, `move`, `url(key)` for a public disk and `signedUrl(key, { method, expiresIn, contentType, contentLength })` for direct downloads and uploads. A key is a relative path: an empty segment, `.`, `..` or a backslash is refused.

The `memory` disk ships here. The runtime packages add the others: `local` from `@elysiumjs/node` (`node:fs`) or from `@elysiumjs/bun` (`Bun.file`), whichever runtime package the application imports, and `r2` from `@elysiumjs/workers`. `PithosModule` gives the disks of the application names, and `Storage.disk(name)` answers them, the default disk without a name:

```ts
import '@elysiumjs/node';

import { PithosModule, Storage } from '@elysiumjs/olympus/pithos';

PithosModule.with({
	disks: {
		public: () =>
			Storage.for('local', { root: './storage/public', url: 'https://cdn.example.com' }),
		uploads: () =>
			Storage.for('local', {
				root: './storage/uploads',
				signing: { url: 'https://api.example.com/storage/uploads', secret: env.STORAGE_SECRET }
			})
	},
	default: 'public'
});

await Storage.disk().put('reports/2026-01.csv', csv, { contentType: 'text/csv' });
```

A disk that cannot sign URLs itself, such as `memory` or `local`, signs them with `signing`, and `PithosModule` serves them on `/storage/:disk/*`: `GET` downloads the object and `PUT` uploads it, with the content type and size the URL was signed for: a `PUT` without a `content-length` header answers 411. Downloads are sent with `x-content-type-options: nosniff` and a sandboxing `content-security-policy`, so uploaded content never runs as a page of the application's origin. `signing.url` is that route followed by the name of the disk.

`Storage.fake(name?)` replaces a disk with an empty memory disk until `Storage.restore()`, which `PithosModule` also calls when the application stops.

### Files

A file is an object of a disk with a record: its purpose, disk, key, content type, size, owner (`{ type, id }`), who uploaded it, and its status. One record follows a file from its upload to its deletion: `pending` while it is uploaded, `finishing` while `Uploads.finish()` checks it, then `ready`, or `rejected` when the uploaded file is not what was declared, `expired` when it was never uploaded, and `deleted` once its object is gone. The records live in the `FileStore` port: `memory` ships here, and `@elysiumjs/drizzle` adds `drizzle`.

A ready file that nothing claims is deleted after `unclaimedTtl`. A feature keeps a file by claiming it, and lets it go by releasing it:

```ts
import { Files } from '@elysiumjs/olympus/pithos';

// A profile keeps its new picture...
const claimed = await Files.claim(input.pictureId, {
	purpose: 'avatar',
	owner: { type: 'user', id: user.id }
});
if (!claimed.check()) return claimed.error; // FILE_NOT_READY

// ...and lets the previous one go.
if (profile.pictureId)
	await Files.release(profile.pictureId, { owner: { type: 'user', id: user.id } });
```

`Files.ready(id, expect)` makes the same checks without claiming: ready, not past its time and, when given, of the purpose and the owner. `Files.release(id, { grace, purpose, owner })` lets the file be deleted after `grace` seconds (0 by default) unless it is claimed again, and `Files.remove(id, { purpose, owner })` deletes a ready file now; both do nothing to a file of another purpose or owner than given. A file has one keeper: a feature that shares a file with another keeps track of it itself. `Files.remove()` deletes the object at once, so inside a unit of work call it once the work has committed. `Files.url(file)` and `Files.signedUrl(file, expiresIn)` answer its URLs. Every change is a transition that applies only while the record still meets its condition, so two requests racing on a file cannot both win.

`Files.prune(limit?)` deletes the files whose time is over: uploads never finished (their staged object) and ready files nothing claims (their object). A file claimed in the meantime is kept. It then deletes the staged objects whose upload URL has expired, such as bytes sent again through a URL after its upload finished. Register a subclass of `FilesPruner`, from `@elysiumjs/olympus/pithos/heracles`, on a schedule to run it:

```ts
import { Job, Scheduler } from '@elysiumjs/olympus/heracles';
import { FilesPruner } from '@elysiumjs/olympus/pithos/heracles';

@Job.register({ queue: 'maintenance' })
@Scheduler.job('*/15 * * * *')
export class PruneFiles extends FilesPruner {}
```

`PithosModule.with({ files })` sets the store and how files live:

```ts
PithosModule.with({
	disks,
	files: {
		store: () => FileStore.for('drizzle', { table: files }),
		uploadTtl: 900, // seconds an upload URL works (default 15 minutes)
		unclaimedTtl: 86_400, // seconds a ready file nothing claims is kept (default a day)
		maxPending: 10, // uploads one person may have in progress (default 10)
		staging: 'staging' // the disk uploads are sent to (the disk of each file without it)
	}
});
```

Uploads are sent to `staging/<id>` keys, on the disk of the file unless `staging` names another. Staged objects are not checked yet, so on a public disk they can be read by their URL until they are finished or pruned: give a public disk a private staging disk. No purpose may be named `staging`.

The `elysium:pithos:ready`, `elysium:pithos:rejected` and `elysium:pithos:deleted` lifecycle events carry the file.

### Uploads

An upload purpose says what files of a use may be and who may upload them. When the class is listed in the services of a module, the container builds it in that module, so it can inject what it needs:

```ts
import type { FileOwner } from '@elysiumjs/olympus/pithos';

import { Upload } from '@elysiumjs/olympus/pithos';

@Upload.purpose('avatar')
@Service.register()
export class AvatarUpload extends Upload {
	constructor(@Service.inject() private readonly limits: UploadLimits) {
		super();
	}

	get disk() {
		return 'public';
	} // the default disk without it
	get types() {
		return ['image/png', 'image/jpeg', 'image/webp'];
	}
	get maxBytes() {
		return this.limits.avatarBytes;
	}
	get owners() {
		return ['user'];
	} // any kind of owner without it

	authorize(owner: FileOwner, user: string | undefined) {
		return owner.id === user;
	}
}
```

The client asks to upload, sends the bytes straight to the disk, then asks the server to finish. Here, with the signed-in user of `@elysiumjs/olympus/themis`:

```ts
@Http.post('/uploads', { errors: OPEN_UPLOAD_ERRORS })
async open(@Http.body(StartUpload) body: StartUpload, @Auth.user() user: AuthUser) {
	const ticket = await Uploads.open({ ...body, owner: { type: 'user', id: user.id }, user: user.id });
	if (!ticket.check()) return ticket.error;
	const { file, url, method, headers, expiresAt } = ticket.result;
	return { id: file.id, url, method, headers, expiresAt }; // PUT the bytes to url with headers
}

@Http.post('/uploads/:id/finish', { errors: FINISH_UPLOAD_ERRORS })
async finish(@Http.param('id') id: string, @Auth.user() user: AuthUser) {
	return Uploads.finish(id, { user: user.id });
}
```

`Uploads.open()` checks the request against its purpose (`UPLOAD_PURPOSE_UNKNOWN`, `UPLOAD_TYPE_NOT_ALLOWED` with `types`, `UPLOAD_TOO_LARGE` with `maxBytes`, `FORBIDDEN`, and `UPLOAD_TOO_MANY_PENDING` past `maxPending`; a size below 1 byte answers `BAD_REQUEST`), records a `pending` file, and answers a signed `PUT` URL for a staging key, signed for the declared content type and size. The URL never targets the key the file is served from, since a signed URL cannot be taken back.

`Uploads.finish()` reads the staged object once, and refuses it for good (`UPLOAD_REJECTED`) unless its size, its stored content type and its first bytes, read with `file-type`, all match what was declared. Only then are those same bytes written to the file's key, the file made `ready`, and the staged object deleted, so an upload racing through the still valid URL cannot swap the bytes in between. Nothing uploaded yet answers `UPLOAD_MISSING`, and the client may upload and finish again; a finished upload, or one another call is finishing, answers `UPLOAD_NOT_PENDING` and an expired one `UPLOAD_EXPIRED`. A purpose whose types have no signature, such as `text/plain` or `image/svg+xml`, turns the content check off with `get sniff() { return false; }`.

A ready file is served from `<purpose>/<id>` by default, so a new file is a new key and a served file can be cached for good. A purpose may override `key(file)`, as long as the key holds the id of the file, so two files never share an object, and does not start with `staging/`. `finish()` holds the file in memory while it checks it, so keep `maxBytes` to what a request may hold.

## Abilities

`@elysiumjs/olympus/cerberus` decides what an actor may do with [CASL](https://casl.js.org) abilities. Each domain declares its rules, the app gives the facts of an actor, and the rules of every domain are composed over those facts. Rules read only the facts, never a service or the database, so a built ability can be cached.

Declare the facts and the subject names once, by declaration merging, then write the rules of a domain as a class listed in the services of its module:

```ts
import type { AbilityFacts, AbilityRules, GrantRule } from '@elysiumjs/olympus/cerberus';

import { Abilities } from '@elysiumjs/olympus/cerberus';

declare module '@elysiumjs/olympus/cerberus' {
	interface AbilityFacts {
		userId: string;
		roles: string[];
	}

	interface AbilitySubjects {
		Post: true;
	}
}

@Abilities.rules('posts')
export class PostRules implements AbilityRules {
	public define(facts: AbilityFacts, can: GrantRule, cannot: GrantRule) {
		can('read', 'Post', { status: 'published' });
		can('update', 'Post', { authorId: facts.userId });
		if (facts.roles.includes('moderator')) can('delete', 'Post');
		cannot('delete', 'Post', { locked: true });
	}
}
```

`Abilities.compose(facts)` builds one ability from the rules of every domain, in the order of their modules: as in CASL, a later rule wins over an earlier one, so a `can('manage', 'all')` of a later domain lifts the `cannot` of an earlier one. A rules class that no module lists in its services is left out, and `Abilities.from(rules)` from rules alone, such as in a domain's tests. A check on an instance reads the `static subjectName` of its class, and a plain object is tagged with `Abilities.subject('Post', post)`; class names are never read, since bundlers rename them. `Abilities.pack(ability)` gives a compact form of the rules, for a token or a response, and `Abilities.unpack(packed)` the ability back.

`CerberusModule` gives the facts of an actor, with a version that changes whenever a fact the rules read changes, such as a counter the app bumps in the same transaction:

```ts
CerberusModule.with({
	facts: async (userId) => {
		const user = await users.find(userId);
		return user?.active
			? { version: user.abilityVersion, facts: { userId, roles: user.roles } }
			: null;
	},
	cache: () => Cache.store('kv'), // the memory cache of MnemosyneModule by default; false for none
	ttl: 604_800, // seconds a cached ability is kept (default 7 days)
	rulesVersion: env.BUILD_COMMIT // changes the fingerprint of the rules
});
```

`Abilities.of(actorId)` answers the ability of an actor, from the cache when it was built for the same version of the facts and the same rules, or `undefined` for an actor without facts. `Abilities.fingerprint()` is a digest of the source of every `define` method and of `rulesVersion`: when rules also read helpers, constants or imported maps, set `rulesVersion` to a value that changes with each build, such as its commit. Entries are kept per tenant in context, rules whose conditions hold values JSON cannot keep, such as an `undefined` fact or a `Date`, are built on each call instead, and a cache that fails costs a build, never the check. `Abilities.forget(actorId)` drops the cached ability early, such as once a change of facts has committed.

The checks read the ability of the current actor: the themis user (`Auth.currentUser()`), its `id` or the user itself when a guard answers an id, unless `actor` says otherwise. A check on a subject name passes when some rule allows the action on some subjects of that name, whatever its conditions, so it fits routes and calls; check the record itself, once loaded, before acting on it:

```ts
@Http.controller('/posts')
@Auth() // the controller's middlewares run before the checks of its routes
class PostsController {
	@Http.post('/')
	@Cerberus.can('create', 'Post') // FORBIDDEN otherwise; @Cerberus.cannot() for the opposite
	public create() {}
}

const UpdatePostInput = t.Object({ id: t.String(), title: t.String() });

@Action.register({
	input: UpdatePostInput,
	errors: [ForbiddenError],
	authorize: Cerberus.may('update', 'Post') // may update some posts
})
class UpdatePost extends Action<Static<typeof UpdatePostInput>> {
	public async handle(input: Static<typeof UpdatePostInput>) {
		const post = await posts.find(input.id);
		// The stored post, never the input: a caller chooses what it sends.
		if (!post || !(await Cerberus.check('update', Abilities.subject('Post', post)))) {
			return new ForbiddenError('You cannot update this post.');
		}
		// ...
	}
}
```

`Cerberus.ability()` answers the ability of the current actor, built once per request, and `Cerberus.check(action, subject)` whether it allows an action. `@elysiumjs/drizzle` turns the same rules into a SQL condition with `rulesToDrizzle()`, so a list answers only the rows the actor may act on.

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
