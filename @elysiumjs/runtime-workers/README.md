# @elysiumjs/runtime-workers

Cloudflare Workers runtime and adapter for [Elysium.js](https://github.com/na2axl/elysiumjs).

## Installation

```bash
bun add @elysiumjs/runtime-workers
```

## Usage

```ts
import { Application } from '@elysiumjs/core';
import { runtime } from '@elysiumjs/runtime-workers';

@Application.register({ runtime, modules: [] })
class App extends Application {}
```

The package exports `runtime`; rename it at import if you like: `import { runtime as workersRuntime } from '@elysiumjs/runtime-workers'`.

Environment variables come from `process.env`, which workerd fills from the Worker's vars and secrets with the `nodejs_compat` flag; use `createRuntime({ env })` to pass others. The host owns the server and the isolate: `serve` throws (export the app's `fetch` from the Worker), and exit and signals do nothing. `bun run check:runtime` checks that the bundle never touches the `Bun` global.

## The Worker entry

`createWorker()` builds the app and returns the handlers a Worker module exports: `fetch` serves the routes, `queue` hands each batch to its consumers, and `scheduled` runs the cron handlers. It also returns the root Elysia `app`; export it as `app` so that the AOT plugin below compiles the routes:

```ts
import { createWorker } from '@elysiumjs/runtime-workers';

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
import { Service, ServiceScope } from '@elysiumjs/core';
import { Workers, WorkersModule } from '@elysiumjs/runtime-workers';

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

`KeyvWorkersKV` is a Keyv store over a KV namespace, for the caches of `@elysiumjs/mnemosyne`. It reads the binding from the current invocation on every call. KV is eventually consistent and expires entries after at least 60 seconds, so shorter TTLs are rounded up.

```ts
MnemosyneModule.with({
	cache: { redis: false, stores: { kv: () => new KeyvWorkersKV({ binding: 'CACHE' }) } }
});

await Cache.store('kv').set('greeting', 'hello', 120_000);
```

`clear()` lists the keys of the namespace and deletes them, and each listed page and each deleted key is a subrequest. It stops at `maxOperations` (900 by default, under the 1000 subrequests of the paid plan; set 45 on the free plan), logs how many keys are left, and the next `clear()` goes on with them. `delete()` reads the key first, because the Keyv contract returns whether it existed; on eventually consistent KV that answer is best effort.

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
