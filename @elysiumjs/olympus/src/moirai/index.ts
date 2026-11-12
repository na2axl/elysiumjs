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

export {
	type ActionCall,
	type ActionClass,
	type ActionErrors,
	type ActionOptions,
	type ActionOutcome,
	type ActionRetry,
	type AskArgs,
	type ErrorOf,
	type ExecuteArgs,
	type HandlerContext,
	type HandlerResult,
	type Outcome,
	type QueryClass,
	type QueryErrors,
	type QueryOptions,
	type QueryOutcome,
	type ValueOf,
	Action,
	Moirai,
	Query
} from './action';
export {
	type AggregateClass,
	type AggregateOptions,
	type StateOf,
	Aggregate,
	AggregateScenario
} from './aggregate';
export {
	isTransientError,
	MOIRAI_ACTION_LOCK,
	MOIRAI_EVENT_STORE,
	MOIRAI_PROJECTION_STORAGE,
	MOIRAI_IDEMPOTENCY_STORE,
	MOIRAI_INBOX_STORE,
	MOIRAI_MODULE_OPTIONS,
	MOIRAI_OPTIONS,
	MOIRAI_OUTBOX_STORE,
	type MoiraiOptions
} from './config';
export {
	CallForbiddenError,
	ConcurrencyConflictError,
	DuplicateEventConsumerError,
	DuplicateStreamNameError,
	IdempotencyConflictError,
	IdempotencyKeyRequiredError,
	IdempotencyKeyReusedError,
	InvalidInputError,
	LockOutsideUnitOfWorkError,
	NestedCallRefusedError,
	UndeclaredRefusalError,
	MissingStoreError,
	PayloadReplacementUnsupportedError,
	UnknownEventConsumerError,
	UnknownEffectError,
	UnknownStoredEventError,
	UnregisteredStreamClassError
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
export { MoiraiModule, type MoiraiModuleConfig, type MoiraiStores } from './moirai.module';
export {
	type OutboxContext,
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
	type EventReadFilter,
	type EventStore,
	type IdempotencyRecord,
	type IdempotencyStore,
	type InboxStore,
	MemoryActionLock,
	MemoryEventStore,
	MemoryProjectionStorage,
	MemoryIdempotencyStore,
	MemoryInboxStore,
	MemoryOutboxStore,
	type OutboxClaim,
	type OutboxClaimFilter,
	type OutboxEffect,
	type OutboxRow,
	type OutboxStore,
	type ProjectionStorage,
	type StoredEventRecord
} from './stores';
export { ProjectionRebuildCommand } from './commands/projection-rebuild.command';
export { type ProjectionOptions, Projection } from './projection';
export { type ReactorOptions, Reactor } from './reactor';
export {
	type DataOf,
	type StoredEventClass,
	type StoredEventMeta,
	type StoredEventOptions,
	StoredEvent
} from './stored-event';
export { type Acted, type ActOptions, type ActOutcome, Streams } from './streams';
