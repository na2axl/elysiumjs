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

import { Metadata, Service } from '@elysiumjs/core';
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { Job, JobOverlapBehavior, JobStatus, WithId } from '../src/job';
import { Symbols } from '../src/utils';

describe('Job class', () => {
	beforeEach(() => {
		Service.clear();
	});

	afterAll(() => {
		mock.restore();
	});

	describe('@Job.register() decorator', () => {
		it('should register a job with default options', () => {
			const instanceSpy = spyOn(Service, 'instance');

			@Job.register()
			class DefaultJob extends Job {
				protected async execute(): Promise<void> {}
			}

			const metadata = Metadata.get(Symbols.job, DefaultJob);
			expect(metadata).toBeDefined();
			expect(metadata.name).toBe('elysium.heracles.job.DefaultJob');
			expect(metadata.queue).toBe('default');
			expect(metadata.overlapBehavior).toBe(JobOverlapBehavior.ALLOW_OVERLAP);
			expect(metadata.overlapDelay).toBe(0);
			expect(metadata.priority).toBe(0);
			expect(metadata.maxRetries).toBeUndefined();
			expect(metadata.retryDelay).toBeUndefined();
			expect(instanceSpy).not.toHaveBeenCalled();
		});

		it('should register a job with custom options', () => {
			@Job.register({
				name: 'custom-job',
				queue: 'high-priority',
				priority: 1,
				maxRetries: 3,
				retryDelay: 5000,
				overlapBehavior: JobOverlapBehavior.NO_OVERLAP,
				overlapDelay: 1000
			})
			class CustomJob extends Job {
				protected async execute(): Promise<void> {}
			}

			const metadata = Metadata.get(Symbols.job, CustomJob);
			expect(metadata.name).toBe('elysium.heracles.job.custom-job');
			expect(metadata.queue).toBe('high-priority');
			expect(metadata.priority).toBe(1);
			expect(metadata.maxRetries).toBe(3);
			expect(metadata.retryDelay).toBe(5000);
			expect(metadata.overlapBehavior).toBe(JobOverlapBehavior.NO_OVERLAP);
			expect(metadata.overlapDelay).toBe(1000);
		});
	});

	describe('constructor', () => {
		it('should create a job with a provided ID', () => {
			class TestJob extends Job {
				protected async execute(): Promise<void> {}
			}

			const job = new TestJob('my-id', 'my-dispatch');
			expect(job.id).toBe('my-id');
			expect(job.dispatchId).toBe('my-dispatch');
			expect(job.createdAt).toBeInstanceOf(Date);
			expect(job.status).toBe(JobStatus.PENDING);
		});

		it('should generate an ID if not provided', () => {
			class TestJob extends Job {
				protected async execute(): Promise<void> {}
			}

			const job = new TestJob();
			expect(job.id).toBeDefined();
			expect(job.id).toStartWith('job_');
			expect(job.dispatchId).toStartWith('dispatch_');
			expect(job.status).toBe(JobStatus.PENDING);
		});

		it('should generate unique IDs across instances', () => {
			class TestJob extends Job {
				protected async execute(): Promise<void> {}
			}

			const job1 = new TestJob();
			const job2 = new TestJob();
			expect(job1.id).not.toBe(job2.id);
		});
	});

	describe('run()', () => {
		it('should execute the job and set COMPLETED status', async () => {
			let executed = false;

			class SuccessJob extends Job {
				protected async execute(): Promise<void> {
					executed = true;
				}
			}

			const job = new SuccessJob();
			await job.run();

			expect(executed).toBe(true);
			expect(job.status).toBe(JobStatus.COMPLETED);
			expect(job.startedAt).toBeInstanceOf(Date);
			expect(job.completedAt).toBeInstanceOf(Date);
		});

		it('should set FAILED status when execute throws', async () => {
			class FailingJob extends Job {
				protected async execute(): Promise<void> {
					throw new Error('Job failed');
				}
			}

			const job = new FailingJob();
			await job.run();

			expect(job.status).toBe(JobStatus.FAILED);
			expect(job.lastError).toBeInstanceOf(Error);
			expect(job.lastError!.message).toBe('Job failed');
			expect(job.startedAt).toBeInstanceOf(Date);
			expect(job.completedAt).toBeInstanceOf(Date);
		});

		it('should skip execution if already cancelled', async () => {
			let executed = false;

			class SkipJob extends Job {
				protected async execute(): Promise<void> {
					executed = true;
				}
			}

			const job = new SkipJob();
			job.cancel();
			await job.run();

			expect(executed).toBe(false);
			expect(job.status).toBe(JobStatus.CANCELLED);
		});

		it('should stay CANCELLED when cancel() is called during execute', async () => {
			class CancelDuringJob extends Job {
				protected async execute(): Promise<void> {
					this.cancel();
					throw new Error('error after cancel');
				}
			}

			const job = new CancelDuringJob();
			await job.run();

			expect(job.status).toBe(JobStatus.CANCELLED);
		});

		it('should convert non-Error throws to Error objects', async () => {
			class StringThrowJob extends Job {
				protected async execute(): Promise<void> {
					throw 'string error';
				}
			}

			const job = new StringThrowJob();
			await job.run();

			expect(job.status).toBe(JobStatus.FAILED);
			expect(job.lastError).toBeInstanceOf(Error);
			expect(job.lastError!.message).toBe('string error');
		});
	});

	describe('cancel()', () => {
		it('should cancel a PENDING job and return true', () => {
			class TestJob extends Job {
				protected async execute(): Promise<void> {}
			}

			const job = new TestJob();
			expect(job.cancel()).toBe(true);
			expect(job.status).toBe(JobStatus.CANCELLED);
			expect(job.completedAt).toBeUndefined();
		});

		it('should cancel a RUNNING job, set completedAt, and return true', async () => {
			let cancelPromiseResolve: () => void;
			const cancelPromise = new Promise<void>((resolve) => {
				cancelPromiseResolve = resolve;
			});

			class RunningJob extends Job {
				protected async execute(): Promise<void> {
					// Signal that we're running so test can cancel us
					cancelPromiseResolve();
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}
			}

			const job = new RunningJob();
			const runPromise = job.run();

			await cancelPromise;
			expect(job.cancel()).toBe(true);
			expect(job.status).toBe(JobStatus.CANCELLED);
			expect(job.completedAt).toBeInstanceOf(Date);

			await runPromise;
		});

		it('should return false for COMPLETED jobs', async () => {
			class DoneJob extends Job {
				protected async execute(): Promise<void> {}
			}

			const job = new DoneJob();
			await job.run();

			expect(job.cancel()).toBe(false);
			expect(job.status).toBe(JobStatus.COMPLETED);
		});

		it('should return false for FAILED jobs', async () => {
			class FailJob extends Job {
				protected async execute(): Promise<void> {
					throw new Error('fail');
				}
			}

			const job = new FailJob();
			await job.run();

			expect(job.cancel()).toBe(false);
			expect(job.status).toBe(JobStatus.FAILED);
		});
	});

	describe('fail()', () => {
		it('should set FAILED status and error', () => {
			class TestJob extends Job {
				protected async execute(): Promise<void> {}
			}

			const job = new TestJob();
			const error = new Error('manual fail');
			job.fail(error);

			expect(job.status).toBe(JobStatus.FAILED);
			expect(job.lastError).toBe(error);
			expect(job.completedAt).toBeInstanceOf(Date);
		});

		it('should not set FAILED if already CANCELLED', () => {
			class TestJob extends Job {
				protected async execute(): Promise<void> {}
			}

			const job = new TestJob();
			job.cancel();
			job.fail(new Error('after cancel'));

			expect(job.status).toBe(JobStatus.CANCELLED);
		});
	});

	describe('incrementRetries()', () => {
		it('should increment the retry count', () => {
			class TestJob extends Job {
				protected async execute(): Promise<void> {}
			}

			const job = new TestJob();
			expect(job.retries).toBe(0);

			job.incrementRetries();
			expect(job.retries).toBe(1);

			job.incrementRetries();
			expect(job.retries).toBe(2);
		});
	});

	describe('queueName', () => {
		it('should set and get the queue name', () => {
			class TestJob extends Job {
				protected async execute(): Promise<void> {}
			}

			const job = new TestJob();
			expect(job.queueName).toBeUndefined();

			job.queueName = 'my-queue';
			expect(job.queueName).toBe('my-queue');
		});
	});

	describe('generateJobId()', () => {
		it('should generate unique IDs', () => {
			const id1 = Job.generateJobId();
			const id2 = Job.generateJobId();
			expect(id1).not.toBe(id2);
			expect(id1).toStartWith('job_');
			expect(id2).toStartWith('job_');
		});
	});
});

