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

import type { JobStatusInfo, Transport, TransportEvent } from '../transport';

import { InteractsWithConsole, Redis, Service } from '@elysiumjs/core';
import { RedisClient } from 'bun';
import { uid } from 'radash';

import { JobStatus } from '../job';
import { TransportMode } from '../transport';

/**
 * Redis transport configuration options
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type RedisTransportOptions = {
	/**
	 * Redis connection name from Elysium config.
	 */
	connection?: string;

	/**
	 * Prefix for all Redis keys used by this transport.
	 * @default 'elysium:heracles'
	 */
	keyPrefix?: string;

	/**
	 * Group name for Redis consumer groups.
	 * @default 'workers'
	 */
	consumerGroup?: string;

	/**
	 * Consumer name for this instance in the consumer group.
	 * If not provided, a random name will be generated.
	 */
	consumerName?: string;

	/**
	 * Maximum number of messages to read in a single poll.
	 * @default 10
	 */
	batchSize?: number;

	/**
	 * Time to live for job status information (in seconds).
	 * @default 86400 (24 hours)
	 */
	statusTTL?: number;

	/**
	 * Whether to automatically clean up completed and failed jobs from streams.
	 * @default true
	 */
	cleanupCompletedJobs?: boolean;

	/**
	 * How long to retain completed jobs in the stream before cleanup (in seconds).
	 * @default 3600 (1 hour)
	 */
	completedJobRetention?: number;

	/**
	 * Maximum number of entries to keep in each stream.
	 * @default 1000
	 */
	maxStreamSize?: number;
};

/**
 * Job index entry for efficient lookups
 */
interface JobIndexEntry {
	jobId: string;
	dispatchId: string;
	queue: string;
	status: string;
	priority: number;
	timestamp: number;
}

