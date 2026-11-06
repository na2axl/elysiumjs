// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

/**
 * What a flow store keeps about one flow.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowRecord = {
	/** The user id, or the guest token, that owns the flow. */
	owner: string;
	/** The last committed step, or `null` before the first one. */
	step: string | null;
	state: unknown;
	/** The id of the last committed submission. */
	lastStepId: string | null;
	lastAnswer: unknown;
	/** When the flow finished, as an ISO instant; `null` while it runs. */
	completedAt: string | null;
};

/**
 * Reserves a step before it runs.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowClaim = {
	stepId: string;
	step: string;
	/** The step the flow must stand at. */
	expectStep: string | null;
	/** How long the reservation lives when its caller dies before commit or release, in seconds. */
	leaseSeconds: number;
};

/**
 * Why a claim was refused, or the answer to replay. Returned, never thrown, since an error loses
 * its class across a Durable Object call.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowClaimResult =
	| {
			ok: true;
			/** The state the step runs on, as the store held it when the step was reserved. */
			state: unknown;
	  }
	| { ok: false; reason: 'in-flight' }
	| { ok: false; reason: 'replay'; answer: unknown }
	| { ok: false; reason: 'unexpected-step' | 'completed' | 'missing' };

/**
 * Commits a claimed step.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowCommit = {
	stepId: string;
	step: string;
	expectStep: string | null;
	state: unknown;
	answer: unknown;
	/** Whether the step ends the flow. */
	terminal: boolean;
	ttlSeconds: number;
};

/**
 * The result of a commit.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowCommitResult =
	| { ok: true; replayed: boolean; answer: unknown }
	| { ok: false; reason: 'unexpected-step' | 'completed' | 'missing' };

/**
 * Keeps the state of a refused step, or ends the flow, under the claim of `stepId`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowAmend = {
	stepId: string;
	/** Replaces the state; the position and the last answer stay. */
	state: unknown;
	/** Deletes the flow instead. */
	end: boolean;
};

/**
 * Where flows live. Every method takes the key of one flow, `{flow}:{flowKey}`.
 *
 * A finished flow keeps its last answer replayable for up to 10 minutes (or its TTL when shorter).
 * Then only its owner and end time stay, for its TTL, so that a late call learns that the flow is
 * finished and not that it expired.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface FlowStore {
	/** Creates a flow for its owner. An existing flow is left as it is. */
	init(key: string, owner: string, ttlSeconds: number): Promise<void>;
	load(key: string): Promise<FlowRecord | null>;
	/**
	 * Reserves a step before it runs, so that its side effects happen once, and answers the state
	 * it runs on. A repeat of the last committed step id replays its answer, and a step submitted
	 * while another submission holds the reservation is `in-flight`.
	 */
	claim(key: string, claim: FlowClaim): Promise<FlowClaimResult>;
	/** Gives a reservation back, so that the same step id can be retried. */
	release(key: string, stepId: string): Promise<void>;
	commit(key: string, commit: FlowCommit): Promise<FlowCommitResult>;
	amend(key: string, amend: FlowAmend): Promise<void>;
}

/** How long a finished flow's last answer stays replayable, at most, in seconds. */
export const FLOW_TOMBSTONE_SECONDS = 600;

/**
 * How long a step's reservation lives by default, in seconds. A step that runs longer may run
 * again when its submission is retried, so a slow step sets `lease` on `@Flow.step()`.
 */
export const FLOW_STEP_LEASE_SECONDS = 30;

/** The header that carries the owner token of a guest flow. */
export const FLOW_OWNER_HEADER = 'x-flow-owner';

/** The header that carries the key of the flow a request is about. */
export const FLOW_KEY_HEADER = 'x-flow-key';

/** The header that carries the id of a step submission, which a retry repeats. */
export const FLOW_STEP_HEADER = 'x-flow-step';
