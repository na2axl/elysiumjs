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

import type { Static, TSchema } from 'typebox';
import type {
	Failed,
	LockDriver,
	LockHandle,
	Passed,
	ProblemClass,
	ServiceDefinition
} from '../index';
import type { MoiraiStores } from './moirai.module';

import Value from 'typebox/value';

import {
	AsyncResult,
	Clock,
	currentUserId,
	DATABASE_TRANSACTION_SERVICE,
	DomainError,
	getLogger,
	Metadata,
	Result,
	Service
} from '../index';
import { UnitOfWork } from '../mnemosyne/index';
import { actionLock, idempotencyStore, inOwnerModule, options } from './config';
import {
	CallForbiddenError,
	IdempotencyKeyRequiredError,
	IdempotencyKeyReusedError,
	InvalidInputError,
	LockOutsideUnitOfWorkError,
	NestedCallRefusedError,
	QueuedActionsUnavailableError,
	UndeclaredRefusalError
} from './errors';
import { requestHash } from './hash';
import { moduleStores } from './moirai.module';

const ACTION = Symbol.for('elysium:moirai:action');
const QUERY = Symbol.for('elysium:moirai:query');

/**
 * What an action or a query handler receives besides its input.
 * @author Axel Nana <ax.lnana@outlook.com>
 */

/**
 * Lets go of a lock once the current unit of work commits or rolls back, or now outside one. A
 * failed release is logged: the lock then ends with its time to live.
 */
const releaseWhenDone = async (lock: LockDriver, handle: LockHandle): Promise<void> => {
	const release = async () => {
		try {
			await lock.release(handle);
		} catch (error) {
			getLogger().error('Could not release a moirai lock', { key: handle.key, error });
		}
	};
	if (!UnitOfWork.active()) return release();
	await UnitOfWork.afterCommit(release);
	UnitOfWork.afterRollback(release);
};

export type HandlerContext = {
	/** The name of the action or the query. */
	name: string;
	/** The idempotency key of the call, if any. */
	idempotencyKey?: string;
	/** The attempt, from 1, when the action retries after a transient error. */
	attempt: number;
};

/**
 * What `handle()` gives: the result or one of the DomainErrors that refuse the call, or a
 * `Result` of them, or a promise of either.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HandlerResult<TResult, TErrors extends DomainError = DomainError> =
	| TResult
	| TErrors
	| Result<TResult, TErrors>
	| PromiseLike<TResult | TErrors | Result<TResult, TErrors>>;

type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * The value side of what a handler or a command gives: the value of a `Result`, or the members
 * of a `T | DomainError` union that are not DomainErrors.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ValueOf<V> =
	IsAny<V> extends true
		? any
		: V extends Passed<infer T>
			? T
			: V extends Failed<DomainError> | DomainError
				? never
				: V;

/**
 * The error side of what a handler or a command gives: the error of a `Result`, or the
 * DomainErrors of a `T | DomainError` union.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ErrorOf<V> =
	IsAny<V> extends true
		? DomainError
		: V extends Failed<infer E>
			? E
			: V extends DomainError
				? V
				: never;

/**
 * An action class.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ActionClass<
	TInput = any,
	TResult = any,
	TErrors extends DomainError = DomainError
> = new (...args: any[]) => Action<TInput, TResult, TErrors>;

/**
 * A query class.
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ActionCall = {
	idempotencyKey?: string;
	scope?: string;
	/** Runs the action now, as a call without a queue does. */
	queue?: false;
};