/**
 * Transport implementation using Redis streams and pub/sub for distributed job processing.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class RedisTransport extends InteractsWithConsole implements Transport {
	/**
	 * Main Redis client for commands
	 */
	private commandClient: RedisClient = null!;

	/**
	 * Dedicated client for pub/sub subscriptions
	 */
	private subscriberClient: RedisClient = null!;

	/**
	 * Dedicated client for publishing messages
	 */
	private publisherClient: RedisClient = null!;

	/**
	 * Options for this transport
	 */
	private options: Required<RedisTransportOptions>;

	/**
	 * Mode this transport is operating in
	 */
	private mode: TransportMode;

	/**
	 * Registered message handlers
	 */
	private messageHandlers: Array<(message: TransportEvent) => void | Promise<void>> = [];

	/**
	 * Consumer ID for this instance
	 */
	private consumerId: string;

	/**
	 * Whether the transport is currently running
	 */
	private isRunning: boolean = false;

	/**
	 * Timer for cleanup operations
	 */
	private cleanupTimer?: ReturnType<typeof setInterval>;

	/**
	 * Map to track job locks for NO_OVERLAP jobs
	 */
	private jobLocks: Map<string, { lockedUntil: number; queue: string }> = new Map();

	/**
	 * Create a new Redis transport
	 */
	constructor(mode: TransportMode, options: RedisTransportOptions = {}) {
		super();

		this.mode = mode;
		this.options = {
			connection: options.connection || 'default',
			keyPrefix: options.keyPrefix || 'elysium:heracles',
			consumerGroup: options.consumerGroup || 'workers',
			consumerName: options.consumerName || `worker-${uid(8)}`,
			batchSize: options.batchSize || 10,
			statusTTL: options.statusTTL || 86400,
			cleanupCompletedJobs: options.cleanupCompletedJobs !== false,
			completedJobRetention: options.completedJobRetention || 3600,
			maxStreamSize: options.maxStreamSize || 1000
		};

		this.consumerId =
			this.mode === TransportMode.CONSUMER ? this.options.consumerName : `producer-${uid(8)}`;
	}

	/**
	 * Initialize Redis clients with proper configuration
	 */
	private async initializeClients(): Promise<void> {
		// Main command client with auto-pipelining
		// Resolved asynchronously: on a lazy boot the connection may not be built yet
		const connection = await Service.resolve<RedisClient>(
			Redis.getConnectionName(this.options.connection)
		);
		this.commandClient = await connection.duplicate();

		// Subscriber client (pub/sub takes over connection)
		this.subscriberClient = await connection.duplicate();

		// Publisher client for sending notifications
		this.publisherClient = await connection.duplicate();

		// Set up connection event handlers
		this.setupConnectionHandlers();
	}

	/**
	 * Setup connection event handlers for all clients
	 */
	private setupConnectionHandlers(): void {
		this.commandClient.onconnect = () => {
			this.debug('Command client connected');
		};

		this.commandClient.onclose = (error) => {
			this.error(`Command client disconnected: ${error}`);
		};

		this.subscriberClient.onconnect = () => {
			this.debug('Subscriber client connected');
		};

		this.subscriberClient.onclose = (error) => {
			this.error(`Subscriber client disconnected: ${error}`);
		};

		this.publisherClient.onconnect = () => {
			this.debug('Publisher client connected');
		};

		this.publisherClient.onclose = (error) => {
			this.error(`Publisher client disconnected: ${error}`);
		};
	}

	/**
	 * Start the transport
	 */
	async start(): Promise<void> {
		if (this.isRunning) {
			return;
		}

		try {
			// Initialize Redis clients
			await this.initializeClients();

			// Connect all clients
			await Promise.all([
				this.commandClient.connect(),
				this.subscriberClient.connect(),
				this.publisherClient.connect()
			]);

			// Verify connections
			await this.commandClient.ping();
			await this.publisherClient.ping();

			this.info(`RedisTransport started in ${this.mode} mode with ID: ${this.consumerId}`);

			if (this.mode === TransportMode.CONSUMER) {
				// Subscribe to job channels
				await this.subscribeToChannels();

				// Schedule periodic cleanup if enabled
				if (this.options.cleanupCompletedJobs) {
					this.scheduleCleanup();
				}
			}

			this.isRunning = true;
		} catch (error) {
			this.error(`Failed to start RedisTransport: ${error}`);
			throw new Error(`Redis connection failed: ${error}`);
		}
	}

	/**
	 * Stop the transport
	 */
	async stop(): Promise<void> {
		this.isRunning = false;

		// Stop cleanup timer
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}

		// Unsubscribe from all channels
		// The clients only exist once the transport has been started
		if (this.mode === TransportMode.CONSUMER) {
			await this.subscriberClient?.unsubscribe();
		}

		// Close all connections
		this.commandClient?.close();
		this.subscriberClient?.close();
		this.publisherClient?.close();

		this.info('RedisTransport stopped');
	}

	/**
	 * Subscribe to relevant pub/sub channels
	 */
	private async subscribeToChannels(): Promise<void> {
		const queues = await this.getRegisteredQueues();

		for (const queue of queues) {
			// Subscribe to new job notifications
			await this.subscriberClient.subscribe(
				`${this.options.keyPrefix}:queue:${queue}:new`,
				async (messageId, _) => {
					this.debug(`New job notification for queue ${queue}: ${messageId}`);
					await this.processJobFromStream(queue, messageId);
				}
			);

			// Subscribe to job control messages
			await this.subscriberClient.subscribe(
				`${this.options.keyPrefix}:queue:${queue}:control`,
				async (message, _) => {
					try {
						const control = JSON.parse(message);
						await this.handleControlMessage(control);
					} catch (error) {
						this.error(`Error parsing control message: ${error}`);
					}
				}
			);

			// Subscribe to lock release notifications for NO_OVERLAP jobs
			await this.subscriberClient.subscribe(
				`${this.options.keyPrefix}:lock:${queue}:released`,
				(jobId, _) => {
					this.debug(`Lock released for job ${jobId} in queue ${queue}`);
					// Notify handlers that a lock was released
					this.notifyLockRelease(jobId, queue);
				}
			);
		}

		// Subscribe to worker coordination channel
		await this.subscriberClient.subscribe(
			`${this.options.keyPrefix}:worker:coordination`,
			async (message, _) => {
				try {
					const event = JSON.parse(message);
					await this.handleWorkerCoordination(event);
				} catch (error) {
					this.error(`Error handling worker coordination: ${error}`);
				}
			}
		);
	}

	/**
	 * Process a job from the stream when notified via pub/sub
	 */
	private async processJobFromStream(queue: string, messageId: string): Promise<void> {
		const streamKey = this.getStreamKey(queue);

		try {
			// Read the specific message from the stream
			const messages = (await this.commandClient.send('XRANGE', [
				streamKey,
				messageId,
				messageId
			])) as Array<[string, string[]]>;

			if (messages && messages.length > 0) {
				const [_id, fields] = messages[0];
				const message = this.deserializeMessage(fields, queue);

				// Process the message through handlers
				for (const handler of this.messageHandlers) {
					try {
						await handler(message);
					} catch (error) {
						this.error(`Error in message handler: ${error}`);
					}
				}

				// Acknowledge the message in the consumer group
				await this.commandClient.send('XACK', [streamKey, this.options.consumerGroup, messageId]);
			}
		} catch (error) {
			this.error(`Error processing job from stream: ${error}`);
		}
	}

	/**
	 * Handle control messages
	 */
	private async handleControlMessage(control: any): Promise<void> {
		switch (control.type) {
			case 'pause':
				this.info(`Queue ${control.queue} paused`);
				break;
			case 'resume':
				this.info(`Queue ${control.queue} resumed`);
				break;
			case 'drain':
				this.info(`Queue ${control.queue} draining`);
				break;
			default:
				this.debug(`Unknown control message type: ${control.type}`);
		}
	}

	/**
	 * Handle worker coordination events
	 */
	private async handleWorkerCoordination(event: any): Promise<void> {
		switch (event.type) {
			case 'worker:joined':
				this.debug(`Worker ${event.workerId} joined`);
				break;
			case 'worker:left':
				this.debug(`Worker ${event.workerId} left`);
				break;
			case 'rebalance':
				this.debug('Rebalancing work across workers');
				break;
		}
	}

	/**
	 * Send a message through the transport
	 */
	async send(message: TransportEvent): Promise<void> {
		try {
			const queueName = this.extractQueueName(message);
			const streamKey = this.getStreamKey(queueName);

			if (message.type === 'job:process') {
				// Add job to stream
				const messageData = this.serializeMessage(message);
				const messageId = await this.commandClient.send('XADD', [streamKey, '*', ...messageData]);

				// Create job index entry
				await this.indexJob({
					jobId: message.jobId,
					dispatchId: message.dispatchId,
					queue: queueName,
					status: JobStatus.PENDING,
					priority: message.options?.priority || 10,
					timestamp: Date.now()
				});

				// Store initial job status
				await this.storeJobStatus({
					jobId: message.jobId,
					dispatchId: message.dispatchId,
					queue: queueName,
					status: JobStatus.PENDING,
					retries: 0,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					messageId
				});

				// Notify subscribers about new job via pub/sub
				await this.publisherClient.publish(
					`${this.options.keyPrefix}:queue:${queueName}:new`,
					messageId
				);

				this.debug(`Job ${message.jobId} dispatched to queue ${queueName} with ID ${messageId}`);
			} else if (message.type === 'job:status' || message.type === 'job:result') {
				// Update job status
				await this.updateJobStatus(message.jobId, message.dispatchId, queueName, {
					status: message.status,
					error: message.error,
					retries: message.retries,
					completedAt: message.completedAt,
					updatedAt: new Date().toISOString()
				});

				// Update job index
				await this.updateJobIndex(message.jobId, message.dispatchId, queueName, message.status);

				// Broadcast status update via pub/sub
				await this.publisherClient.publish(
					`${this.options.keyPrefix}:job:${message.jobId}:status`,
					JSON.stringify({
						status: message.status,
						error: message.error,
						timestamp: Date.now()
					})
				);
			} else if (message.type === 'job:cancel') {
				// Send cancel command via pub/sub
				await this.publisherClient.publish(
					`${this.options.keyPrefix}:queue:${queueName}:control`,
					JSON.stringify({
						type: 'cancel',
						jobId: message.jobId,
						dispatchId: message.dispatchId
					})
				);
			} else {
				// Handle other message types
				const messageData = this.serializeMessage(message);
				await this.commandClient.send('XADD', [streamKey, '*', ...messageData]);
			}
		} catch (error) {
			this.error(`Failed to send message: ${error}`);
			throw new Error(`Failed to send message: ${error}`);
		}
	}

	/**
	 * Register a callback to handle messages
	 */
	onMessage(handler: (message: TransportEvent) => void | Promise<void>): void {
		this.messageHandlers.push(handler);
	}

	/**
	 * Gets the current status of a job
	 */
	async getJobStatus(jobId: string, dispatchId: string, queueName: string): Promise<JobStatusInfo> {
		try {
			const statusKey = this.getJobStatusKey(jobId, dispatchId, queueName);
			const jobData = await this.commandClient.hmget(statusKey, [
				'jobId',
				'dispatchId',
				'queue',
				'status',
				'error',
				'retries',
				'createdAt',
				'startedAt',
				'completedAt',
				'updatedAt',
				'messageId'
			]);

			if (jobData && jobData[0]) {
				return {
					jobId: jobData[0] as string,
					dispatchId: jobData[1] as string,
					queue: (jobData[2] as string) || queueName,
					status: (jobData[3] as string) || 'unknown',
					error: jobData[4] as string | undefined,
					retries: parseInt((jobData[5] as string) || '0', 10),
					createdAt: (jobData[6] as string) || new Date().toISOString(),
					startedAt: jobData[7] as string | undefined,
					completedAt: jobData[8] as string | undefined,
					updatedAt: jobData[9] as string | undefined,
					messageId: jobData[10] as string | undefined
				};
			}

			// Try to get from index if not found
			const indexData = await this.getJobFromIndex(jobId, dispatchId, queueName);
			if (indexData) {
				return {
					jobId,
					dispatchId,
					queue: queueName,
					status: indexData.status,
					retries: 0,
					createdAt: new Date(indexData.timestamp).toISOString()
				};
			}

			return {
				jobId,
				dispatchId,
				queue: queueName,
				status: 'unknown',
				retries: 0,
				createdAt: new Date().toISOString()
			};
		} catch (error) {
			this.warning(`Failed to get job status: ${error}`);
			return {
				jobId,
				dispatchId,
				queue: queueName,
				status: 'unknown',
				retries: 0,
				createdAt: new Date().toISOString()
			};
		}
	}

	/**
	 * Updates a job's status
	 */
	async updateJobStatus(
		jobId: string,
		dispatchId: string,
		queueName: string,
		updates: Partial<JobStatusInfo>
	): Promise<void> {
		try {
			const statusKey = this.getJobStatusKey(jobId, dispatchId, queueName);
			const fields: string[] = [];

			// Build update fields
			if (updates.status) fields.push('status', updates.status);
			if (updates.error !== undefined) fields.push('error', updates.error || '');
			if (updates.retries !== undefined) fields.push('retries', updates.retries.toString());
			if (updates.startedAt) fields.push('startedAt', updates.startedAt);
			if (updates.completedAt) fields.push('completedAt', updates.completedAt);
			if (updates.updatedAt) fields.push('updatedAt', updates.updatedAt);

			if (fields.length > 0) {
				// Update status in Redis (auto-pipelined)
				await this.commandClient.hmset(statusKey, fields);
				await this.commandClient.expire(statusKey, this.options.statusTTL);

				// Update index if status changed
				if (updates.status) {
					await this.updateJobIndex(jobId, dispatchId, queueName, updates.status);
				}

				// Notify about status change via pub/sub
				await this.publisherClient.publish(
					`${this.options.keyPrefix}:job:${jobId}:status`,
					JSON.stringify({
						...updates,
						timestamp: Date.now()
					})
				);

				this.debug(`Updated job ${jobId} status: ${updates.status || 'fields updated'}`);
			}
		} catch (error) {
			this.error(`Failed to update job status: ${error}`);
			throw error;
		}
	}

	/**
	 * Register a worker with this transport
	 */
	async registerWorker(workerId: string, queues: string[]): Promise<void> {
		try {
			// Ensure consumer groups exist for all queues
			for (const queue of queues) {
				const streamKey = this.getStreamKey(queue);
				await this.ensureConsumerGroupExists(streamKey);
			}

			// Register worker in Redis
			const workerKey = this.getWorkerKey(workerId);
			await this.commandClient.hmset(workerKey, [
				'id',
				workerId,
				'status',
				'active',
				'lastSeen',
				new Date().toISOString(),
				'queues',
				JSON.stringify(queues)
			]);

			// Set TTL for auto-cleanup
			await this.commandClient.expire(workerKey, 60);

			// Notify about worker registration via pub/sub
			await this.publisherClient.publish(
				`${this.options.keyPrefix}:worker:coordination`,
				JSON.stringify({
					type: 'worker:joined',
					workerId,
					queues,
					timestamp: Date.now()
				})
			);

			this.debug(`Registered worker ${workerId} for queues: ${queues.join(', ')}`);
		} catch (error) {
			this.error(`Failed to register worker: ${error}`);
			throw error;
		}
	}

	/**
	 * Unregister a worker from this transport
	 */
	async unregisterWorker(workerId: string): Promise<void> {
		try {
			const workerKey = this.getWorkerKey(workerId);
			await this.commandClient.del(workerKey);

			// Notify about worker leaving
			await this.publisherClient.publish(
				`${this.options.keyPrefix}:worker:coordination`,
				JSON.stringify({
					type: 'worker:left',
					workerId,
					timestamp: Date.now()
				})
			);

			this.debug(`Unregistered worker ${workerId}`);
		} catch (error) {
			this.error(`Failed to unregister worker: ${error}`);
			throw error;
		}
	}

	/**
	 * Index a job for efficient lookups
	 */
	private async indexJob(entry: JobIndexEntry): Promise<void> {
		const score = entry.timestamp;
		const member = `${entry.jobId}:${entry.dispatchId}`;

		// Use Promise.all for auto-pipelined operations
		await Promise.all([
			// Index by queue
			this.commandClient.send('ZADD', [
				`${this.options.keyPrefix}:idx:queue:${entry.queue}`,
				score.toString(),
				member
			]),
			// Index by status
			this.commandClient.send('ZADD', [
				`${this.options.keyPrefix}:idx:status:${entry.status}`,
				score.toString(),
				member
			]),
			// Index by priority
			this.commandClient.send('ZADD', [
				`${this.options.keyPrefix}:idx:priority`,
				entry.priority.toString(),
				member
			])
		]);
	}

	/**
	 * Update job index when status changes
	 */
	private async updateJobIndex(
		jobId: string,
		dispatchId: string,
		_queue: string,
		newStatus: string
	): Promise<void> {
		const member = `${jobId}:${dispatchId}`;
		const timestamp = Date.now();

		// Remove from old status index and add to new
		const statuses = [
			JobStatus.PENDING,
			JobStatus.RUNNING,
			JobStatus.COMPLETED,
			JobStatus.FAILED,
			JobStatus.CANCELLED,
			JobStatus.SCHEDULED_FOR_RETRY
		];

		// Remove from all status indices except the new one
		const removeOperations = statuses
			.filter((status) => status !== newStatus)
			.map((status) =>
				this.commandClient.send('ZREM', [`${this.options.keyPrefix}:idx:status:${status}`, member])
			);

		// Add to new status index
		const addOperation = this.commandClient.send('ZADD', [
			`${this.options.keyPrefix}:idx:status:${newStatus}`,
			timestamp.toString(),
			member
		]);

		// Execute all operations (auto-pipelined)
		await Promise.all([...removeOperations, addOperation]);
	}

	/**
	 * Get job from index
	 */
	private async getJobFromIndex(
		jobId: string,
		dispatchId: string,
		queue: string
	): Promise<JobIndexEntry | null> {
		const member = `${jobId}:${dispatchId}`;

		// Check if job exists in queue index
		const score = await this.commandClient.zscore(
			`${this.options.keyPrefix}:idx:queue:${queue}`,
			member
		);

		if (score) {
			// Get status from status indices
			const statuses = [
				JobStatus.PENDING,
				JobStatus.RUNNING,
				JobStatus.COMPLETED,
				JobStatus.FAILED,
				JobStatus.CANCELLED,
				JobStatus.SCHEDULED_FOR_RETRY
			];

			for (const status of statuses) {
				const exists = await this.commandClient.zscore(
					`${this.options.keyPrefix}:idx:status:${status}`,
					member
				);

				if (exists) {
					return {
						jobId,
						dispatchId,
						queue,
						status,
						priority: 10,
						timestamp: score
					};
				}
			}
		}

		return null;
	}

	/**
	 * Store job status in Redis
	 */
	private async storeJobStatus(status: JobStatusInfo): Promise<void> {
		const statusKey = this.getJobStatusKey(status.jobId, status.dispatchId, status.queue);

		const fields = [
			'jobId',
			status.jobId,
			'dispatchId',
			status.dispatchId,
			'queue',
			status.queue,
			'status',
			status.status,
			'retries',
			status.retries.toString(),
			'createdAt',
			status.createdAt,
			'updatedAt',
			status.updatedAt || Date.now().toString()
		];

		if (status.error) fields.push('error', status.error);
		if (status.startedAt) fields.push('startedAt', status.startedAt);
		if (status.completedAt) fields.push('completedAt', status.completedAt);
		if (status.messageId) fields.push('messageId', status.messageId);

		await this.commandClient.hmset(statusKey, fields);
		await this.commandClient.expire(statusKey, this.options.statusTTL);
	}

	/**
	 * Ensure consumer group exists for a stream
	 */
	private async ensureConsumerGroupExists(streamKey: string): Promise<void> {
		try {
			// Try to create the consumer group
			await this.commandClient.send('XGROUP', [
				'CREATE',
				streamKey,
				this.options.consumerGroup,
				'0',
				'MKSTREAM'
			]);
			this.debug(`Created consumer group ${this.options.consumerGroup} for ${streamKey}`);
		} catch (error: any) {
			// Group might already exist, which is fine
			if (!error.message?.includes('BUSYGROUP')) {
				this.error(`Error creating consumer group: ${error}`);
			}
		}
	}

	/**
	 * Get all registered queues
	 */
	private async getRegisteredQueues(): Promise<string[]> {
		try {
			// Get all stream keys
			const pattern = `${this.options.keyPrefix}:stream:*`;
			const keys = await this.commandClient.keys(pattern);

			if (!Array.isArray(keys) || keys.length === 0) {
				return ['default'];
			}

			return keys
				.map((key) => key.replace(`${this.options.keyPrefix}:stream:`, ''))
				.filter(Boolean);
		} catch (error) {
			this.error(`Failed to get registered queues: ${error}`);
			return ['default'];
		}
	}

	/**
	 * Schedule periodic cleanup operations
	 */
	private scheduleCleanup(): void {
		const cleanupInterval = 5 * 60 * 1000; // 5 minutes

		this.cleanupTimer = setInterval(async () => {
			try {
				await this.performCleanup();
			} catch (error) {
				this.error(`Error during cleanup: ${error}`);
			}
		}, cleanupInterval);

		this.debug(`Scheduled cleanup every ${cleanupInterval / 1000} seconds`);
	}

	/**
	 * Perform cleanup of old jobs and indices
	 */
	private async performCleanup(): Promise<void> {
		this.debug('Starting cleanup operation');

		const cutoff = Date.now() - this.options.completedJobRetention * 1000;
		const queues = await this.getRegisteredQueues();

		// Clean up completed jobs from indices
		const completedStatuses = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED];

		for (const status of completedStatuses) {
			const indexKey = `${this.options.keyPrefix}:idx:status:${status}`;

			// Remove old entries from index
			await this.commandClient.send('ZREMRANGEBYSCORE', [indexKey, '-inf', cutoff.toString()]);
		}

		// Trim streams to max size
		for (const queue of queues) {
			const streamKey = this.getStreamKey(queue);

			// Get stream length
			const length = (await this.commandClient.send('XLEN', [streamKey])) as number;

			if (length > this.options.maxStreamSize) {
				// Trim to max size
				await this.commandClient.send('XTRIM', [
					streamKey,
					'MAXLEN',
					'~',
					this.options.maxStreamSize.toString()
				]);

				this.debug(`Trimmed stream ${streamKey} from ${length} to ~${this.options.maxStreamSize}`);
			}
		}

		// Clean up old job status keys
		const statusPattern = `${this.options.keyPrefix}:status:*`;
		const statusKeys = await this.commandClient.keys(statusPattern);

		for (const key of statusKeys) {
			const ttl = await this.commandClient.ttl(key);

			// If key has no TTL or expired, delete it
			if (ttl === -1 || ttl === -2) {
				await this.commandClient.del(key);
			}
		}

		this.debug('Cleanup operation completed');
	}

	/**
	 * Extract queue name from a transport event
	 */
	private extractQueueName(message: TransportEvent): string {
		if ('queue' in message && typeof message.queue === 'string') {
			return message.queue;
		}
		return 'default';
	}

	/**
	 * Serialize a message for Redis storage
	 */
	private serializeMessage(message: TransportEvent): string[] {
		const fields: string[] = ['type', message.type, 'timestamp', Date.now().toString()];

		// Add queue if present
		if ('queue' in message && message.queue) {
			fields.push('queue', message.queue);
		}

		// Add message-specific fields
		switch (message.type) {
			case 'job:process':
				fields.push(
					'job',
					message.job,
					'args',
					JSON.stringify(message.args || []),
					'jobId',
					message.jobId,
					'dispatchId',
					message.dispatchId
				);
				if (message.options) {
					fields.push('options', JSON.stringify(message.options));
				}
				break;

			case 'job:cancel':
			case 'job:status':
			case 'job:result':
				fields.push('jobId', message.jobId);
				fields.push('dispatchId', message.dispatchId);
				if (message.type !== 'job:cancel') {
					if (message.status) fields.push('status', message.status);
					if (message.error) fields.push('error', message.error);
					if (message.retries !== undefined) {
						fields.push('retries', message.retries.toString());
					}
					if ('completedAt' in message && message.completedAt) {
						fields.push('completedAt', message.completedAt);
					}
				}
				break;

			case 'worker:register':
				fields.push('workerId', message.workerId);
				if (message.queues) {
					fields.push('queues', JSON.stringify(message.queues));
				}
				break;

			case 'worker:unregister':
				fields.push('workerId', message.workerId);
				break;
		}

		return fields;
	}

	/**
	 * Deserialize a message from Redis
	 */
	private deserializeMessage(fields: string[], queue: string): TransportEvent {
		const data: Record<string, string> = {};

		for (let i = 0; i < fields.length; i += 2) {
			data[fields[i]] = fields[i + 1];
		}

		const type = data.type as any;
		const baseMessage = { type, queue: data.queue || queue };

		switch (type) {
			case 'job:process':
				return {
					...baseMessage,
					type: 'job:process',
					job: data.job,
					args: JSON.parse(data.args || '[]'),
					jobId: data.jobId,
					dispatchId: data.dispatchId,
					options: data.options ? JSON.parse(data.options) : undefined
				};

			case 'job:cancel':
				return {
					...baseMessage,
					type: 'job:cancel',
					jobId: data.jobId,
					dispatchId: data.dispatchId
				};

			case 'job:status':
				return {
					...baseMessage,
					type: 'job:status',
					jobId: data.jobId,
					dispatchId: data.dispatchId,
					status: data.status,
					error: data.error,
					retries: data.retries ? parseInt(data.retries, 10) : undefined
				};

			case 'job:result':
				return {
					...baseMessage,
					type: 'job:result',
					jobId: data.jobId,
					dispatchId: data.dispatchId,
					status: data.status,
					error: data.error,
					completedAt: data.completedAt || new Date().toISOString()
				};

			default:
				return baseMessage as any;
		}
	}

	/**
	 * Notify handlers about lock release
	 */
	private notifyLockRelease(jobId: string, queue: string): void {
		// Remove from local lock map
		this.jobLocks.delete(jobId);

		// Notify all handlers
		for (const handler of this.messageHandlers) {
			try {
				handler({
					type: 'job:update',
					jobId,
					dispatchId: '',
					queue,
					status: 'lock_released',
					updates: {}
				});
			} catch (error) {
				this.error(`Error notifying lock release: ${error}`);
			}
		}
	}

	/**
	 * Check if a job is locked
	 */
	async isJobLocked(jobId: string, queue: string): Promise<boolean> {
		// Check local cache first
		const localLock = this.jobLocks.get(jobId);
		if (localLock && localLock.lockedUntil > Date.now()) {
			return true;
		}

		// Check Redis
		const lockKey = `${this.options.keyPrefix}:lock:${queue}:${jobId}`;
		const exists = await this.commandClient.exists(lockKey);

		return exists;
	}

	/**
	 * Acquire a lock for a job
	 */
	async acquireJobLock(jobId: string, queue: string, duration: number = 60000): Promise<boolean> {
		const lockKey = `${this.options.keyPrefix}:lock:${queue}:${jobId}`;
		const lockValue = `${this.consumerId}:${Date.now()}`;

		// Try to acquire lock with NX (only if not exists)
		const result = await this.commandClient.set(
			lockKey,
			lockValue,
			'PX',
			duration.toString(),
			'NX'
		);

		if (result === 'OK') {
			// Store in local cache
			this.jobLocks.set(jobId, {
				lockedUntil: Date.now() + duration,
				queue
			});

			this.debug(`Acquired lock for job ${jobId} in queue ${queue}`);
			return true;
		}

		return false;
	}

	/**
	 * Release a job lock
	 */
	async releaseJobLock(jobId: string, queue: string): Promise<void> {
		const lockKey = `${this.options.keyPrefix}:lock:${queue}:${jobId}`;

		// Delete from Redis
		await this.commandClient.del(lockKey);

		// Remove from local cache
		this.jobLocks.delete(jobId);

		// Notify via pub/sub that lock was released
		await this.publisherClient.publish(`${this.options.keyPrefix}:lock:${queue}:released`, jobId);

		this.debug(`Released lock for job ${jobId} in queue ${queue}`);
	}

	/**
	 * Get Redis key for a stream
	 */
	private getStreamKey(queue: string): string {
		return `${this.options.keyPrefix}:stream:${queue || 'default'}`;
	}

	/**
	 * Get Redis key for job status
	 */
	private getJobStatusKey(jobId: string, dispatchId: string, queue: string): string {
		return `${this.options.keyPrefix}:status:${queue}:${jobId}:${dispatchId}`;
	}

	/**
	 * Get Redis key for worker status
	 */
	private getWorkerKey(workerId: string): string {
		return `${this.options.keyPrefix}:worker:${workerId}`;
	}
}
