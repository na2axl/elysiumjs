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

import type { Static, TSchema } from 'typebox';

import {
	currentUserId,
	DATABASE_TRANSACTION_SERVICE,
	DomainError,
	Metadata,
	Service
} from '@elysiumjs/core';
import { UnitOfWork } from '@elysiumjs/mnemosyne';
import Value from 'typebox/value';

import { actionLock, idempotencyStore, inStoreSet, options } from './config';
import {
	CallForbiddenError,
	IdempotencyKeyRequiredError,
	IdempotencyKeyReusedError,
	InvalidInputError
} from './errors';
import { requestHash } from './hash';

const ACTION = Symbol.for('elysium:moirai:action');
const QUERY = Symbol.for('elysium:moirai:query');

/**
 * What an action or a query handler receives besides its input.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HandlerContext = {
	/** The name of the action or the query. */
	name: string;
	/** The idempotency key of the call, if any. */
	idempotencyKey?: string;
	/** The attempt, from 1, when the action retries after a transient error. */
	attempt: number;
};

/**
 * What `handle()` gives: the result, or a DomainError that refuses the call.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HandlerResult<TResult> = Promise<TResult | DomainError> | TResult | DomainError;

/**
 * An action class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ActionClass<TInput = any, TResult = any> = new (
	...args: any[]
) => Action<TInput, TResult>;

/**
 * A query class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QueryClass<TInput = any, TResult = any> = new (
	...args: any[]
) => Query<TInput, TResult>;

type HandlerClass = ActionClass | QueryClass;
type InputOf<C extends HandlerClass> = Parameters<InstanceType<C>['handle']>[0];
type OutcomeOf<C extends HandlerClass> = Awaited<ReturnType<InstanceType<C>['handle']>>;
type ResultOf<C extends HandlerClass> = Exclude<OutcomeOf<C>, DomainError>;

/**
 * What `Moirai.execute()` gives: the result, or the DomainError that refused the call, from the
 * handler or from moirai itself.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ActionOutcome<C extends ActionClass> =
	| OutcomeOf<C>
	| InvalidInputError
	| CallForbiddenError
	| IdempotencyKeyRequiredError
	| IdempotencyKeyReusedError;

/**
 * What `Moirai.ask()` gives: the result, or the DomainError that refused the call.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QueryOutcome<C extends QueryClass> =
	OutcomeOf<C> | InvalidInputError | CallForbiddenError;

/**
 * How an action retries a transient failure.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ActionRetry = {
	/** The attempts, the first included. Defaults to `maxAttempts` of the module. */
	attempts?: number;
	/**
	 * Whether a failure, thrown or a returned DomainError, is transient. Defaults to `isTransient`
	 * of the module.
	 */
	isTransient?: (error: unknown) => boolean;
};

/**
 * The options of an action.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ActionOptions<S extends TSchema = TSchema> = {
	/** The name of the action, in idempotency records and problems. Defaults to the class name. */
	name?: string;
	/** The schema of the input. */
	input: S;
	/**
	 * Whether a call needs an idempotency key. A repeat with the same key and input replays the
	 * stored response; with another input, it is refused with a 422 problem. Defaults to `false`.
	 */
	idempotent?: boolean;
	/**
	 * Who owns the idempotency keys of the action, so that the keys of two owners never meet,
	 * such as a tenant and a user. Defaults to the id of the current user (`currentUserId()`),
	 * else `anonymous`. `Moirai.execute()` may pass its own.
	 */
	scope?: (input: Static<S>) => string;
	/** Whether the action runs in a unit of work, or joins the open one. Defaults to `true`. */
	transactional?: boolean;
	/** The database connection of the unit of work. Defaults to `default`. */
	connection?: string;
	/**
	 * The store set of the action, from the `stores` of `MoiraiModule`: its idempotency store, its
	 * lock, its options, and the outbox that the effects and events of the call go to. Defaults to
	 * the current set: the one of the action that runs it, else the default set.
	 */
	stores?: string;
	/**
	 * Serializes the calls that give the same key, so that a double tap waits for the first call
	 * and replays it instead of racing it. Needs a `lock` store.
	 */
	serializeBy?: (input: Static<S>) => string;
	/**
	 * Whether a transient failure retries in a new unit of work. Defaults to `true`, with the
	 * `maxAttempts` and `isTransient` of the module. An object sets them for this action, such as
	 * an `isTransient` that also retries a returned `ConcurrencyConflict` error. A transient
	 * DomainError that outlasts the attempts is returned like any refusal.
	 */
	retry?: boolean | ActionRetry;
	/** Decides whether the call may run, such as with the abilities of the current user. */
	authorize?: (input: Static<S>) => boolean | Promise<boolean>;
};

