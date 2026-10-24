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

import { Command, CommandArgumentType, Redis, Service } from '@elysiumjs/core';

import { JobStatus } from '../job';

/**
 * Command used to clean a Redis stream.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class HeraclesCleanCommand extends Command {
	public static readonly command: string = 'heracles:clean';
	public static readonly description: string =
		'Clean up Redis streams by removing completed and failed jobs.';

	@Command.arg({
		name: 'redis',
		required: true,
		description: 'Name of the Redis connection to use',
		type: CommandArgumentType.STRING,
		default: 'default'
	})
	private redis: string = 'default';

	@Command.arg({
		name: 'queues',
		description: 'List of queues to clean. If empty, all queues will be cleaned',
		type: CommandArgumentType.ARRAY,
		arrayType: CommandArgumentType.STRING,
		default: []
	})
	private queues: string[] = [];

	@Command.arg({
		name: 'dry-run',
		description: 'Show what would be removed without actually removing',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private dryRun: boolean = false;

	@Command.arg({
		name: 'verbose',
		description: 'Enable verbose logging',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private verbose: boolean = false;

	@Command.arg({
		name: 'all',
		description: 'Remove all entries, not only completed and failed jobs',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private all: boolean = false;

	@Command.arg({
		name: 'key-prefix',
		description: 'Redis key prefix to clean',
		type: CommandArgumentType.STRING,
		default: 'elysium:heracles'
	})
	private keyPrefix: string = 'elysium:heracles';

	@Command.arg({
		name: 'retention',
		description: 'Number of seconds to retain completed jobs',
		type: CommandArgumentType.NUMBER,
		default: 3600
	})
	private retention: number = 3600;

	@Command.arg({
		name: 'max',
		description: 'Maximum number of jobs to clean',
		type: CommandArgumentType.NUMBER,
		default: 1000
	})
	private max: number = 1000;

	public async run(): Promise<void> {
		try {
			// Ensure Redis connection exists
			if (!Redis.connectionExists(this.redis)) {
				this.error(`Redis connection '${this.redis}' does not exist`);
				process.exit(1);
			}

			// Resolved asynchronously: the app may be booted lazily, so the client may not exist yet
			const redisClient = await Service.resolve<Bun.RedisClient>(
				Redis.getConnectionName(this.redis)
			);

			// Get queues to process
			if (this.queues.length === 0) {
				// Find all streams with the given prefix
				const keys = await redisClient.keys(`${this.keyPrefix}:stream:*`);
				this.queues = keys.map((key: string) => key.replace(`${this.keyPrefix}:stream:`, ''));
			}

			if (this.verbose) {
				this.write(`=== Redis Stream Cleanup ===`);
				this.write(`- Redis connection: ${this.redis}`);
				this.write(`- Key prefix: ${this.keyPrefix}`);
				this.write(`- Queues to clean: ${this.queues.join(', ') || 'none found'}`);
				this.write(`- Retention period: ${this.retention} seconds`);
				this.write(`- Maximum stream size: ${this.max}`);
				this.write(`- Dry run mode: ${this.dryRun ? 'Yes' : 'No'}`);
			}

			if (this.queues.length === 0) {
				this.newLine();
				this.error(`No queues found to clean`);
				return;
			}

			let totalRemoved = 0;
			let totalTrimmed = 0;
			let totalStatusRemoved = 0;

			const spinner = this.spinner('Cleaning streams...');

			for (const queue of this.queues) {
				const streamKey = `${this.keyPrefix}:stream:${queue}`;

				// Get stream info
				let streamLength;
				try {
					streamLength = await redisClient.send('XLEN', [streamKey]);

					if (this.verbose) {
						spinner.pause(`\nQueue: ${queue}`);
						spinner.pause(`- Current stream length: ${streamLength}`);
					}
				} catch (e) {
					if (this.verbose) {
						spinner.pause(`\nQueue: ${queue} - stream not found or empty`);
					}

					continue;
				}

				if (this.all) {
					// Delete all entries in the stream
					if (!this.dryRun) {
						await redisClient.del(streamKey);
						totalRemoved += streamLength;

						if (this.verbose) {
							spinner.pause(`- Deleted entire stream (${streamLength} entries)`);
						}
					} else {
						if (this.verbose) {
							spinner.pause(`- Would delete entire stream (${streamLength} entries)`);
						}
					}
				} else {
					// Find completed jobs
					if (this.retention > 0) {
						// Find status entries for completed/failed jobs
						const statusKeys = await redisClient.keys(`${this.keyPrefix}:status:${queue}:*`);
						const completedIds = [];

						for (const statusKey of statusKeys) {
							const status = await redisClient.send('HGET', [statusKey, 'status']);
							const updatedAt = await redisClient.send('HGET', [statusKey, 'updatedAt']);

							if (
								(status === JobStatus.COMPLETED ||
									status === JobStatus.FAILED ||
									status === JobStatus.CANCELLED) &&
								updatedAt &&
								parseInt(updatedAt) < Date.now() - this.retention * 1000
							) {
								// Extract job ID from status key
								const jobId = statusKey.split(':').pop();

								// Check if the status has a messageId field (direct link to stream entry)
								const messageId = await redisClient.send('HGET', [statusKey, 'messageId']);

								if (messageId) {
									// We have a direct reference to the message ID
									completedIds.push(messageId);
								} else {
									// Fall back to searching the stream
									const messages = await redisClient.send('XRANGE', [
										streamKey,
										'-',
										'+',
										'COUNT',
										'1000'
									]);

									for (const [msgId, fields] of messages) {
										// Check if this message is for the completed job
										const fieldsObj: Record<string, string> = {};
										for (let i = 0; i < fields.length; i += 2) {
											fieldsObj[fields[i]] = fields[i + 1];
										}

										if (
											(fieldsObj.jobId === jobId || msgId.includes(jobId)) &&
											(fieldsObj.type === 'job:result' ||
												fieldsObj.type === 'job:status' ||
												fieldsObj.type === 'job:process')
										) {
											completedIds.push(msgId);
										}
									}
								}

								// Add status key to a list for deletion
								if (!this.dryRun) {
									await redisClient.send('DEL', [statusKey]);
									totalStatusRemoved++;
								}
							}
						}

						if (completedIds.length > 0) {
							if (this.verbose) {
								spinner.pause(`- Found ${completedIds.length} expired completed job entries`);
							}

							if (!this.dryRun) {
								// Delete in batches of 100
								for (let i = 0; i < completedIds.length; i += 100) {
									const batch = completedIds.slice(i, i + 100);
									await redisClient.send('XDEL', [streamKey, ...batch]);
								}
								totalRemoved += completedIds.length;

								if (this.verbose) {
									spinner.pause(
										`- Removed ${completedIds.length} expired completed job entries from stream`
									);
								}
							} else {
								if (this.verbose) {
									spinner.pause(
										`- Would remove ${completedIds.length} expired completed job entries from stream`
									);
								}
							}
						} else {
							if (this.verbose) {
								spinner.pause(`- No expired completed job entries found`);
							}
						}
					}

					// Trim stream to max size if specified
					if (this.max > 0 && streamLength > this.max) {
						if (!this.dryRun) {
							await redisClient.send('XTRIM', [
								streamKey,
								'MAXLEN',
								'~', // Approximate trimming for better performance
								this.max.toString()
							]);
							totalTrimmed += streamLength - this.max;

							if (this.verbose) {
								spinner.pause(`- Trimmed stream from ${streamLength} to ~${this.max} entries`);
							}
						} else {
							if (this.verbose) {
								spinner.pause(`- Would trim stream from ${streamLength} to ~${this.max} entries`);
							}
						}
					}
				}
			}

			spinner.complete('Cleanup operation completed');
		} catch (error: any) {
			this.trace(error, 'Error cleaning up Redis streams');
			process.exit(1);
		}
	}
}
