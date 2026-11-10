// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import { DomainError } from './problem';

/**
 * A result that passed: its value.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class Passed<T> {
	public constructor(public readonly result: T) {}

	/** Always undefined: a passed result has no error. */
	public get error(): undefined {
		return undefined;
	}

	/** `true`: narrows the result to its passed side, where `result` is the value. */
	public check(): this is Passed<T> {
		return true;
	}

	/** The value. */
	public orThrow(): T {
		return this.result;
	}

	/** The value. */
	public orError(): T {
		return this.result;
	}

	/** The value, transformed. */
	public errorOr<U>(transform: (value: T) => U): U {
		return transform(this.result);
	}

	/** A passed result of the value, transformed. */
	public map<U>(transform: (value: T) => U): Passed<U> {
		return new Passed(transform(this.result));
	}

	/** The result the next step gives from the value. */
	public andThen<R extends Result<unknown, DomainError>>(next: (value: T) => R): R {
		return next(this.result);
	}
}

/**
 * A result that failed: the DomainError that says why.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class Failed<E extends DomainError> {
	public constructor(public readonly error: E) {}

	/** Always undefined: a failed result has no value. */
	public get result(): undefined {
		return undefined;
	}

	/** `false`: on the other branch, the result is narrowed to its failed side. */
	public check(): this is Passed<never> {
		return false;
	}

	/** Throws the error. */
	public orThrow(): never {
		throw this.error;
	}

	/** The error. */
	public orError(): E {
		return this.error;
	}

	/** The error; `transform` is not called. */
	public errorOr<U>(_transform: (value: never) => U): E {
		return this.error;
	}

	/** The same failed result. */
	public map<U>(_transform: (value: never) => U): Failed<E> {
		return this;
	}

	/** The same failed result; `next` is not called. */
	public andThen<R extends Result<unknown, DomainError>>(_next: (value: never) => R): Failed<E> {
		return this;
	}
}

/**
 * The outcome of a check or a call: the value it passed with, or the DomainError it failed with.
 * `check()` narrows it; `result` and `error` read it; `orThrow()` gives the value or throws the
 * error; `errorOr(transform)` gives the error or the transformed value, as a handler returns it.
 *
 * A handler may return a `Result`: a passed one answers its value, a failed one its problem.
 * @author Axel Nana <axel.nana@workbud.com>
 * @example
 * ```ts
 * const mayBuy = (account: Account): Result<Buyer, ForbiddenError> =>
 * 	account.adult ? Result.pass({ id: account.id }) : Result.fail(new ForbiddenError('adults only'));
 *
 * const buyer = mayBuy(account);
 * if (!buyer.check()) return buyer.error;
 * buyer.result.id;
 * ```
 */
export type Result<T, E extends DomainError = DomainError> = Passed<T> | Failed<E>;

/** The value side of a `T | DomainError` union. */
type ValueOf<V> = Exclude<V, DomainError>;
/** The error side of a `T | DomainError` union. */
type ErrorOf<V> = Extract<V, DomainError>;

export namespace Result {
	/**
	 * A passed result.
	 * @param value The value.
	 */
	export const pass = <T>(value: T): Passed<T> => new Passed(value);

	/**
	 * A failed result.
	 * @param error The DomainError that says why.
	 */
	export const fail = <E extends DomainError>(error: E): Failed<E> => new Failed(error);

	/**
	 * Whether a value is a {@link Result}.
	 * @param value The value.
	 */
	export const is = (value: unknown): value is Result<unknown, DomainError> =>
		value instanceof Passed || value instanceof Failed;

	/**
	 * The result of a `T | DomainError` union: failed when it is a DomainError, else passed. A
	 * result is given back as it is.
	 * @param value The value or the error.
	 */
	export function of<V>(
		value: V
	): V extends Result<infer T, infer E> ? Result<T, E> : Result<ValueOf<V>, ErrorOf<V>>;
	export function of(value: unknown): Result<unknown, DomainError> {
		if (is(value)) return value;
		return value instanceof DomainError ? fail(value) : pass(value);
	}
}

/**
 * A result to come, such as the outcome of an asynchronous call. Awaiting it gives the
 * {@link Result}; its methods mirror those of a result and chain without awaiting first.
 *
 * `Result` itself is not a thenable: awaiting would unwrap it. `AsyncResult` is the promise of one.
 * @author Axel Nana <axel.nana@workbud.com>
 * @example
 * ```ts
 * const wallet = await AsyncResult.from(wallets.open(userId)).orThrow();
 * return AsyncResult.from(wallets.pay(id, amount)).errorOr((wallet) => view.render(wallet));
 * ```
 */
export class AsyncResult<T, E extends DomainError = DomainError> implements PromiseLike<
	Result<T, E>
> {
	readonly #promise: Promise<Result<T, E>>;

	public constructor(promise: PromiseLike<Result<T, E>>) {
		this.#promise = Promise.resolve(promise);
	}

	/**
	 * The result to come of a promise of a value, a DomainError or a result.
	 * @param promise The promise.
	 */
	public static from<V>(
		promise: PromiseLike<V>
	): V extends Result<infer T, infer E> ? AsyncResult<T, E> : AsyncResult<ValueOf<V>, ErrorOf<V>>;
	public static from(promise: PromiseLike<unknown>): AsyncResult<unknown, DomainError> {
		return new AsyncResult(Promise.resolve(promise).then((value) => Result.of(value)));
	}

	public then<R1 = Result<T, E>, R2 = never>(
		onFulfilled?: ((value: Result<T, E>) => R1 | PromiseLike<R1>) | null,
		onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
	): Promise<R1 | R2> {
		return this.#promise.then(onFulfilled, onRejected);
	}

	public catch<R = never>(
		onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null
	): Promise<Result<T, E> | R> {
		return this.#promise.catch(onRejected);
	}

	public finally(onFinally?: (() => void) | null): Promise<Result<T, E>> {
		return this.#promise.finally(onFinally);
	}

	/** Resolves to the value, and rejects with the error. */
	public orThrow(): Promise<T> {
		return this.#promise.then((result) => result.orThrow());
	}

	/** Resolves to the value or the error, as a handler returns it. */
	public orError(): Promise<T | E> {
		return this.#promise.then((result) => result.orError());
	}

	/** Resolves to the error, or to the value transformed. */
	public errorOr<U>(transform: (value: T) => U | PromiseLike<U>): Promise<E | U> {
		return this.#promise.then((result) =>
			result.check() ? transform(result.result) : (result.error as E)
		);
	}

	/** The result to come of the value, transformed. */
	public map<U>(transform: (value: T) => U | PromiseLike<U>): AsyncResult<U, E> {
		return new AsyncResult(
			this.#promise.then(async (result): Promise<Result<U, E>> =>
				result.check() ? Result.pass(await transform(result.result)) : (result as Failed<E>)
			)
		);
	}

	/**
	 * The result to come of the next step, given the value; a failure skips it.
	 * @param next Gives the next result, or a promise of one (such as another `AsyncResult`).
	 */
	public andThen<U, F extends DomainError>(
		next: (value: T) => Result<U, F> | PromiseLike<Result<U, F>>
	): AsyncResult<U, E | F> {
		return new AsyncResult(
			this.#promise.then((result): Result<U, E | F> | PromiseLike<Result<U, F>> =>
				result.check() ? next(result.result) : (result as Failed<E>)
			)
		);
	}
}
