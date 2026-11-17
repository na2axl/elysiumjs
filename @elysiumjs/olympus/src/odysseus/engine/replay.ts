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

import type { WorkflowDuration } from '../duration.js';
import type { StepContext, StepOptions, WaitForOptions, WorkflowStep } from '../step.js';
import type { WorkflowDefinition } from '../workflow.js';
import type { ClaimedInstance, StoredEvent, StoredStep, WorkflowStoreDriver } from './store.js';

import { Clock } from '../../clock.js';
import { ElysiumError } from '../../errors.js';
import { toMilliseconds } from '../duration.js';
import { WorkflowStepFailedError, WorkflowTimeoutError } from '../errors.js';
import { decodeValue, encodeValue } from '../serialize.js';
import {
	assertStepName,
	DEFAULT_RETRIES,
	DEFAULT_STEP_TIMEOUT,
	DEFAULT_WAIT_TIMEOUT,
	doArguments,
	retryDelay,
	waitMilliseconds
} from '../step.js';

/** Thrown inside a run whose lease another worker took: the run stops and writes nothing more. */
export class LeaseLostError extends ElysiumError {
	constructor() {
		super('The workflow instance is held by another worker.');
	}
}

/** Thrown into an attempt that ran past its timeout. */
export class StepTimeoutError extends ElysiumError {
	constructor(step: string, ms: number) {
		super(`Step "${step}" ran longer than ${ms} ms.`);
	}
}

/** A promise that never settles: a step that suspends the run stops its branch of `run()` here. */
const never = <T>(): Promise<T> => new Promise<T>(() => {});

