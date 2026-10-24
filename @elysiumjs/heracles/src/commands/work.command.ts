// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Command, CommandArgumentType, Redis } from '@elysiumjs/core';

import { RedisWorker } from '../workers/redis.worker';

/**
 * Command used to start an Heracles worker.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class HeraclesWorkCommand extends Command {
	public static readonly command: string = 'heracles:work';
	public static readonly description: string = 'Start an Heracles worker for specific queues.';
	public static readonly boot = true;

	@Command.arg({
		name: 'id',
		required: true,
		description: 'Unique identifier for this worker',
		type: CommandArgumentType.STRING
	})
	private id: string = null!;

	@Command.arg({
		name: 'queues',
		required: true,
		description: 'List of queues to work on',
		type: CommandArgumentType.ARRAY,
		arrayType: CommandArgumentType.STRING,
		default: ['default']
	})
	private queues: string[] = ['default'];

	@Command.arg({
		name: 'concurrency',
		required: true,
		description: 'Number of concurrent jobs to process',
		type: CommandArgumentType.NUMBER,
		default: 1
	})
	private concurrency: number = 1;

	@Command.arg({
		name: 'redis',
		required: true,
		description: 'Name of the Redis connection to use',
		type: CommandArgumentType.STRING,
		default: 'default'
	})
	private redis: string = 'default';

	@Command.arg({
		name: 'max-retries',
		required: false,
		description: 'Maximum retries for failed jobs before giving up',
		type: CommandArgumentType.NUMBER,
		default: 3
	})
	private maxRetries: number = 3;

	@Command.arg({
		name: 'retry-delay',
		required: false,
		description: 'Delay between retries in milliseconds',
		type: CommandArgumentType.NUMBER,
		default: 5000
	})
	private retryDelay: number = 5000;

	@Command.arg({
		name: 'pause-on-error',
		required: false,
		description: 'Pause the worker when an error occurs',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private pauseOnError: boolean = false;

	@Command.arg({
		name: 'verbose',
		required: false,
		description: 'Enable verbose logging',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private verbose: boolean = false;

	public async run(): Promise<void> {
		if (this.verbose) {
			this.write(
				`Starting Heracles worker with id ${this.id} for queues ${this.queues.join(', ')}`
			);
			this.write(`\tConcurrency: ${this.concurrency} jobs`);
			this.write(`\tRedis Connection: ${this.redis}`);
			this.write(`\tMax Retries: ${this.maxRetries}`);
			this.write(`\tRetry Delay: ${this.retryDelay}ms`);
			this.write(`\tPause on Error: ${this.pauseOnError}`);
		}

		// Ensure Redis connection exists
		if (!Redis.connectionExists(this.redis)) {
			this.error(`Redis connection "${this.redis}" does not exist`);
			process.exit(1);
		}

		const worker = new RedisWorker(this.redis, { id: this.id });

		// Configure queues
		for (const queue of this.queues) {
			await worker.createQueue({
				name: queue,
				concurrency: this.concurrency,
				maxRetries: this.maxRetries,
				retryDelay: this.retryDelay,
				pauseOnError: this.pauseOnError
			});
		}

		// Handle process termination
		const cleanup = async () => {
			if (this.verbose) {
				this.write('Stopping worker gracefully...');
			}

			await worker.stop(false);

			if (this.verbose) {
				this.write(`Worker "${worker.id}" stopped successfully`);
			}

			process.exit(0);
		};

		process.on('SIGINT', cleanup);
		process.on('SIGTERM', cleanup);

		// Start worker
		await worker.start();

		if (this.verbose) {
			this.write(`Worker "${worker.id}" started successfully`);
			this.write('Press Ctrl+C to stop the worker');
		}

		// Keep process alive until worker stops
		await new Promise<void>(() => {});
	}
}
