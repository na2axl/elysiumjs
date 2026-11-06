# @elysiumjs/heracles-workers

Runs [Heracles](../heracles) jobs on Cloudflare Workers: Cloudflare Queues carry the jobs, and cron triggers dispatch the `@Schedule()` jobs.

## Installation

```bash
bun add @elysiumjs/heracles-workers
```

## Usage

Send the jobs of a queue to a Cloudflare Queue with `CloudflareQueueTransport`, and add `HeraclesWorkersModule` to consume them in the same Worker (or another one):

```ts
import { Application } from '@elysiumjs/core';
import { HeraclesModule } from '@elysiumjs/heracles';
import { CloudflareQueueTransport, HeraclesWorkersModule } from '@elysiumjs/heracles-workers';
import { runtime } from '@elysiumjs/runtime-workers';

@Application.register({
	runtime,
	modules: [
		HeraclesModule.with({
			queues: {
				emails: { transport: CloudflareQueueTransport, transportOptions: { binding: 'EMAILS' } }
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
		"producers": [{ "binding": "EMAILS", "queue": "emails" }],
		"consumers": [{ "queue": "emails" }]
	},
	"triggers": { "crons": ["0 3 * * *"] }
}
```

- A completed job is acked. A failed job is retried after its `retryDelay` while its attempts stay within `maxRetries`. After its last retry, it is logged and acked; with `HeraclesWorkersModule.with({ deadLetterQueue: 'JOBS_DLQ', onDead })`, it is also sent to that queue binding, as it was sent with a `failure` member (error, attempts, time), and handed to `onDead`.
- A job scheduled for later is delayed with `delaySeconds`, up to the 12 hours Cloudflare Queues allow.
- Cloudflare Queues keep no job status and cannot cancel a message: `getJobStatus()` throws, and cancellations are dropped with a warning.
- Each cron trigger dispatches the jobs whose `@Schedule()` expression is exactly the trigger's expression, at the trigger's time: a fan-out schedule selects its cases for that tick. Times are UTC.
- Messages that carry no Heracles job are left to the Worker's other queue consumers.
