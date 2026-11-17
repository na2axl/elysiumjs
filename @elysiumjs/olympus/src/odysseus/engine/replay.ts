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
import { getLogger } from '../../logger.js';
import { toMilliseconds } from '../duration.js';
import {
	InvalidWorkflowStepError,
	WorkflowStepFailedError,
	WorkflowTimeoutError
} from '../errors.js';
import { decodeValue, encodeValue } from '../serialize.js';
import {
	assertRetries,
	assertStepName,
	DEFAULT_RETRIES,
	DEFAULT_STEP_TIMEOUT,
	DEFAULT_WAIT_TIMEOUT,
	doArguments,
	MAX_WAIT_MS,
	retryDelay,
	waitMilliseconds
} from '../step.js';

/** Thrown into an attempt that ran past its timeout. */
export class StepTimeoutError extends ElysiumError {
	constructor(step: string, ms: number) {
		super(`Step "${step}" ran longer than ${ms} ms.`);
	}
}

/** Thrown inside the replay when the store refuses a write: the run lost its lease. */
class Halt extends Error {}

/** What came of a step. */
type Outcome<T> =
	{ readonly value: T } | { readonly error: unknown } | { readonly suspendUntil: number };

/** A promise that never settles: a step that suspends the run stops its branch of `run()` here. */
const never = <T>(): Promise<T> => new Promise<T>(() => {});

/** The longest delay a timer takes at once. */
const MAX_TIMER_MS = 2_147_483_647;

/** Calls `fn` after `ms`, chaining timers past the longest delay one takes; answers a cancel. */
const later = (fn: () => void, ms: number): (() => void) => {
	let timer: ReturnType<typeof setTimeout>;
	const arm = (left: number) => {
		timer = setTimeout(
			() => (left > MAX_TIMER_MS ? arm(left - MAX_TIMER_MS) : fn()),
			Math.min(left, MAX_TIMER_MS)
		);
	};
	arm(ms);
	return () => clearTimeout(timer);
};