/**
 * How an action is called to run later, as a Heracles job: `queue` names the queue, or is `true`
 * for the `queue` of `@Action.register()` (else `default`).
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type QueuedActionCall = Omit<ActionCall, 'queue'> & { queue: string | true };

/**
 * What a queued call of `Moirai.execute()` gives once the job is accepted: the ids of the job and
 * of its dispatch, for `Queue.get(queue).getJobStatus()`, and its queue.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type QueuedAction = { jobId: string; dispatchId: string; queue: string };

/**
 * The arguments of `Moirai.execute()` after the action: its input, which may be left out when
 * `handle()` takes none (or an optional one), and how it is called.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ExecuteArgs<C extends ActionClass> =
	undefined extends InputOf<C>
		? [input?: InputOf<C>, call?: ActionCall]
		: [input: InputOf<C>, call?: ActionCall];

/**
 * The arguments of a queued call of `Moirai.execute()`: the input, then the call with its queue.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type QueuedExecuteArgs<C extends ActionClass> = [
	input: InputOf<C> | (undefined extends InputOf<C> ? undefined : never),
	call: QueuedActionCall
];

/**
 * The arguments of `Moirai.ask()` after the query: its input, which may be left out when
 * `handle()` takes none (or an optional one).
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type AskArgs<C extends QueryClass> =
	undefined extends InputOf<C> ? [input?: InputOf<C>] : [input: InputOf<C>];
type OutcomeOf<C extends HandlerClass> = Awaited<ReturnType<InstanceType<C>['handle']>>;
type ResultOf<C extends HandlerClass> = ValueOf<OutcomeOf<C>>;
type ErrorsOf<C extends HandlerClass> = ErrorOf<OutcomeOf<C>>;

/** Checks that the `errors` of a registration list every DomainError `handle()` gives. */
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

/** The refusals moirai itself gives a call, apart from those of its handler. */
type MoiraiRefusal =
	InvalidInputError | CallForbiddenError | IdempotencyKeyRequiredError | IdempotencyKeyReusedError;

/**
 * The DomainErrors that refuse an action: those of its handler, and those of moirai itself.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ActionErrors<C extends ActionClass> = ErrorsOf<C> | MoiraiRefusal;

/**
 * The DomainErrors that refuse a queued call before its job is dispatched: an invalid input, a
 * refused `authorize` and a missing idempotency key. The refusals of the handler happen in the
 * job.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type QueuedActionErrors =
	InvalidInputError | CallForbiddenError | IdempotencyKeyRequiredError;

/**
 * The DomainErrors that refuse a query: those of its handler, an invalid input and a refused call.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type QueryErrors<C extends QueryClass> =
	ErrorsOf<C> | InvalidInputError | CallForbiddenError;

/**
 * The result of `Moirai.execute()`: the value of the handler, or the DomainError that refused the
 * call, from the handler or from moirai itself.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ActionOutcome<C extends ActionClass> = Result<ResultOf<C>, ActionErrors<C>>;

/**
 * The result of `Moirai.ask()`: the value of the handler, or the DomainError that refused the call.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type QueryOutcome<C extends QueryClass> = Result<ResultOf<C>, QueryErrors<C>>;

const MOIRAI_REFUSALS = [
	InvalidInputError,
	CallForbiddenError,
	IdempotencyKeyRequiredError,
	IdempotencyKeyReusedError
] as const;

/**
 * What `Moirai.execute()` and `Moirai.ask()` give: the {@link AsyncResult} of the call, which
 * awaits to its `Result`. `orThrow()` resolves to the value and throws the DomainError, for
 * callers where a refusal is a bug, such as a job or an event handler (inside a handler, a
 * refusal the caller's `errors` do not list becomes an `UndeclaredRefusalError`); `errorOr(transform)`
 * resolves to the error or the transformed value, as a handler returns it.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * const wallet = await Moirai.execute(OpenWallet, { userId }).orThrow();
 * return Moirai.ask(WalletBalance, { walletId }).errorOr((balance) => view.render(balance));
 * ```
 */
export class Outcome<T, E extends DomainError = DomainError> extends AsyncResult<T, E> {
	readonly #call: string;

	public constructor(promise: PromiseLike<Result<T, E>>, call: string) {
		super(promise);
		this.#call = call;
	}

	/**
	 * The result to come with the DomainErrors of the called handler only, for a handler that
	 * calls another one and passes its refusals on. A refusal of moirai itself (invalid input,
	 * refused call, idempotency key) rejects with {@link NestedCallRefusedError}: the calling
	 * handler built that call, so it is a bug, not a refusal to pass on.
	 * @example
	 * ```ts
	 * const opened = await Moirai.execute(OpenSession, input).orPass();
	 * if (!opened.check()) return opened.error; // a DomainError of OpenSession
	 * ```
	 */
	public orPass(): AsyncResult<T, Exclude<E, MoiraiRefusal>> {
		return new AsyncResult(
			this.then((result) => {
				const error = result.error;
				if (error && MOIRAI_REFUSALS.some((refusal) => error instanceof refusal)) {
					throw new NestedCallRefusedError(this.#call, error);
				}
				return result as Result<T, Exclude<E, MoiraiRefusal>>;
			})
		);
	}
}

/**
 * How an action retries a transient failure.
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
	 * The DomainError classes `handle()` gives, checked against the errors of the class: `[]` when
	 * it gives none. The static `errors` of the class lists them, with those moirai answers with,
	 * for the `errors` of the routes that run it.
	 */
	errors: E;
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
	/**
	 * The queue of the calls that ask for one with `queue: true`. Calls without a queue run now.
	 * Defaults to `default`.
	 */
	queue?: string;
};

