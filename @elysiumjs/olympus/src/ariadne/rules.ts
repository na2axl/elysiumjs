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

import type {
	FlowAmend,
	FlowClaim,
	FlowClaimResult,
	FlowCommit,
	FlowCommitResult,
	FlowRecord
} from './store';

/**
 * A step reservation, as a store keeps it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FlowLease = { stepId: string; step: string; expiresAt: number };

/**
 * What one flow holds in a store: its record and its live reservation.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FlowSlot = { record: FlowRecord | null; lease: FlowLease | null };

const live = (lease: FlowLease | null, now: number): FlowLease | null =>
	lease !== null && lease.expiresAt > now ? lease : null;

/**
 * The rules every flow store follows, on a snapshot of one flow, so that the memory store and the
 * Durable Object store answer alike. Each function returns the result and the slot to keep.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export namespace FlowRules {
	/** A new flow of `owner`. */
	export const created = (owner: string): FlowRecord => ({
		owner,
		step: null,
		state: null,
		lastStepId: null,
		lastAnswer: null,
		completedAt: null
	});

	/**
	 * Reserves a step: replay first, then finished, then a live lease (of any submission), then the
	 * position. A granted claim answers the state the step runs on.
	 */
	export const claim = (
		slot: FlowSlot,
		input: FlowClaim,
		now: number
	): { result: FlowClaimResult; slot: FlowSlot } => {
		const { record } = slot;
		const refuse = (result: FlowClaimResult) => ({ result, slot });
		if (record === null) return refuse({ ok: false, reason: 'missing' });
		if (record.lastStepId === input.stepId) {
			return refuse(
				record.step === input.step
					? { ok: false, reason: 'replay', answer: record.lastAnswer }
					: { ok: false, reason: 'unexpected-step' }
			);
		}
		if (record.completedAt !== null) return refuse({ ok: false, reason: 'completed' });
		if (live(slot.lease, now) !== null) return refuse({ ok: false, reason: 'in-flight' });
		if (record.step !== input.expectStep) return refuse({ ok: false, reason: 'unexpected-step' });
		return {
			result: { ok: true, state: record.state },
			slot: {
				record,
				lease: {
					stepId: input.stepId,
					step: input.step,
					expiresAt: now + input.leaseSeconds * 1000
				}
			}
		};
	};

	/** Gives the lease of `stepId` back. */
	export const release = (slot: FlowSlot, stepId: string, now: number): FlowSlot =>
		live(slot.lease, now)?.stepId === stepId ? { ...slot, lease: null } : slot;

	/** Commits a claimed step; a repeat of the last step id replays its answer. */
	export const commit = (
		slot: FlowSlot,
		input: FlowCommit,
		now: number
	): { result: FlowCommitResult; slot: FlowSlot } => {
		const { record } = slot;
		if (record === null) return { result: { ok: false, reason: 'missing' }, slot };
		if (record.lastStepId === input.stepId) {
			return { result: { ok: true, replayed: true, answer: record.lastAnswer }, slot };
		}
		if (record.completedAt !== null) return { result: { ok: false, reason: 'completed' }, slot };
		const lease = live(slot.lease, now);
		if (
			lease?.stepId !== input.stepId ||
			lease.step !== input.step ||
			record.step !== input.expectStep
		) {
			return { result: { ok: false, reason: 'unexpected-step' }, slot };
		}
		return {
			result: { ok: true, replayed: false, answer: input.answer },
			slot: {
				lease: null,
				record: {
					owner: record.owner,
					step: input.step,
					state: input.state,
					lastStepId: input.stepId,
					lastAnswer: input.answer,
					completedAt: input.terminal ? new Date(now).toISOString() : null
				}
			}
		};
	};

	/**
	 * Under the lease of `stepId`: keeps the state and gives the lease back, or deletes the flow.
	 * Without that lease, nothing changes.
	 */
	export const amend = (slot: FlowSlot, input: FlowAmend, now: number): FlowSlot => {
		if (slot.record === null || live(slot.lease, now)?.stepId !== input.stepId) return slot;
		if (input.end) return { record: null, lease: null };
		return { record: { ...slot.record, state: input.state }, lease: null };
	};

	/** The finished flow once its answer is no longer replayable: only its owner and end time. */
	export const marker = (record: FlowRecord): FlowRecord => ({
		...record,
		state: null,
		lastStepId: null,
		lastAnswer: null
	});
}