/**
 * The options of a query.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QueryOptions<S extends TSchema = TSchema> = {
	/** The name of the query. Defaults to the class name. */
	name?: string;
	/** The schema of the input. */
	input: S;
	/** Decides whether the call may run. */
	authorize?: (input: Static<S>) => boolean | Promise<boolean>;
};

/**
 * An action: a write, validated, run in a unit of work, retried on transient failures, and
 * idempotent when asked. Mark the class with `@Action.register()` and run it with
 * {@link Moirai.execute}.
 * @author Axel Nana <axel.nana@workbud.com>
 * @example
 * ```ts
 * @Action.register({ input: t.Object({ amount: t.Integer({ minimum: 1 }) }), idempotent: true })
 * class TopUp extends Action<{ amount: number }> {
 * 	constructor(@Service.inject() private readonly wallets: WalletRepository) {
 * 		super();
 * 	}
 *
 * 	public async handle(input: { amount: number }) {
 * 		const wallet = await this.wallets.credit(input.amount);
 * 		await Outbox.enqueue({ kind: 'wallet.credited', payload: { id: wallet.id } });
 * 		return { balance: wallet.balance };
 * 	}
 * }
 * ```
 */
export abstract class Action<TInput = any, TResult = any> {
	/**
	 * Marks a class as an action.
	 * @param props The options of the action.
	 */
	public static register<S extends TSchema>(props: ActionOptions<S>) {
		return (target: ActionClass): void => {
			Metadata.define(ACTION, { ...props, name: props.name ?? target.name }, target);
		};
	}

	/**
	 * Runs the action with its validated input. Returning or throwing a DomainError refuses the
	 * call and rolls its unit of work back.
	 */
	public abstract handle(input: TInput, context: HandlerContext): HandlerResult<TResult>;
}

/**
 * A query: a read, validated and run without a transaction. Mark the class with
 * `@Query.register()` and run it with {@link Moirai.ask}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class Query<TInput = any, TResult = any> {
	/**
	 * Marks a class as a query.
	 * @param props The options of the query.
	 */
	public static register<S extends TSchema>(props: QueryOptions<S>) {
		return (target: QueryClass): void => {
			Metadata.define(QUERY, { ...props, name: props.name ?? target.name }, target);
		};
	}

	/** Runs the query with its validated input. Returning or throwing a DomainError refuses it. */
	public abstract handle(input: TInput, context: HandlerContext): HandlerResult<TResult>;
}

/** The instance of a handler: the registered service, or a new one with its dependencies. */
const instanceOf = <T>(target: new (...args: any[]) => T): T =>
	(Service.exists(target) ? Service.get(target) : null) ?? Service.make(target);

/** The input, with its defaults, or an {@link InvalidInputError} listing the mistakes. */
const validate = <S extends TSchema>(schema: S, raw: unknown, name: string): Static<S> => {
	const value = Value.Default(schema, structuredClone(raw)) as Static<S>;
	const errors = [...Value.Errors(schema, value)];
	if (errors.length > 0) {
		throw new InvalidInputError(
			name,
			errors.map((error) => ({
				pointer: `/${(error as { instancePath?: string }).instancePath?.replace(/^\//, '') ?? ''}`,
				message: error.message
			}))
		);
	}
	return value;
};

/** The result, or the DomainError it is thrown as, so that the unit of work rolls back. */
const unwrap = <T>(result: T | DomainError): T => {
	if (result instanceof DomainError) throw result;
	return result;
};

/** Runs a call, and gives the DomainError that refused it as its value. */
const settle = async <T>(call: () => Promise<T>): Promise<T | DomainError> => {
	try {
		return await call();
	} catch (error) {
		if (error instanceof DomainError) return error;
		throw error;
	}
};

export namespace Moirai {
	/**
	 * Runs an action: validates the input, checks `authorize`, then runs the handler in a unit of
	 * work (or joins the open one), retrying transient failures, and replaying the stored response
	 * of an idempotent action called again with the same key.
	 *
	 * A refusal is a value: the DomainError the handler returns or throws, or one of moirai's own
	 * (an invalid input, a refused `authorize`, a missing or reused idempotency key). The unit of
	 * work rolls back, nothing is stored for idempotency, and the error is returned, so a handler
	 * that returns it sends it as the problem of its route.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param action The action class.
	 * @param input The raw input.
	 * @param call The idempotency key of the call.
	 */
	export const execute = <C extends ActionClass>(
		action: C,
		input: InputOf<C>,
		call: { idempotencyKey?: string; scope?: string } = {}
	): Promise<ActionOutcome<C>> =>
		settle(() => {
			const props = Metadata.get(ACTION, action) as (ActionOptions & { name: string }) | undefined;
			if (!props) throw new TypeError(`${action.name} is not marked with @Action.register().`);
			return inStoreSet(props.stores, () => run(action, props, input, call));
		}) as Promise<ActionOutcome<C>>;

