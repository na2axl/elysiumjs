# @elysiumjs/workers

The Cloudflare Workers backend of [Elysium.js](https://github.com/na2axl/elysiumjs): the runtime and the Worker entry, bindings, queue and cron handlers, Heracles jobs on Cloudflare Queues, KV caches and sessions, rate limits, and flows and locks in Durable Objects.

| Port or store                  | Export                                              |
| ------------------------------ | --------------------------------------------------- |
| Runtime                        | `runtime`, `createRuntime()`, `createWorker()`      |
| Rate limits (`RateLimitStore`) | `WorkersRateLimitStore`                             |
| Cache store (mnemosyne)        | `KeyvWorkersKV`                                     |
| Heracles transport             | `CloudflareQueueTransport`, `HeraclesWorkersModule` |
| Flow store (ariadne)           | `durableFlowStore()`, `FlowStoreObject`             |
| Session store (themis)         | `KvSessionStore`                                    |
| `Lock` driver `durable-object` | `DurableObjectLock`, `LockObject`                   |

Durable Object classes come from the `@elysiumjs/workers/durable-objects` subpath, which imports `cloudflare:workers`; everything else comes from the root export, which runs anywhere, so tests can import it under Bun or Node.js.

## Installation

```bash
bun add @elysiumjs/workers
```

## Usage

```ts
import { Application } from '@elysiumjs/olympus';
import { runtime } from '@elysiumjs/workers';

@Application.register({ runtime, modules: [] })
class App extends Application {}
```

The package exports `runtime`; rename it at import if you like: `import { runtime as workersRuntime } from '@elysiumjs/workers'`.

Environment variables come from `process.env`, which workerd fills from the Worker's vars and secrets with the `nodejs_compat` flag; use `createRuntime({ env })` to pass others. The host owns the server and the isolate: `serve` throws (export the app's `fetch` from the Worker), and exit and signals do nothing. `bun run check:runtime` checks that the bundle never touches the `Bun` global.

## The Worker entry

`createWorker()` builds the app and returns the handlers a Worker module exports: `fetch` serves the routes, `queue` hands each batch to its consumers, and `scheduled` runs the cron handlers. It also returns the root Elysia `app`; export it as `app` so that the AOT plugin below compiles the routes:

```ts
import { createWorker } from '@elysiumjs/workers';

import { App } from './app';

const worker = await createWorker(new App());

export const app = worker.app;

export default worker;
```

Modules boot on the first invocation, whatever its kind, so building runs no `onInit` work.

workerd binds every I/O object (a stream, a request or response body, a socket) to the request that created it. A singleton's `onInit` runs during the first invocation, so it may do I/O and keep what it read, but it must not keep the I/O object itself: a later invocation that uses it fails with "Cannot perform I/O on behalf of a different request". Open such objects per invocation, in request-scoped services.

A singleton whose `onInit` calls its own app, through a service binding or a fetch to itself, deadlocks: the app holds every request until its boot has finished, and the boot waits for that response.

### Bindings

Each invocation runs with its own env and execution context. Read them with `Workers.env()`, `Workers.context()` and `Workers.binding(name)`, or inject them: `WorkersModule` provides the env (`workers.env`), the context (`workers.context`) and each binding it lists as global request-scoped services.

```ts
import { Service, ServiceScope } from '@elysiumjs/olympus';
import { Workers, WorkersModule } from '@elysiumjs/workers';

@Service.register({ scope: ServiceScope.REQUEST })
export class JobQueue {
	public constructor(@Workers.inject('JOBS') private readonly queue: Queue<Job>) {}

	public send(job: Job) {
		return this.queue.send(job);
	}
}

@Application.register({
	runtime,
	modules: [WorkersModule.with({ bindings: ['JOBS'] }), JobsModule]
})
export class App extends Application {}
```

A binding belongs to the invocation, so only request-scoped services, factories and request-scoped controllers take it: a singleton that depends on one throws `ScopeMismatchError`. Outside an invocation, reading a binding throws `OutsideInvocationError`.

### Queues and cron triggers

