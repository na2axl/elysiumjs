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
	FlowRecord,
	FlowStore
} from '@elysiumjs/olympus/ariadne';

/**
 * The RPC surface of `FlowStoreObject` (`@elysiumjs/workers/durable-objects`), as a binding's stub exposes it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FlowStoreStub = {
	init(owner: string, ttlSeconds: number): Promise<void>;
	load(): Promise<FlowRecord | null>;
	claim(input: FlowClaim): Promise<FlowClaimResult>;
	release(stepId: string): Promise<void>;
	commit(input: FlowCommit): Promise<FlowCommitResult>;
	amend(input: FlowAmend): Promise<void>;
};

/**
 * The slice of a Durable Object namespace binding that {@link durableFlowStore} uses.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FlowStoreNamespace = {
	idFromName(name: string): unknown;
	get(id: any): unknown;
};

/**
 * A flow store over the `FlowStoreObject` (`@elysiumjs/workers/durable-objects`) binding: one object per flow.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param binding The binding, or a function that returns it, such as
 * `() => Workers.env().FLOWS`.
 * @example
 * ```ts
 * AriadneModule.with({ flows, store: durableFlowStore(() => Workers.env().FLOWS) });
 * ```
 */
export const durableFlowStore = (
	binding: FlowStoreNamespace | (() => FlowStoreNamespace)
): FlowStore => {
	const stub = (key: string): FlowStoreStub => {
		const namespace = typeof binding === 'function' ? binding() : binding;
		return namespace.get(namespace.idFromName(key)) as FlowStoreStub;
	};
	return {
		init: (key, owner, ttlSeconds) => stub(key).init(owner, ttlSeconds),
		load: (key) => stub(key).load(),
		claim: (key, input) => stub(key).claim(input),
		release: (key, stepId) => stub(key).release(stepId),
		commit: (key, input) => stub(key).commit(input),
		amend: (key, input) => stub(key).amend(input)
	};
};
