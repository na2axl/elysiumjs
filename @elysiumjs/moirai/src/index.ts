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
	type CommandOptions,
	type CommandOutcome,
	type CommandRetry,
	Commands,
	effectHandler,
	type Handler,
	type HandlerClass,
	type HandlerContext,
	Moirai,
	Queries,
	type QueryOptions,
	type QueryOutcome,
	registerEffect
} from './command';
export {
	isTransientError,
	MOIRAI_COMMAND_LOCK,
	MOIRAI_IDEMPOTENCY_STORE,
	MOIRAI_INBOX_STORE,
	MOIRAI_OPTIONS,
	MOIRAI_OUTBOX_STORE,
	type MoiraiOptions
} from './config';
export {
	CommandForbiddenError,
	IdempotencyConflictError,
	IdempotencyKeyRequiredError,
	IdempotencyKeyReusedError,
	InvalidInputError,
	MissingStoreError,
	UnknownEffectError
} from './errors';
export { requestHash } from './hash';
export { uuidv7 } from './ids';
export { MoiraiModule, type MoiraiModuleConfig } from './moirai.module';
export { backoffMs, Inbox, Outbox, type RelayOptions, type RelaySummary } from './outbox';
export {
	type CommandLock,
	type IdempotencyRecord,
	type IdempotencyStore,
	type InboxStore,
	MemoryCommandLock,
	MemoryIdempotencyStore,
	MemoryInboxStore,
	MemoryOutboxStore,
	type OutboxClaim,
	type OutboxClaimFilter,
	type OutboxEffect,
	type OutboxRow,
	type OutboxStore
} from './stores';