describe('WithId mixin', () => {
	it('should override the job ID and dispatch ID', () => {
		class BaseJob extends Job {
			protected async execute(): Promise<void> {}
		}

		const WrappedJob = WithId(BaseJob, 'fixed-id', 'fixed-dispatch');
		const job = new WrappedJob();

		expect(job.id).toBe('fixed-id');
		expect(job.dispatchId).toBe('fixed-dispatch');
	});
});

describe('JobStatus enum', () => {
	it('should have all expected statuses', () => {
		expect(JobStatus.PENDING).toBe('pending' as JobStatus);
		expect(JobStatus.RUNNING).toBe('running' as JobStatus);
		expect(JobStatus.COMPLETED).toBe('completed' as JobStatus);
		expect(JobStatus.FAILED).toBe('failed' as JobStatus);
		expect(JobStatus.CANCELLED).toBe('cancelled' as JobStatus);
		expect(JobStatus.SCHEDULED_FOR_RETRY).toBe('scheduled_for_retry' as JobStatus);
	});
});

describe('JobOverlapBehavior enum', () => {
	it('should have expected values', () => {
		expect(JobOverlapBehavior.ALLOW_OVERLAP).toBe('allow_overlap' as JobOverlapBehavior);
		expect(JobOverlapBehavior.NO_OVERLAP).toBe('no_overlap' as JobOverlapBehavior);
	});
});