	/**
	 * Runs work with a store set current, so that `Outbox.enqueue()`, `Event.publish()`,
	 * `Inbox.once()` and the actions it runs without a `stores` option use that set, such as in a
	 * webhook handler that writes to the outbox of its domain.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param stores The name of the store set.
	 * @param work The work.
	 */
	export const using = <T>(stores: string, work: () => T): T => inStoreSet(stores, work);

	const run = async <C extends ActionClass>(
		action: C,
		props: ActionOptions & { name: string },
		input: InputOf<C>,
		call: { idempotencyKey?: string; scope?: string }
	): Promise<ResultOf<C>> => {
		const { name, idempotent = false, transactional = true, retry = true } = props;
		const config = options();

		const value = validate(props.input, input, name);
		if (props.authorize && !(await props.authorize(value))) throw new CallForbiddenError(name);
		const key = call.idempotencyKey;
		if (idempotent && !key) throw new IdempotencyKeyRequiredError(name);
		// A key belongs to its owner and its action: another owner presenting it runs on its own.
		const storedKey = idempotent
			? [call.scope ?? props.scope?.(value) ?? currentUserId() ?? 'anonymous', name, key!]
					.map(encodeURIComponent)
					.join(':')
			: undefined;

		const body = async (attempt: number): Promise<ResultOf<C>> => {
			const release = props.serializeBy
				? await actionLock().lock(props.serializeBy(value))
				: undefined;
			try {
				const handler = instanceOf(action);
				const context: HandlerContext = { name, idempotencyKey: key, attempt };
				if (!idempotent) return unwrap(await handler.handle(value, context)) as ResultOf<C>;

				const store = idempotencyStore();
				const hash = await requestHash(value);
				const seen = await store.get(storedKey!);
				if (seen) {
					if (seen.action === name && seen.requestHash === hash)
						return seen.response as ResultOf<C>;
					throw new IdempotencyKeyReusedError(key!);
				}
				const response = unwrap(await handler.handle(value, context)) as ResultOf<C>;
				await store.put({
					key: storedKey!,
					action: name,
					requestHash: hash,
					// Kept as JSON, which is what a replay answers.
					response: response === undefined ? null : JSON.parse(JSON.stringify(response)),
					createdAt: new Date()
				});
				return response;
			} finally {
				release?.();
			}
		};

		const transaction = transactional && Service.exists(DATABASE_TRANSACTION_SERVICE);
		// An action that joins an open unit of work leaves the retries to whoever opened it.
		if (transaction && UnitOfWork.active()) return body(1);

		for (let attempt = 1; ; attempt++) {
			try {
				return transaction
					? await UnitOfWork.run(() => body(attempt), { connection: props.connection })
					: await body(attempt);
			} catch (error) {
				const policy = typeof retry === 'object' ? retry : {};
				const attempts = retry === false ? 1 : (policy.attempts ?? config.maxAttempts);
				const transient = policy.isTransient ?? config.isTransient;
				const again = attempt < attempts && transient(error);
				if (!again) throw error;
			}
		}
	};

	/**
	 * Runs a query: validates the input, checks `authorize`, and runs the handler. A refusal is a
	 * value: the DomainError the handler returns or throws, an invalid input, or a refused
	 * `authorize`.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param query The query class.
	 * @param input The raw input.
	 */
	export const ask = <C extends QueryClass>(
		query: C,
		input: InputOf<C>
	): Promise<QueryOutcome<C>> =>
		settle(async () => {
			const props = Metadata.get(QUERY, query) as (QueryOptions & { name: string }) | undefined;
			if (!props) throw new TypeError(`${query.name} is not marked with @Query.register().`);
			const value = validate(props.input, input, props.name);
			if (props.authorize && !(await props.authorize(value)))
				throw new CallForbiddenError(props.name);
			return instanceOf(query).handle(value, { name: props.name, attempt: 1 });
		}) as Promise<QueryOutcome<C>>;
}