/**
 * One run of an instance: the steps `run()` is given, which replay the kept results, run the
 * steps that are due, and suspend the branch of `run()` that reaches a step that must wait.
 *
 * The lease is extended on a timer while the run lasts. Once the store refuses a write (another
 * worker took the instance, or it was terminated) or the run is closed, every step stops the
 * branch that called it, before doing any work.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class Replay {
	readonly #steps: Map<string, StoredStep>;
	readonly #events: StoredEvent[];
	readonly #counts = new Map<string, number>();
	readonly #controllers = new Set<AbortController>();
	#waiters: (() => void)[] = [];
	#pending = 0;
	#wakeAt: number | null = null;
	#closed = false;
	#stopHeartbeat: (() => void) | undefined;

	/** Whether a step suspended a branch of the run. */
	public isSuspended = false;
	/** Whether the store refused a write: another worker holds the instance, or it was stopped. */
	public lost = false;
	/** The `seq` of the last event the run knew of. */
	public readonly seenSeq: number;

	/** The steps given to `run()`. */
	public readonly step: WorkflowStep;

	public constructor(
		claimed: ClaimedInstance,
		private readonly store: WorkflowStoreDriver,
		private readonly ref: { readonly workflow: string; readonly id: string },
		private readonly owner: string,
		private readonly leaseMs: number,
		private readonly definition: WorkflowDefinition
	) {
		this.#steps = new Map(Object.entries(claimed.steps));
		this.#events = [...claimed.events];
		this.seenSeq = claimed.lastSeq;
		this.step = {
			do: (name: string, second: any, third?: any) => this.#op(() => this.#do(name, second, third)),
			sleep: (name: string, duration: WorkflowDuration) =>
				this.#op(() =>
					this.#sleepUntil(name, (now) => now + waitMilliseconds(duration, 'A sleep'))
				),
			sleepUntil: (name: string, until: Date | number | string) =>
				this.#op(() => this.#sleepUntil(name, () => new Date(until).getTime())),
			waitFor: (name: string, event: { type: string }, options?: WaitForOptions) =>
				this.#op(() => this.#waitFor(name, event, options))
		} as WorkflowStep;
		this.#heartbeat();
	}

	/** When the instance should run next: the earliest time a suspended step waits for. */
	public get wakeAt(): number | null {
		return this.#wakeAt;
	}

	/** How many steps are running or being kept. */
	public get pending(): number {
		return this.#pending;
	}

	/** Settles the next time a step starts, ends or suspends, or the lease is lost. */
	public changed(): Promise<void> {
		return new Promise<void>((resolve) => this.#waiters.push(resolve));
	}

	/** Ends the run: the lease is no longer extended and steps called from now on do nothing. */
	public close(): void {
		this.#closed = true;
		this.#stopHeartbeat?.();
		this.#notify();
	}

	#notify(): void {
		const waiters = this.#waiters;
		this.#waiters = [];
		for (const resolve of waiters) resolve();
	}

	/** Extends the lease a few times per lease period, while the run lasts. */
	#heartbeat(): void {
		const every = Math.max(1, Math.floor(this.leaseMs / 3));
		const beat = () => {
			this.#stopHeartbeat = later(() => {
				if (this.#closed || this.lost) return;
				const until = Clock.epochMs() + this.leaseMs;
				this.store
					.extend(this.ref.workflow, this.ref.id, { owner: this.owner, until })
					.then((held) => (held ? beat() : this.#halt()))
					.catch((error) => {
						getLogger().warn('The lease of a workflow instance could not be extended', {
							...this.ref,
							error
						});
						beat();
					});
			}, every);
		};
		beat();
	}

	/** Stops the run: the store refused a write. */
	#halt(): void {
		if (this.lost) return;
		this.lost = true;
		this.#stopHeartbeat?.();
		for (const controller of this.#controllers) controller.abort(new Halt());
		this.#notify();
	}

	/** Runs a step, and stops the branch that called it when it suspends or the run is over. */
	#op<T>(fn: () => Promise<Outcome<T>>): Promise<T> {
		if (this.#closed || this.lost) return never();
		this.#pending += 1;
		this.#notify();
		return fn()
			.catch((error): Outcome<T> | null => (error instanceof Halt ? null : { error }))
			.then((outcome) => {
				this.#pending -= 1;
				if (outcome === null) this.#halt();
				if (outcome === null || this.#closed || this.lost) {
					this.#notify();
					return never<T>();
				}
				if ('suspendUntil' in outcome) {
					const at = outcome.suspendUntil;
					this.#wakeAt = this.#wakeAt === null ? at : Math.min(this.#wakeAt, at);
					this.isSuspended = true;
					this.#notify();
					return never<T>();
				}
				this.#notify();
				if ('error' in outcome) throw outcome.error;
				return outcome.value;
			});
	}

	/** The key of the next use of a step name in this run. */
	#key(name: string): string {
		assertStepName(name);
		const count = (this.#counts.get(name) ?? 0) + 1;
		this.#counts.set(name, count);
		return count === 1 ? name : `${name}#${count}`;
	}

	/** Keeps a step under the lease. */
	async #save(key: string, step: StoredStep, takes?: number): Promise<void> {
		if (this.lost || this.#closed) throw new Halt();
		const { workflow, id } = this.ref;
		if (!(await this.store.saveStep(workflow, id, this.owner, key, step, takes))) throw new Halt();
		this.#steps.set(key, step);
	}

	/** A kept value, given back. */
	#decode(value: unknown): unknown {
		return decodeValue(value, this.definition.known);
	}

	async #do<T>(
		name: string,
		second: StepOptions | ((context: StepContext) => T | Promise<T>),
		third?: (context: StepContext) => T | Promise<T>
	): Promise<Outcome<T>> {
		const { options, work } = doArguments(second, third);
		const key = this.#key(name);
		const kept = this.#steps.get(key);
		if (kept?.kind === 'done') return { value: this.#decode(kept.value) as T };
		if (kept?.kind === 'failed')
			return { error: new WorkflowStepFailedError(name, kept.attempts, kept.reason) };
		if (kept?.kind === 'retry' && kept.at > Clock.epochMs()) return { suspendUntil: kept.at };

		const attempt = (kept?.kind === 'retry' ? kept.attempts : 0) + 1;
		const retries = options.retries ?? this.definition.retries ?? DEFAULT_RETRIES;
		assertRetries(retries);
		const timeout = toMilliseconds(
			options.timeout ?? this.definition.timeout ?? DEFAULT_STEP_TIMEOUT
		);

		const controller = new AbortController();
		this.#controllers.add(controller);
		let encoded: unknown;
		let failure: string | undefined;
		try {
			const value = await withTimeout(name, timeout, controller, (signal) =>
				work({ attempt, signal })
			);
			if (this.lost) throw new Halt();
			try {
				encoded = encodeValue(value);
			} catch (error) {
				const reason = `returned a value that cannot be kept: ${messageOf(error)}`;
				await this.#save(key, { kind: 'failed', attempts: attempt, reason });
				return { error: new WorkflowStepFailedError(name, attempt, reason) };
			}
		} catch (error) {
			if (error instanceof Halt || this.lost) throw new Halt();
			failure = messageOf(error);
		} finally {
			this.#controllers.delete(controller);
		}

		if (failure !== undefined) {
			if (attempt > retries.limit) {
				await this.#save(key, { kind: 'failed', attempts: attempt, reason: failure });
				return { error: new WorkflowStepFailedError(name, attempt, failure) };
			}
			const at = Clock.epochMs() + retryDelay(retries, attempt);
			await this.#save(key, { kind: 'retry', attempts: attempt, at });
			return { suspendUntil: at };
		}
		await this.#save(key, { kind: 'done', value: encoded });
		return { value: this.#decode(encoded) as T };
	}

	async #sleepUntil(name: string, until: (now: number) => number): Promise<Outcome<void>> {
		const key = this.#key(name);
		const kept = this.#steps.get(key);
		if (kept?.kind === 'done') return { value: undefined };
		const now = Clock.epochMs();
		const at = kept?.kind === 'sleep' ? kept.until : until(now);
		if (Number.isNaN(at)) {
			throw new InvalidWorkflowStepError(`The time step "${name}" sleeps until is not a date.`);
		}
		if (at <= now) {
			await this.#save(key, { kind: 'done', value: null });
			return { value: undefined };
		}
		if (!kept) {
			if (at - now > MAX_WAIT_MS) {
				throw new InvalidWorkflowStepError('A sleep cannot be longer than 365 days.');
			}
			await this.#save(key, { kind: 'sleep', until: at });
		}
		return { suspendUntil: at };
	}

	async #waitFor(
		name: string,
		event: { type: string },
		options: WaitForOptions = {}
	): Promise<Outcome<unknown>> {
		const key = this.#key(name);
		const kept = this.#steps.get(key);
		if (kept?.kind === 'done') return { value: this.#decode(kept.value) };
		const ms = waitMilliseconds(options.timeout ?? DEFAULT_WAIT_TIMEOUT, 'A wait');

		const index = this.#events.findIndex((candidate) => candidate.type === event.type);
		if (index !== -1) {
			const taken = this.#events[index]!;
			const encoded = encodeValue(taken.payload);
			await this.#save(key, { kind: 'done', value: encoded }, taken.seq);
			this.#events.splice(this.#events.indexOf(taken), 1);
			return { value: this.#decode(encoded) };
		}

		const now = Clock.epochMs();
		const until = kept?.kind === 'wait' ? kept.until : now + ms;
		if (until <= now) {
			const encoded = encodeValue(new WorkflowTimeoutError(name, event.type));
			await this.#save(key, { kind: 'done', value: encoded });
			return { value: this.#decode(encoded) };
		}
		if (!kept) await this.#save(key, { kind: 'wait', type: event.type, until });
		return { suspendUntil: until };
	}
}

/** The message of a thrown value. */
const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Runs work with a timeout: past it, the signal is aborted and the attempt fails. */
const withTimeout = async <T>(
	step: string,
	ms: number,
	controller: AbortController,
	work: (signal: AbortSignal) => T | Promise<T>
): Promise<T> => {
	let cancel: (() => void) | undefined;
	const stopped = new Promise<never>((_, reject) => {
		cancel = later(() => {
			const error = new StepTimeoutError(step, ms);
			controller.abort(error);
			reject(error);
		}, ms);
		controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
			once: true
		});
	});
	try {
		return await Promise.race([Promise.resolve().then(() => work(controller.signal)), stopped]);
	} finally {
		cancel?.();
	}
};