Mark methods of module services with `@Workers.queue(name)` or `@Workers.cron(expression)`. Each handler runs in its module, in a request scope of its own. A queue handler receives the batch, and the whole batch is retried when it throws. A cron handler receives the scheduled controller; the expression must match the one in the wrangler config. `*` matches every queue or cron. A batch or event no handler matches throws `NoWorkersHandlerError`. A named queue has one consumer, so that each message is acked or retried by one decision: two handlers of the same queue throw `DuplicateQueueConsumerError` when the Worker is created. `*` handlers, such as observers, are not counted.

```ts
@Service.register()
export class JobConsumer {
	@Workers.queue('jobs')
	public async handle(batch: MessageBatch<Job>) {
		for (const message of batch.messages) {
			await this.run(message.body);
			message.ack();
		}
	}

	@Workers.cron('*/5 * * * *')
	public async sweep(controller: ScheduledController) {}
}
```

With `@Workers.queue(name, { each: true })`, the handler receives one message at a time: a message it throws on is retried and the others are acked. Without `each`, the handler keeps batch semantics: it acks or retries messages itself, and the whole batch is retried when it throws.

Several handlers can match one queue. A message retried for one of them is delivered again to every matching handler, including those that already handled it, so queue handlers must be idempotent.

The handler types (`WorkersMessageBatch`, `WorkersScheduledController`, `WorkersKVNamespace`, ...) are structural, so the types from `@cloudflare/workers-types` or `wrangler types` fit them.

### KV cache

`KeyvWorkersKV` is a Keyv store over a KV namespace, for the caches of `@elysiumjs/olympus/mnemosyne`. It reads the binding from the current invocation on every call. KV is eventually consistent and expires entries after at least 60 seconds, so shorter TTLs are rounded up.

```ts
MnemosyneModule.with({
	cache: { stores: { kv: () => new KeyvWorkersKV({ binding: 'CACHE' }) } }
});

await Cache.store('kv').set('greeting', 'hello', 120_000);
```

`clear()` lists the keys of the namespace and deletes them, and each listed page and each deleted key is a subrequest. It stops at `maxOperations` (900 by default, under the 1000 subrequests of the paid plan; set 45 on the free plan), logs how many keys are left, and the next `clear()` goes on with them. `delete()` reads the key first, because the Keyv contract returns whether it existed; on eventually consistent KV that answer is best effort.

## Heracles jobs on Cloudflare Queues

Send the jobs of a queue to a Cloudflare Queue with `CloudflareQueueTransport`, and add `HeraclesWorkersModule` to consume them in the same Worker (or another one):

```ts
import { Application } from '@elysiumjs/olympus';
import { HeraclesModule } from '@elysiumjs/olympus/heracles';
import { CloudflareQueueTransport, HeraclesWorkersModule, runtime } from '@elysiumjs/workers';

@Application.register({
	runtime,
	modules: [
		HeraclesModule.with({
			queues: {
				emails: {
					transport: CloudflareQueueTransport,
					transportOptions: { binding: 'EMAILS', deadLetterQueue: 'EMAILS_DLQ' }
				}
			}
		}),
		HeraclesWorkersModule,
		MailModule
	]
})
class App extends Application {}
```

```jsonc
// wrangler.jsonc
{
	"queues": {
		"producers": [
			{ "binding": "EMAILS", "queue": "emails" },
			{ "binding": "EMAILS_DLQ", "queue": "emails-dlq" }
		],
		"consumers": [{ "queue": "emails" }]
	},
	"triggers": { "crons": ["0 3 * * *"] }
}
```

- A completed job is acked. A failed job is retried after its `retryDelay` while its attempts stay within `maxRetries`. After its last retry, it is logged and acked. When its queue's `transportOptions` set a `deadLetterQueue` binding, it is also sent there, with a `failure` member (error, attempts, time); each queue has its own. With `HeraclesWorkersModule.with({ onDead })`, it is also handed to `onDead`, whatever its queue.
- A job scheduled for later is delayed with `delaySeconds`, up to the 12 hours Cloudflare Queues allow.
- Cloudflare Queues keep no job status and cannot cancel a message: `getJobStatus()` throws, and cancellations are dropped with a warning.
- Each cron trigger dispatches the jobs of `@Scheduler.job()` and the `Scheduler` classes whose expression is exactly the trigger's expression, at the trigger's time. Times are UTC.
- Messages that carry no Heracles job are left to the Worker's other queue consumers.

