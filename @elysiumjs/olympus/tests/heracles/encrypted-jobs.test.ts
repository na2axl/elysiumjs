// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { TransportEvent } from '../../src/heracles/transport';

import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { AesGcmCipher } from '../../src/harpocrates';
import { MissingJobCipherError, openJobArgs, sealJobArgs } from '../../src/heracles/encryption';
import { Heracles } from '../../src/heracles/heracles';
import { HeraclesModule } from '../../src/heracles/heracles.module';
import { Job, JobStatus } from '../../src/heracles/job';
import { Queue } from '../../src/heracles/queue';
import { MemoryTransport } from '../../src/heracles/transports/memory.transport';
import { Application, Module } from '../../src/index';
import { job } from '../../src/moirai/heracles';

const ENCRYPTED = 'elysium.heracles.job.EncryptedStatementJob';
const received: unknown[] = [];

@Job.register({ name: 'EncryptedStatementJob', encrypted: true })
class StatementJob extends Job {
	constructor(
		public readonly iban: string,
		public readonly amount: { value: number }
	) {
		super();
	}

	protected async execute(): Promise<void> {
		received.push([this.iban, this.amount]);
	}
}

@Job.register({ name: 'PlainStatementJob' })
class PlainJob extends Job {
	constructor(public readonly note: string) {
		super();
	}

	protected async execute(): Promise<void> {
		received.push(this.note);
	}
}

@Module.register({ jobs: [StatementJob, PlainJob] })
class StatementModule extends Module {}

const cipher = new AesGcmCipher({ keys: { main: 'k'.repeat(32) } });

describe('encrypted jobs', () => {
	let app: Awaited<ReturnType<typeof Application.testing>> | undefined;

	const boot = async (withCipher = true) => {
		app = await Application.testing({
			modules: [
				HeraclesModule.with({
					queues: { default: { transport: MemoryTransport } },
					...(withCipher ? { cipher } : {})
				}),
				StatementModule
			],
			boot: 'eager'
		});
	};

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
		received.length = 0;
	});

	it('carries the arguments encrypted, and runs the job with them in clear', async () => {
		const sent: TransportEvent[] = [];
		await boot();
		const original = MemoryTransport.prototype.send;
		const spy = spyOn(MemoryTransport.prototype, 'send').mockImplementation(function (
			this: MemoryTransport,
			message: TransportEvent
		) {
			sent.push(message);
			return original.call(this, message);
		});
		try {
			await Heracles.dispatch(StatementJob, ['FR76 3000 6000 0112 3456 7890 189', { value: 12 }]);
			await MemoryTransport.settled();
		} finally {
			spy.mockRestore();
		}

		const carried = JSON.stringify(sent.filter((m) => m.type === 'job:process'));
		expect(carried).not.toContain('FR76');
		expect(carried).toContain('aes-256-gcm:main:');
		expect(received).toEqual([['FR76 3000 6000 0112 3456 7890 189', { value: 12 }]]);
	});

	it('leaves the arguments of other jobs as they are', async () => {
		await boot();
		await Heracles.dispatch(PlainJob, ['hello']);
		await MemoryTransport.settled();
		expect(received).toEqual(['hello']);
	});

	it('refuses to dispatch an encrypted job without a cipher', async () => {
		await boot(false);
		await expect(Heracles.dispatch(StatementJob, ['FR76', { value: 1 }])).rejects.toBeInstanceOf(
			MissingJobCipherError
		);
	});

	it('fails a job whose arguments do not decrypt', async () => {
		await boot();
		// A plain job's dispatch under the encrypted job's name: its arguments arrive in clear.
		const id = await Queue.get('default').dispatch(PlainJob, ENCRYPTED, ['unused']);
		await MemoryTransport.settled();
		expect(received).toEqual([]);
		const status = await Queue.get('default').getJobStatus(id);
		expect(status?.status).toBe(JobStatus.FAILED);
		expect(status?.error).toContain('sent in clear');
	});

	it('leaves sealed arguments as they are, so that a dead letter can be dispatched again', async () => {
		await boot();
		const sealed = await sealJobArgs(StatementJob, ENCRYPTED, ['again', { value: 3 }]);
		expect(await sealJobArgs(StatementJob, ENCRYPTED, sealed)).toEqual(sealed);
		await Heracles.dispatch(StatementJob, sealed as never);
		await MemoryTransport.settled();
		expect(received).toEqual([['again', { value: 3 }]]);
	});

	it('encrypts the arguments of the outbox job() effect', async () => {
		await boot();
		const effect = await job(StatementJob, ['FR76 secret', { value: 4 }]);
		expect(JSON.stringify(effect.payload)).not.toContain('FR76');
		expect(JSON.stringify(effect.payload)).toContain('aes-256-gcm:main:');
	});

	it('binds the ciphertext to its job', async () => {
		await boot();
		const sealed = await sealJobArgs(StatementJob, ENCRYPTED, ['x', { value: 1 }]);
		expect(await openJobArgs(StatementJob, ENCRYPTED, sealed)).toEqual(['x', { value: 1 }]);
		await expect(
			openJobArgs(StatementJob, 'elysium.heracles.job.OtherJob', sealed)
		).rejects.toThrow('could not be decrypted');
	});
});
