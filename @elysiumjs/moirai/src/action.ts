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

import type { ProblemClass, ServiceDefinition } from '@elysiumjs/core';
import type { Static, TSchema } from 'typebox';
import type { MoiraiStores } from './moirai.module';

import {
	Clock,
	currentUserId,
	DATABASE_TRANSACTION_SERVICE,
	DomainError,
	Metadata,
	Service
} from '@elysiumjs/core';
import { UnitOfWork } from '@elysiumjs/mnemosyne';
import Value from 'typebox/value';

import { actionLock, idempotencyStore, inOwnerModule, options } from './config';
import {
	CallForbiddenError,
	IdempotencyKeyRequiredError,
	IdempotencyKeyReusedError,
	InvalidInputError
} from './errors';
import { requestHash } from './hash';
import { moduleStores } from './moirai.module';

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
 * What `handle()` gives: the result, or one of the DomainErrors that refuse the call.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HandlerResult<TResult, TErrors extends DomainError = DomainError> =
	Promise<TResult | TErrors> | TResult | TErrors;

/**
 * An action class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ActionClass<
	TInput = any,
	TResult = any,
	TErrors extends DomainError = DomainError
> = new (...args: any[]) => Action<TInput, TResult, TErrors>;

/**
 * A query class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QueryClass<
	TInput = any,
	TResult = any,
	TErrors extends DomainError = DomainError
> = new (...args: any[]) => Query<TInput, TResult, TErrors>;

type HandlerClass = ActionClass | QueryClass;
type HandleParameters<C extends HandlerClass> = Parameters<InstanceType<C>['handle']>;
type InputOf<C extends HandlerClass> =
	HandleParameters<C> extends [] ? undefined : HandleParameters<C>[0];

/**
 * How an action or a query is called.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ActionCall = { idempotencyKey?: string; scope?: string };

/**
 * The arguments of `Moirai.execute()` after the action: its input, which may be left out when
 * `handle()` takes none (or an optional one), and how it is called.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ExecuteArgs<C extends ActionClass> =
	undefined extends InputOf<C>
		? [input?: InputOf<C>, call?: ActionCall]
		: [input: InputOf<C>, call?: ActionCall];

/**
 * The arguments of `Moirai.ask()` after the query: its input, which may be left out when
 * `handle()` takes none (or an optional one).
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type AskArgs<C extends QueryClass> =
	undefined extends InputOf<C> ? [input?: InputOf<C>] : [input: InputOf<C>];
type OutcomeOf<C extends HandlerClass> = Awaited<ReturnType<InstanceType<C>['handle']>>;
type ResultOf<C extends HandlerClass> = Exclude<OutcomeOf<C>, DomainError>;
type ErrorsOf<C extends HandlerClass> = Extract<OutcomeOf<C>, DomainError>;

/**
 * Checks that the `errors` of a registration list every DomainError `handle()` gives. Without
 * `errors`, any class passes.
 */
type ListsErrorsOf<C extends HandlerClass, E extends readonly ProblemClass[]> = [
	Exclude<ErrorsOf<C>, InstanceType<E[number]>>
] extends [never]
	? unknown
	: {
			'errors must list every DomainError handle() gives': Exclude<
				ErrorsOf<C>,
				InstanceType<E[number]>
			>;
		};

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
export type ActionOptions<
	S extends TSchema = TSchema,
	E extends readonly ProblemClass[] = readonly ProblemClass[]
