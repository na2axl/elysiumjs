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

export {
	type ActionClass,
	type ActionOptions,
	type ActionOutcome,
	type ActionRetry,
	type HandlerContext,
	type HandlerResult,
	type QueryClass,
	type QueryOptions,
	type QueryOutcome,
	Action,
	Moirai,
	Query
} from './action';
export {
	DEFAULT_STORE_SET,
	isTransientError,
	MOIRAI_ACTION_LOCK,
	MOIRAI_IDEMPOTENCY_STORE,
	MOIRAI_INBOX_STORE,
	MOIRAI_OPTIONS,
	MOIRAI_OUTBOX_STORE,
	type MoiraiOptions,
	storeServiceName
} from './config';
export {
	CallForbiddenError,
	DuplicateEventConsumerError,
	IdempotencyConflictError,
	IdempotencyKeyRequiredError,
	IdempotencyKeyReusedError,
	InvalidInputError,
	MissingStoreError,
	ReservedStoreSetError,
	UnknownEventConsumerError,
	UnknownEffectError
} from './errors';
export {
	type EventCatalogue,
	type EventHandlerOptions,
	type EventMeta,
	type EventName,
	type EventPayload,
	Event,
	MOIRAI_EVENT_EFFECT
} from './event';
export { requestHash } from './hash';
export { uuidv7 } from './ids';
export { MoiraiModule, type MoiraiModuleConfig, type MoiraiStoreSet } from './moirai.module';
export {
	type RelayOptions,
	type RelaySummary,
	backoffMs,
	effectHandler,
	Inbox,
	Outbox,
	registerEffect
} from './outbox';
export {
	type ActionLock,
	type IdempotencyRecord,
	type IdempotencyStore,
	type InboxStore,
	MemoryActionLock,
	MemoryIdempotencyStore,
	MemoryInboxStore,
	MemoryOutboxStore,
	type OutboxClaim,
	type OutboxClaimFilter,
	type OutboxEffect,
	type OutboxRow,
	type OutboxStore
} from './stores';