## Flows in Durable Objects

`durableFlowStore()` keeps the flows of `@elysiumjs/olympus/ariadne` in Durable Objects, one object per flow. Export the object from the Worker's entry and declare it:

```ts
// worker.ts
export { FlowStoreObject } from '@elysiumjs/workers/durable-objects';
```

```jsonc
// wrangler.jsonc
{
	"durable_objects": { "bindings": [{ "name": "FLOWS", "class_name": "FlowStoreObject" }] },
	"migrations": [{ "tag": "v1", "new_sqlite_classes": ["FlowStoreObject"] }]
}
```

```ts
import { AriadneModule } from '@elysiumjs/olympus/ariadne';
import { durableFlowStore, Workers } from '@elysiumjs/workers';

AriadneModule.with({ store: durableFlowStore(() => Workers.binding('FLOWS')) });
```

Each flow lives in the object named `{flow}:{flowKey}`. A commit pushes its alarm to the flow's TTL. A finished flow keeps its last answer for up to 10 minutes, then only its owner and end time for its TTL, and then the object deletes its storage.

## Locks in Durable Objects

The `durable-object` driver of the `Lock` port keeps each key in its own Durable Object, so every isolate and every Worker that shares the binding sees the same holder. An alarm frees a key once its time to live ends.

```ts
// worker.ts
export { LockObject } from '@elysiumjs/workers/durable-objects';
```

```jsonc
// wrangler.jsonc
{
	"durable_objects": { "bindings": [{ "name": "LOCKS", "class_name": "LockObject" }] },
	"migrations": [{ "tag": "v1", "new_sqlite_classes": ["LockObject"] }]
}
```

```ts
import { Lock } from '@elysiumjs/olympus';
import { HeraclesModule } from '@elysiumjs/olympus/heracles';

import '@elysiumjs/workers';

HeraclesModule.with({ lock: Lock.for('durable-object') });
```

The binding defaults to `LOCKS`; pass `{ binding: 'OTHER' }`, the binding itself, or a function that returns it. A bounded wait (`acquire(key, ttl, { wait })`) tries again every `retryDelay` milliseconds (50 by default).

## Sessions in KV

`KvSessionStore` keeps the sessions of `@elysiumjs/olympus/themis` in a KV namespace:

```ts
import { ThemisModule } from '@elysiumjs/olympus/themis';
import { KvSessionStore, Workers } from '@elysiumjs/workers';

ThemisModule.with({
	secret: env.APP_SECRET,
	session: { store: new KvSessionStore({ namespace: () => Workers.binding('SESSIONS') }) }
});
```

KV is eventually consistent: a session saved in one location can take a few seconds to be seen in another. KV refuses expirations under 60 seconds, so a shorter session lives 60 seconds in KV.

## Compiling ahead of time

Workers forbid generating code at runtime (`new Function`), which Elysia does for validators unless the app is compiled ahead of time. With `@elysiumjs/hephaestus` installed, `styx build --target workers` bundles `src/worker.ts` this way into `dist/worker.js`. Without it, bundle the entry with Elysia's AOT plugin, which evaluates it at build time:

```ts
import { aot } from 'elysia/plugin/aot/bun';

await Bun.build({
	entrypoints: ['src/worker.ts'],
	outdir: 'dist',
	target: 'browser',
	format: 'esm',
	conditions: ['workerd', 'worker', 'browser'],
	external: ['node:*', 'cloudflare:*'],
	plugins: [aot('src/worker.ts', { target: 'workerd' })]
});
```

`bun run check:aot` compiles a sample app this way, checks that the bundle has no runtime code generation, and serves a validated route under Node.js with code generation from strings disallowed. `bun run check:wrangler` compiles the sample Worker in `scripts/worker` and runs it in `wrangler dev`: a route sends to a queue, the consumer and a cron handler write to the KV cache, and routes read it back.

## License

Apache-2.0