/**
 * The options of a query.
 * @author Axel Nana <ax.lnana@outlook.com>
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
	 * The DomainError classes `handle()` gives, checked against the errors of the class: `[]` when
	 * it gives none. The static `errors` of the class lists them, with those moirai answers with,
	 * for the `errors` of the routes that run it.
	 */
	errors: E;
	/** Decides whether the call may run. */
	authorize?: (input: Static<S>) => boolean | Promise<boolean>;
};

/**
 * An action: a write, validated, run in a unit of work, retried on transient failures, and
 * idempotent when asked. Mark the class with `@Action.register()` and run it with
 * {@link Moirai.execute}.
 * @author Axel Nana <ax.lnana@outlook.com>
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
			const name = props.name ?? target.name;
			Metadata.define(ACTION, { ...props, name }, target);
			actions.set(name, target);
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
	 * Runs the action with its validated input. Returning or throwing a DomainError, or returning
	 * a failed `Result`, refuses the call and rolls its unit of work back.
	 */
	public abstract handle(input: TInput, context: HandlerContext): HandlerResult<TResult, TErrors>;
}

/**
 * A query: a read, validated and run without a transaction. Mark the class with
 * `@Query.register()` and run it with {@link Moirai.ask}.
 * @author Axel Nana <ax.lnana@outlook.com>
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

	/**
	 * Runs the query with its validated input. Returning or throwing a DomainError, or returning a
	 * failed `Result`, refuses it.
	 */
	public abstract handle(input: TInput, context: HandlerContext): HandlerResult<TResult, TErrors>;
}

/** The action classes by name, for the jobs of queued calls. */
const actions = new Map<string, ActionClass>();

/**
 * A queued call, as its job carries it: the action, its checked input, and the idempotency key
 * and its owner, known when the call was made.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type QueuedRun = {
	action: string;
	input: unknown;
	idempotencyKey?: string;
	scope: string;
};

/** Dispatches the job of a queued call to a queue, and gives the ids of the job and dispatch. */
type ActionQueue = (
	run: QueuedRun,
	queue: string
) => Promise<{ jobId: string; dispatchId: string }>;

let actionQueue: ActionQueue | undefined;

/**
 * Sets what dispatches the jobs of queued calls. Called by `@elysiumjs/olympus/moirai/heracles`.
 * @internal
 */
export const setActionQueue = (queue: ActionQueue): void => {
	actionQueue = queue;
};

/** Call options that only the job of a queued call passes. */
type InternalCall = ActionCall & { authorized?: boolean };

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

/**
 * The value a handler gives, or the DomainError it is thrown as, so that the unit of work rolls
 * back. A `Result` gives its value or throws its error.
 */
const unwrap = <T>(given: unknown): T => Result.of(given).orThrow() as T;

/**
 * Runs a call, and gives its result: failed with the DomainError that refused it, when the
 * `errors` of the handler class list it. Any other DomainError is a bug, thrown as an
 * {@link UndeclaredRefusalError}.
 */
const settle = async <T>(
	handler: HandlerClass,
	call: () => Promise<T>
): Promise<Result<T, DomainError>> => {
	try {
		return Result.pass(await call());
	} catch (error) {
		if (!(error instanceof DomainError)) throw error;
		const declared = (handler as unknown as { errors?: readonly ProblemClass[] }).errors ?? [];
		if (declared.some((problem) => error instanceof problem)) return Result.fail(error);
		throw new UndeclaredRefusalError(handler.name, error);
	}
};

