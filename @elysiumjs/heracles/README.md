# Heracles

> Robust background job processing for Elysium.js applications

Heracles is a powerful background job processing system for Elysium.js applications. It provides a flexible and scalable solution for running tasks in the background, managing queues, and distributing workloads across multiple workers using Redis as the transport.

## Features

- **Job queues**: Organize jobs into different queues with custom settings
- **Transports**: Abstract communication layer between queues and workers
- **Scheduling**: Schedule jobs to run at specific times
- **Retries**: Automatically retry failed jobs with configurable backoff
- **Prioritization**: Assign priorities to jobs within a queue

## Installation

```bash
bun add @elysiumjs/heracles
```

## Quick Start

### 1. Register the Module

Queues are declared on `HeraclesModule`. The Redis transport reads its connection from a `RedisModule`.

```typescript
import { Application, RedisModule } from '@elysiumjs/core';
import { HeraclesModule, RedisTransport } from '@elysiumjs/heracles';

import { MainModule } from './main.module';

@Application.register({
	modules: [
		RedisModule.with({
			default: 'cache',
			connections: { cache: { url: process.env.REDIS_URL! } }
		}),
		HeraclesModule.with({
			queues: {
				emails: { transport: RedisTransport }
			}
		}),
		MainModule
	]
})
export class App extends Application {}
```

### 2. Create a Job

```typescript
import { Job } from '@elysiumjs/heracles';

@Job.register({
	queue: 'emails',
	maxRetries: 3,
	retryDelay: 5000
})
export class SendEmailJob extends Job {
	constructor(
		private readonly email: string,
		private readonly subject: string,
		private readonly body: string
	) {
		super();
	}

	protected async execute(): Promise<void> {
		// Implementation for sending an email
		this.info(`Sending email to ${this.email}: ${this.subject}`);

		// Simulate email sending
		await Bun.sleep(1000);

		this.success(`Email sent successfully to ${this.email}`);
	}
}
```

List the job in the `jobs` of the module that owns it. Heracles collects the jobs of every loaded module:

```typescript
import { Module } from '@elysiumjs/core';

import { SendEmailJob } from './jobs/send-email.job';

@Module.register({
	jobs: [SendEmailJob]
})
export class MainModule extends Module {}
```

### 3. Dispatch a Job

Dispatching starts the queue's transport on first use, so a producer (such as your web server) needs no extra setup.

```typescript
import { Heracles } from '@elysiumjs/heracles';

await Heracles.dispatch(SendEmailJob, ['user@example.com', 'Welcome!', 'Welcome to our platform!']);

await Heracles.dispatch(
	SendEmailJob,
	['user@example.com', 'Welcome!', 'Welcome to our platform!'],
	{
		priority: 5, // Higher priority (lower number)
		scheduledFor: new Date(Date.now() + 60000), // Run after 1 minute
		maxRetries: 5 // Override max retries
	}
);
```

### 4. Start Workers

Add `StyxModule` to your application, then use `styx` to launch Heracles workers (`heracles:work` boots every module before it runs):

```bash
# Start a Redis worker for the 'emails' queue with concurrency of 3 jobs
bun styx heracles:work --id worker-1 --queues emails --concurrency 3 --redis default

# Start workers for multiple queues
bun styx heracles:work --id worker-2 --queues emails,notifications --redis default
```

Or programmatically:

```typescript
import { RedisWorker } from '@elysiumjs/heracles';

const worker = new RedisWorker('default', { id: 'worker-1' });
await worker.createQueue({ name: 'emails', concurrency: 3 });
await worker.start();
```

## Configuration

### Queue Options

Each entry of `queues` accepts the queue options:

```typescript
HeraclesModule.with({
	queues: {
		emails: {
			// Maximum number of concurrent jobs to process in this queue
			concurrency: 5,

			// Maximum number of retries for failed jobs
			maxRetries: 3,

			// Delay in milliseconds between retries
			retryDelay: 5000,

			// Whether to pause processing when an error occurs
			pauseOnError: false,

			// Transport class and its options
			transport: RedisTransport,
			transportOptions: {
				connection: 'default'
			}
		}
	}
});
```

### Redis Transport Configuration

Heracles has a bundled Redis transport layer for job distribution, enabling distributed processing across multiple servers or processes. It uses Redis Streams for reliable message delivery and job coordination.

#### 1. Configure Redis Connection

Declare the connection with `RedisModule` in your application (see step 1 above). `connection: 'default'` resolves to the connection named by `RedisModule`'s `default`.

#### 2. Configure Queues with Redis Transport