/**
 * One run of an instance: the steps `run()` is given, which replay the kept results, run the
 * steps that are due, and suspend the run on the first step that must wait.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class Replay {
	readonly #steps: Map<string, StoredStep>;
	readonly #events: StoredEvent[];
	readonly #counts = new Map<string, number>();
	readonly #inflight = new Set<Promise<unknown>>();
	#leaseUntil: number;
	#wakeAt: number | null = null;
	#suspend!: () => void;

	/** Settles when the run is suspended or its lease is lost. */
	public readonly suspended: Promise<void>;
	/** Whether a step suspended the run. */
	public isSuspended = false;
	/** Whether another worker took the instance. */
	public lost = false;
	/** The `seq` of the last event the run knew of. */
	public readonly seenSeq: number;

	/** The steps given to `run()`. */
	public readonly step: WorkflowStep;

	public constructor(
		claimed: ClaimedInstance,
		private readonly store: WorkflowStoreDriver,
		private readonly owner: string,
		private readonly leaseMs: number,
		private readonly definition: WorkflowDefinition
	) {
		this.#steps = new Map(Object.entries(claimed.steps));
		this.#events = [...claimed.events];
		this.seenSeq = claimed.lastSeq;
		this.#leaseUntil = Clock.epochMs() + leaseMs;
		this.suspended = new Promise<void>((resolve) => (this.#suspend = resolve));
		const replay = this;
		this.step = {
			do: (name: string, second: any, third?: any) => replay.#do(name, second, third),
			sleep: (name: string, duration: WorkflowDuration) =>
				replay.#sleepUntil(name, null, waitMilliseconds(duration, 'A sleep')),
			sleepUntil: (name: string, until: Date | number | string) =>
				replay.#sleepUntil(name, new Date(until).getTime(), 0),
			waitFor: (name, event, options) => replay.#waitFor(name, event, options)
		} as WorkflowStep;
	}

	/** When the instance should run next: the earliest time a suspended step waits for. */
	public get wakeAt(): number | null {
		return this.#wakeAt;
	}

	/** Waits for the steps still running, so that their results are kept before the run ends. */
	public async quiesce(): Promise<void> {
		while (this.#inflight.size > 0) await Promise.allSettled([...this.#inflight]);
	}

	/** The key of the next use of a step name in this run. */
	#key(name: string): string {
		assertStepName(name);
		const count = (this.#counts.get(name) ?? 0) + 1;
		this.#counts.set(name, count);
		return count === 1 ? name : `${name}#${count}`;
	}

	/** Suspends the run until a time, and stops the branch of `run()` that asked. */
	#suspendUntil<T>(at: number): Promise<T> {
		this.#wakeAt = this.#wakeAt === null ? at : Math.min(this.#wakeAt, at);
		this.isSuspended = true;
		this.#suspend();
		return never();
	}

	/** Keeps a step under the lease, and extends the lease once half of it is spent. */
	async #save(key: string, step: StoredStep, takes?: number): Promise<void> {
		const { workflow, id } = this.#ref;
		if (!(await this.store.saveStep(workflow, id, this.owner, key, step, takes))) this.#lose();
		this.#steps.set(key, step);
		const now = Clock.epochMs();
		if (now > this.#leaseUntil - this.leaseMs / 2) {
			const until = now + this.leaseMs;
			if (!(await this.store.extend(workflow, id, { owner: this.owner, until }))) this.#lose();
			this.#leaseUntil = until;
		}
	}

	/** Stops the run: another worker holds the instance. */
	#lose(): never {
		this.lost = true;
		this.#suspend();
		throw new LeaseLostError();
	}

	#ref!: { workflow: string; id: string };

	/** Binds the run to its instance. */
	public bind(workflow: string, id: string): this {
		this.#ref = { workflow, id };
		return this;
	}

	/** A kept value, given back. */
	#decode(value: unknown): unknown {
		return decodeValue(value, this.definition.known);
	}

	async #do<T>(
		name: string,
		second: StepOptions | ((context: StepContext) => T | Promise<T>),
		third?: (context: StepContext) => T | Promise<T>
	): Promise<T> {
		const { options, work } = doArguments(second, third);
		const key = this.#key(name);
		const kept = this.#steps.get(key);
		if (kept?.kind === 'done') return this.#decode(kept.value) as T;
		if (kept?.kind === 'failed')
			throw new WorkflowStepFailedError(name, kept.attempts, kept.reason);
		if (kept?.kind === 'retry' && kept.at > Clock.epochMs()) return this.#suspendUntil(kept.at);

		const attempt = (kept?.kind === 'retry' ? kept.attempts : 0) + 1;
		const retries = options.retries ?? this.definition.retries ?? DEFAULT_RETRIES;
		const timeout = toMilliseconds(
			options.timeout ?? this.definition.timeout ?? DEFAULT_STEP_TIMEOUT
		);
		const running = this.#attempt(name, key, work, attempt, retries.limit, timeout, retries);
		this.#inflight.add(running);
		try {
			const outcome = await running;
			if ('retryAt' in outcome) return this.#suspendUntil(outcome.retryAt);
			return outcome.value as T;
		} finally {
			this.#inflight.delete(running);
		}
	}

	/** Runs one attempt of a step and keeps what came of it. */
	async #attempt<T>(
		name: string,
		key: string,
		work: (context: StepContext) => T | Promise<T>,
		attempt: number,
		limit: number,
		timeout: number,
		retries: StepOptions['retries'] & object
	): Promise<{ value: unknown } | { retryAt: number }> {
		let value: unknown;
		try {
			value = await withTimeout(name, timeout, (signal) => work({ attempt, signal }));
		} catch (error) {
			if (error instanceof LeaseLostError) throw error;
			const reason = error instanceof Error ? error.message : String(error);
			if (attempt > limit) {
				await this.#save(key, { kind: 'failed', attempts: attempt, reason });
				throw new WorkflowStepFailedError(name, attempt, reason);
			}
			const retryAt = Clock.epochMs() + retryDelay(retries, attempt);
			await this.#save(key, { kind: 'retry', attempts: attempt, at: retryAt });
			return { retryAt };
		}
		const encoded = encodeValue(value);
		await this.#save(key, { kind: 'done', value: encoded });
		return { value: this.#decode(encoded) };
	}

	async #sleepUntil(name: string, until: number | null, ms: number): Promise<void> {
		const key = this.#key(name);
		const kept = this.#steps.get(key);
		if (kept?.kind === 'done') return;
		const now = Clock.epochMs();
		const at = kept?.kind === 'sleep' ? kept.until : (until ?? now + ms);
		if (Number.isNaN(at))
			throw new WorkflowStepFailedError(name, 0, 'The time to sleep until is not a date.');
		if (at <= now) {
			await this.#save(key, { kind: 'done', value: null });
			return;
		}
		if (!kept) {
			if (at - now > waitMilliseconds('365 days', 'A sleep')) {
				waitMilliseconds(at - now, 'A sleep');
			}
			await this.#save(key, { kind: 'sleep', until: at });
		}
		return this.#suspendUntil(at);
	}

	async #waitFor(
		name: string,
		event: { type: string },
		options: WaitForOptions = {}
	): Promise<any> {
		const key = this.#key(name);
		const kept = this.#steps.get(key);
		if (kept?.kind === 'done') return this.#decode(kept.value);
		const ms = waitMilliseconds(options.timeout ?? DEFAULT_WAIT_TIMEOUT, 'A wait');

		const index = this.#events.findIndex((candidate) => candidate.type === event.type);
		if (index !== -1) {
			const [taken] = this.#events.splice(index, 1);
			const encoded = encodeValue(taken!.payload);
			await this.#save(key, { kind: 'done', value: encoded }, taken!.seq);
			return this.#decode(encoded);
		}

		const now = Clock.epochMs();
		const until = kept?.kind === 'wait' ? kept.until : now + ms;
		if (until <= now) {
			const encoded = encodeValue(new WorkflowTimeoutError(name, event.type));
			await this.#save(key, { kind: 'done', value: encoded });
			return this.#decode(encoded);
		}
		if (!kept) await this.#save(key, { kind: 'wait', type: event.type, until });
		return this.#suspendUntil(until);
	}
}

/** Runs work with a timeout: past it, the signal is aborted and the attempt fails. */
const withTimeout = async <T>(
	step: string,
	ms: number,
	work: (signal: AbortSignal) => T | Promise<T>
): Promise<T> => {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			const error = new StepTimeoutError(step, ms);
			controller.abort(error);
			reject(error);
		}, ms);
	});
	try {
		return await Promise.race([Promise.resolve().then(() => work(controller.signal)), expired]);
	} finally {
		clearTimeout(timer);
	}
};