export namespace Moirai {
	/**
	 * Runs an action: validates the input, checks `authorize`, then runs the handler in a unit of
	 * work (or joins the open one), retrying transient failures, and replaying the stored response
	 * of an idempotent action called again with the same key.
	 *
	 * The call gives an {@link Outcome}, which awaits to its `Result`. A refusal fails it: the
	 * DomainError the handler returns or throws (or the error of the `Result` it returns), or one
	 * of moirai's own (an invalid input, a refused `authorize`, a missing or reused idempotency
	 * key). The unit of work rolls back and nothing is stored for idempotency. A route that returns
	 * the outcome answers its value, or its problem.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param action The action class.
	 * @param args The raw input, left out when `handle()` takes none, and the idempotency key and
	 * scope of the call.
	 */
	export function execute<C extends ActionClass>(
		action: C,
		...args: QueuedExecuteArgs<C>
	): Outcome<QueuedAction, QueuedActionErrors>;
	export function execute<C extends ActionClass>(
		action: C,
		...args: ExecuteArgs<C>
	): Outcome<ResultOf<C>, ActionErrors<C>>;
	export function execute<C extends ActionClass>(
		action: C,
		input?: unknown,
		call: ActionCall | QueuedActionCall = {}
	): Outcome<unknown, DomainError> {
		return new Outcome(
			settle(action, () => {
				const props = propsOf(action);
				// The action runs in its module, so that it uses the stores of that module.
				return inOwnerModule(action, () =>
					call.queue
						? enqueue(props, input, call as QueuedActionCall)
						: run(action, props, input as InputOf<C>, call as ActionCall)
				);
			}),
			action.name
		);
	}

	const propsOf = (action: ActionClass): ActionOptions & { name: string } => {
		const props = Metadata.get(ACTION, action) as (ActionOptions & { name: string }) | undefined;
		if (!props) throw new TypeError(`${action.name} is not marked with @Action.register().`);
		return props;
	};

	/** The owner of the idempotency keys of a call. */
	const scopeOf = (props: ActionOptions, value: unknown, call: { scope?: string }): string =>
		call.scope ?? props.scope?.(value) ?? currentUserId() ?? 'anonymous';

	/**
	 * Checks a queued call as a call that runs now would be checked, then dispatches its job: the
	 * input, `authorize` and the idempotency key, with the owner of the key read now, since the
	 * job runs without the caller's context.
	 */
	const enqueue = async (
		props: ActionOptions & { name: string },
		input: unknown,
		call: QueuedActionCall
	): Promise<QueuedAction> => {
		if (!actionQueue) throw new QueuedActionsUnavailableError(props.name);
		const value = validate(props.input, input, props.name);
		if (props.authorize && !(await props.authorize(value))) {
			throw new CallForbiddenError(props.name);
		}
		if (props.idempotent && !call.idempotencyKey) {
			throw new IdempotencyKeyRequiredError(props.name);
		}
		const queue = call.queue === true ? (props.queue ?? 'default') : call.queue;
		const ids = await actionQueue(
			{
				action: props.name,
				input: value,
				idempotencyKey: call.idempotencyKey,
				scope: scopeOf(props, value, call)
			},
			queue
		);
		return { ...ids, queue };
	};

	/**
	 * Runs the call a job carries, through the same path as a call that runs now, without
	 * `authorize`, which ran when the call was made.
	 * @internal
	 */
	export const runQueued = (queued: QueuedRun): Outcome<unknown, DomainError> => {
		const action = actions.get(queued.action);
		if (!action) {
			throw new TypeError(`No action is registered as ${queued.action}.`);
		}
		const call: InternalCall = {
			idempotencyKey: queued.idempotencyKey,
			scope: queued.scope,
			authorized: true
		};
		return new Outcome(
			settle(action, () =>
				inOwnerModule(action, () => run(action, propsOf(action), queued.input as never, call))
			),
			action.name
		);
	};

	/**
	 * Serializes the work that shares a key, from inside a handler, for a key known only once the
	 * handler has read something (`serializeBy` takes it from the input). It waits for the other
	 * holders of the key and holds it until the unit of work ends, with the `lock` of the module
	 * (the `postgres` driver takes a transaction-scoped advisory lock).
	 *
	 * Take the locks of one unit of work in the same order everywhere, and do not take a key twice
	 * in one unit of work: the memory driver is not reentrant.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param key The key, such as `wallet:${walletId}`.
	 * @throws {LockOutsideUnitOfWorkError} Outside a unit of work.
	 * @example
	 * ```ts
	 * const topUp = await this.topUps.find(input.topUpId);
	 * await Moirai.lock(`wallet:${topUp.walletId}`);
	 * ```
	 */
	export const lock = async (key: string): Promise<void> => {
		if (!UnitOfWork.active()) throw new LockOutsideUnitOfWorkError(key);
		const lock = actionLock();
		const handle = await lock.acquire(key, options().lockTtl, { wait: Infinity });
		if (!handle) return;
		await releaseWhenDone(lock, handle);
	};