```typescript
HeraclesModule.with({
	queues: {
		emails: {
			transport: RedisTransport,
			transportOptions: {
				connection: 'default', // Redis connection name
				keyPrefix: 'myapp:jobs', // Prefix for Redis keys (default: 'elysium:heracles')
				consumerGroup: 'workers', // Redis consumer group name (default: 'workers')
				statusTTL: 86400, // Job status TTL in seconds (default: 86400 - 24 hours)
				cleanupCompletedJobs: true, // Auto-cleanup completed jobs (default: true)
				completedJobRetention: 3600, // Time to retain completed jobs in seconds (default: 3600 - 1 hour)
				maxStreamSize: 1000 // Maximum stream size (default: 1000)
			}
		}
	}
});
```

#### 3. Worker Configuration

Configure workers to process jobs from Redis queues:

```typescript
import { RedisWorker } from '@elysiumjs/heracles';

// Create a Redis worker with a unique ID
const worker = new RedisWorker('default', {
	id: 'worker-1', // Unique worker ID
	consumerGroup: 'workers', // Redis consumer group name (default: 'workers')
	consumerName: 'worker-1', // Unique consumer name (optional)
	keyPrefix: 'myapp:jobs', // Use same prefix as queue configuration
	pollInterval: 1000, // Poll interval in ms (default: 1000)
	batchSize: 10 // Batch size for processing jobs (default: 10)
});

// Configure queue settings
await worker.createQueue({
	name: 'emails',
	concurrency: 5, // Process 5 jobs concurrently
	maxRetries: 3, // Retry failed jobs up to 3 times
	retryDelay: 5000, // Wait 5 seconds between retries
	pauseOnError: false // Don't pause queue on error
});

// Start the worker
await worker.start();
```

## Job Lifecycle

Jobs in Heracles go through several statuses:

1. **PENDING**: Job is queued but not yet started
2. **RUNNING**: Job is currently being processed
3. **COMPLETED**: Job has successfully completed
4. **FAILED**: Job has failed (may be retried if retries are available)
5. **CANCELLED**: Job was cancelled and won't be processed
6. **SCHEDULED_FOR_RETRY**: Job has failed and is scheduled for retry

## Advanced Usage

### Job Cancellation

```typescript
// Cancel a specific job
const jobId = await Heracles.dispatch(HelloWorldJob);
const cancelled = await queue.cancelJob(jobId);

// Cancel all jobs in a queue
const cancelledCount = await queue.cancelAllJobs();
```

### Queue Management

```typescript
// Pause a queue (stop processing new jobs)
await queue.pause();

// Resume a paused queue
await queue.resume();

// Drain a queue (complete current jobs but don't accept new ones)
await queue.drain();

// Clear all jobs from a queue
await queue.clear();
```

## CLI Reference

Heracles commands are available via the [`styx`](https://www.npmjs.com/package/@elysiumjs/styx) CLI tool:

### Start Workers

```
Usage: styx heracles:work [options]
Description: Start an Heracles worker for specific queues.

Arguments:
 --id <string> (required)
    Unique identifier for this worker

 --queues <array of strings> (required) [default: default]
    List of queues to work on

 --concurrency <number> (required) [default: 1]
    Number of concurrent jobs to process

 --redis <string> (required) [default: default]
    Name of the Redis connection to use

 --max-retries <number> (optional) [default: 3]
    Maximum retries for failed jobs before giving up

 --retry-delay <number> (optional) [default: 5000]
    Delay between retries in milliseconds

 --pause-on-error <boolean> (optional) [default: false]
    Pause the worker when an error occurs

 --verbose <boolean> (optional) [default: false]
    Enable verbose logging
```

### Clean Up Redis Streams

```
Usage: styx heracles:clean [options]
Description: Clean up Redis streams by removing completed and failed jobs.

Arguments:
 --redis <string> (required) [default: default]
    Name of the Redis connection to use

 --queues <array of strings> (optional) [default: ]
    List of queues to clean. If empty, all queues will be cleaned

 --dry-run <boolean> (optional) [default: false]
    Show what would be removed without actually removing

 --verbose <boolean> (optional) [default: false]
    Enable verbose logging

 --all <boolean> (optional) [default: false]
    Remove all entries, not only completed and failed jobs

 --key-prefix <string> (optional) [default: elysium:heracles]
    Redis key prefix to clean

 --retention <number> (optional) [default: 3600]
    Number of seconds to retain completed jobs

 --max <number> (optional) [default: 1000]
    Maximum number of jobs to clean
```

## License

Apache-2.0
