// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { CipherDriver } from '../harpocrates/cipher';
import type { JobClass } from './job';

import { ElysiumError, Service } from '../index';
import { HERACLES_CIPHER } from './registry';
import { getJobMetadata } from './utils';

/**
 * Raised when an encrypted job is dispatched or run without a cipher in
 * `HeraclesModule.with({ cipher })`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MissingJobCipherError extends ElysiumError {
	constructor(job: string) {
		super(
			`The job "${job}" is encrypted, but no cipher is configured: pass one to HeraclesModule.with({ cipher }).`
		);
	}
}

/** The arguments of an encrypted job, as the transports carry them. */
type SealedArgs = [{ $encrypted: string }];

const isSealed = (args: unknown): args is SealedArgs =>
	Array.isArray(args) &&
	args.length === 1 &&
	typeof (args[0] as { $encrypted?: unknown } | null)?.$encrypted === 'string';

const cipherFor = async (job: string): Promise<CipherDriver> => {
	if (!Service.exists(HERACLES_CIPHER)) throw new MissingJobCipherError(job);
	return Service.resolve<CipherDriver>(HERACLES_CIPHER);
};

/** The authenticated context of a job's ciphertext: it only opens for the same job. */
const contextOf = (job: string): string => `heracles:${job}`;

/**
 * The arguments a transport carries for a job: as they are, or encrypted as one JSON value when
 * the job is registered with `encrypted: true`. Arguments that are already encrypted are left as
 * they are. The ciphertext is bound to the job name: it does not open for another job.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param jobClass The job class.
 * @param job The job's service name.
 * @param args The constructor arguments.
 */
export const sealJobArgs = async (
	jobClass: JobClass<any, any>,
	job: string,
	args: readonly unknown[]
): Promise<unknown[]> => {
	if (!getJobMetadata(jobClass)?.encrypted) return [...args];
	// Already sealed, such as the arguments of an outbox effect or of a dead letter dispatched again.
	if (isSealed(args)) return [...args];
	const cipher = await cipherFor(job);
	return [{ $encrypted: await cipher.encrypt(JSON.stringify(args), contextOf(job)) }];
};

/**
 * The constructor arguments of a job from what its transport carried, decrypted when the job is
 * encrypted. Transports call it before they build the job.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param jobClass The job class.
 * @param job The job's service name.
 * @param args The arguments the transport carried.
 * @throws {MissingJobCipherError} When the job is encrypted and no cipher is configured.
 * @throws {DecryptionFailedError} When the arguments do not decrypt.
 */
export const openJobArgs = async (
	jobClass: JobClass<any, any>,
	job: string,
	args: readonly unknown[] | undefined
): Promise<unknown[]> => {
	if (!getJobMetadata(jobClass)?.encrypted) return [...(args ?? [])];
	if (!isSealed(args)) {
		throw new ElysiumError(`The job "${job}" is encrypted, but its arguments were sent in clear.`);
	}
	const cipher = await cipherFor(job);
	return JSON.parse(await cipher.decrypt(args[0].$encrypted, contextOf(job))) as unknown[];
};