> = {
	/** The name of the action, in idempotency records and problems. Defaults to the class name. */
	name?: string;
	/** The schema of the input. An action without one takes no input. */
	input?: S;
	/**
	 * The schema of the result, given back by the static `result` of the class for the `response`
	 * of the routes that run it.
	 */
	result?: TSchema;
	/**
	 * The DomainError classes `handle()` gives, checked against the errors of the class. The static
	 * `errors` of the class lists them, with those moirai answers with, for the `errors` of the
	 * routes that run it.
	 */
	errors?: E;
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
export type QueryOptions<
	S extends TSchema = TSchema,
	E extends readonly ProblemClass[] = readonly ProblemClass[]
> = {
	/** The name of the query. Defaults to the class name. */
	name?: string;
	/** The schema of the input. A query without one takes no input. */
	input?: S;
	/**
	 * The schema of the result, given back by the static `result` of the class for the `response`
	 * of the routes that run it.
	 */
	result?: TSchema;
	/**
	 * The DomainError classes `handle()` gives, checked against the errors of the class. The static
	 * `errors` of the class lists them, with those moirai answers with, for the `errors` of the
	 * routes that run it.
	 */
	errors?: E;
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
export abstract class Action<
	TInput = any,
	TResult = any,
	TErrors extends DomainError = DomainError
> {
	/**
	 * Marks a class as an action.
	 * @param props The options of the action.
	 */
	public static register<
		S extends TSchema,
		const E extends readonly ProblemClass[] = readonly ProblemClass[]
	>(props: ActionOptions<S, E>) {
		return <T extends ActionClass>(target: T & ListsErrorsOf<T, E>): void => {
			Metadata.define(ACTION, { ...props, name: props.name ?? target.name }, target);
		};
	}

	/**
	 * The schema of the result, from `result` of `@Action.register()`, for the `response` of the
	 * routes that run the action.
	 * @example
	 * ```ts
	 * @Http.post('/top-ups', { response: TopUp.result, errors: TopUp.errors })
	 * ```
	 */
	public static get result(): TSchema | undefined {
		return (Metadata.get(ACTION, this) as ActionOptions | undefined)?.result;
	}

	/**
	 * The problems a call can answer with: the `errors` of `@Action.register()`, then those of
	 * moirai: invalid input, a refused call, a missing or reused idempotency key.
	 */
	public static get errors(): readonly ProblemClass[] {
		const props = Metadata.get(ACTION, this) as ActionOptions | undefined;
		return [
			...(props?.errors ?? []),
			...(props?.input ? [InvalidInputError] : []),
			...(props?.authorize ? [CallForbiddenError] : []),
			...(props?.idempotent ? [IdempotencyKeyRequiredError, IdempotencyKeyReusedError] : [])
		];
	}

	/**
	 * Runs the action with its validated input. Returning or throwing a DomainError refuses the
	 * call and rolls its unit of work back.
	 */
	public abstract handle(input: TInput, context: HandlerContext): HandlerResult<TResult, TErrors>;
}

/**
 * A query: a read, validated and run without a transaction. Mark the class with
 * `@Query.register()` and run it with {@link Moirai.ask}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class Query<
	TInput = any,
	TResult = any,
	TErrors extends DomainError = DomainError
> {
	/**
	 * Marks a class as a query.
	 * @param props The options of the query.
	 */
	public static register<
		S extends TSchema,
		const E extends readonly ProblemClass[] = readonly ProblemClass[]
	>(props: QueryOptions<S, E>) {
		return <T extends QueryClass>(target: T & ListsErrorsOf<T, E>): void => {
			Metadata.define(QUERY, { ...props, name: props.name ?? target.name }, target);
		};
	}

	/**
	 * The schema of the result, from `result` of `@Query.register()`, for the `response` of the
	 * routes that run the query.
	 */
	public static get result(): TSchema | undefined {
		return (Metadata.get(QUERY, this) as QueryOptions | undefined)?.result;
	}

	/**
	 * The problems a call can answer with: the `errors` of `@Query.register()`, then those of
	 * moirai: invalid input and a refused call.
	 */
	public static get errors(): readonly ProblemClass[] {
		const props = Metadata.get(QUERY, this) as QueryOptions | undefined;
		return [
			...(props?.errors ?? []),
			...(props?.input ? [InvalidInputError] : []),
			...(props?.authorize ? [CallForbiddenError] : [])
		];
	}

	/** Runs the query with its validated input. Returning or throwing a DomainError refuses it. */
	public abstract handle(input: TInput, context: HandlerContext): HandlerResult<TResult, TErrors>;
}

/** The instance of a handler: the registered service, or a new one with its dependencies. */
const instanceOf = <T>(target: new (...args: any[]) => T): T =>
	Service.get(target) ?? Service.make(target);

/** The input, with its defaults, or an {@link InvalidInputError} listing the mistakes. */
const validate = <S extends TSchema>(
	schema: S | undefined,
	raw: unknown,
	name: string
): Static<S> => {
	// A handler without an input schema takes no input.
	if (schema === undefined) return undefined as Static<S>;
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
	 * @param args The raw input, left out when `handle()` takes none, and the idempotency key and
	 * scope of the call.
	 */
	export const execute = <C extends ActionClass>(
		action: C,
		...[input, call = {}]: ExecuteArgs<C>
	): Promise<ActionOutcome<C>> =>
		settle(() => {
			const props = Metadata.get(ACTION, action) as (ActionOptions & { name: string }) | undefined;
			if (!props) throw new TypeError(`${action.name} is not marked with @Action.register().`);
			// The action runs in its module, so that it uses the stores of that module.
			return inOwnerModule(action, () => run(action, props, input, call));
		}) as Promise<ActionOutcome<C>>;

	/**
	 * The stores and options of a module, as private services to list in its `services`. The
	 * actions and event handlers of the module, and the code that runs in it, use them instead of
	 * the ones of `MoiraiModule`; a store left out is the one of `MoiraiModule`, and an option left
	 * out is the one of `MoiraiModule`. Like any service, they are visible to the modules that
	 * import the module when it exports them.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param stores The stores, each an instance or a function that builds it once, and options.
	 * @example
	 * ```ts
	 * @Module.register({
	 * 	controllers: [WalletController],
	 * 	services: [
	 * 		WalletRepository,
	 * 		...Moirai.stores({
	 * 			outbox: () => new DrizzleOutboxStore({ table: billing.outbox }),
	 * 			inbox: () => new DrizzleInboxStore({ table: billing.inbox })
	 * 		})
	 * 	]
	 * })
	 * class BillingModule extends Module {}
	 * ```
	 */
	export const stores = (stores: MoiraiStores): ServiceDefinition[] => moduleStores(stores);

	const run = async <C extends ActionClass>(
		action: C,
		props: ActionOptions & { name: string },
		input: InputOf<C> | undefined,
		call: ActionCall
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
					createdAt: Clock.now()
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
	 * Runs a query in the module that registers it: validates the input, checks `authorize`, and
	 * runs the handler with the services of that module. A refusal is a value: the DomainError the
	 * handler returns or throws, an invalid input, or a refused `authorize`.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param query The query class.
	 * @param args The raw input, left out when `handle()` takes none.
	 */
	export const ask = <C extends QueryClass>(
		query: C,
		...[input]: AskArgs<C>
	): Promise<QueryOutcome<C>> =>
		settle(async () => {
			const props = Metadata.get(QUERY, query) as (QueryOptions & { name: string }) | undefined;
			if (!props) throw new TypeError(`${query.name} is not marked with @Query.register().`);
			// The query runs in its module, so that it uses the services of that module.
			return inOwnerModule(query, async () => {
				const value = validate(props.input, input, props.name);
				if (props.authorize && !(await props.authorize(value)))
					throw new CallForbiddenError(props.name);
				return instanceOf(query).handle(value, { name: props.name, attempt: 1 });
			});
		}) as Promise<QueryOutcome<C>>;
}