	/**
	 * The stores and options of a module, as private services to list in its `services`. The
	 * actions and event handlers of the module, and the code that runs in it, use them instead of
	 * the ones of `MoiraiModule`; a store left out is the one of `MoiraiModule`, and an option left
	 * out is the one of `MoiraiModule`. Like any service, they are visible to the modules that
	 * import the module when it exports them.
	 * @author Axel Nana <ax.lnana@outlook.com>
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
		call: InternalCall
	): Promise<ResultOf<C>> => {
		const { name, idempotent = false, transactional = true, retry = true } = props;
		const config = options();

		const value = validate(props.input, input, name);
		if (!call.authorized && props.authorize && !(await props.authorize(value))) {
			throw new CallForbiddenError(name);
		}
		const key = call.idempotencyKey;
		if (idempotent && !key) throw new IdempotencyKeyRequiredError(name);
		// A key belongs to its owner and its action: another owner presenting it runs on its own.
		const storedKey = idempotent
			? [scopeOf(props, value, call), name, key!].map(encodeURIComponent).join(':')
			: undefined;

		const body = async (attempt: number): Promise<ResultOf<C>> => {
			const lock = props.serializeBy ? actionLock() : undefined;
			const handle = lock
				? await lock.acquire(props.serializeBy!(value), options().lockTtl, { wait: Infinity })
				: undefined;
			try {
				const handler = instanceOf(action);
				const context: HandlerContext = { name, idempotencyKey: key, attempt };
				if (!idempotent) return unwrap<ResultOf<C>>(await handler.handle(value, context));

				const store = idempotencyStore();
				const hash = await requestHash(value);
				const seen = await store.get(storedKey!);
				if (seen) {
					if (seen.action === name && seen.requestHash === hash)
						return seen.response as ResultOf<C>;
					throw new IdempotencyKeyReusedError(key!);
				}
				const response = unwrap<ResultOf<C>>(await handler.handle(value, context));
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
				// In a unit of work, the lock lasts until it commits or rolls back, so that the next
				// holder reads what this call wrote.
				if (lock && handle) await releaseWhenDone(lock, handle);
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
	 * runs the handler with the services of that module. The call gives an {@link Outcome}, which
	 * awaits to its `Result`. A refusal fails it: the DomainError the handler returns or throws
	 * (or the error of the `Result` it returns), an invalid input, or a refused `authorize`.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param query The query class.
	 * @param args The raw input, left out when `handle()` takes none.
	 */
	export const ask = <C extends QueryClass>(
		query: C,
		...[input]: AskArgs<C>
	): Outcome<ResultOf<C>, QueryErrors<C>> =>
		new Outcome(
			settle(query, async () => {
				const props = Metadata.get(QUERY, query) as (QueryOptions & { name: string }) | undefined;
				if (!props) throw new TypeError(`${query.name} is not marked with @Query.register().`);
				// The query runs in its module, so that it uses the services of that module.
				return inOwnerModule(query, async () => {
					const value = validate(props.input, input, props.name);
					if (props.authorize && !(await props.authorize(value)))
						throw new CallForbiddenError(props.name);
					return unwrap(await instanceOf(query).handle(value, { name: props.name, attempt: 1 }));
				});
			}) as Promise<QueryOutcome<C>>,
			query.name
		);

	/**
	 * The DomainErrors the handler of an action or a query gives, without those of moirai itself
	 * (invalid input, refused call, idempotency keys), for a caller that passes them on.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @example
	 * ```ts
	 * type ProfileEffectError = Moirai.ErrorsOf<typeof UnblockCreatorProfile>;
	 * ```
	 */
	export type ErrorsOf<C extends HandlerClass> = ErrorOf<OutcomeOf<C>>;
}
