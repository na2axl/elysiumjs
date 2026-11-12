// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import {
	Application,
	DATABASE_TRANSACTION_SERVICE,
	DomainError,
	getLogger,
	Service
} from '../index';

/** A callback run once the unit of work has committed or rolled back. */
type Hook = () => unknown | Promise<unknown>;

/** The outermost unit of work of an async context, which collects the hooks. */
type Frame = { afterCommit: Hook[]; afterRollback: Hook[] };

const FRAME = 'uow:frame';

/** Carries a returned DomainError through the transaction, so that it rolls back. */
class Refusal {
	constructor(public readonly error: DomainError) {}
}

/** Runs a callback in a database transaction, joining the one open on the connection. */
export type TransactionRunner = <T>(callback: () => Promise<T>, connection?: string) => Promise<T>;

const currentFrame = (): Frame | undefined =>
	Application.context.getStore()?.get(FRAME) as Frame | undefined;

const runHooks = async (hooks: Hook[], phase: string): Promise<void> => {
	for (const hook of hooks) {
		try {
			await hook();
		} catch (error) {
			getLogger().error(`A unit of work ${phase} hook failed`, { error });
		}
	}
};

/**
 * Wraps a driver's transaction function into the runner of units of work: the outermost run
 * collects the `afterCommit` and `afterRollback` hooks of everything it calls, and runs them once
 * it has committed or rolled back. Inner runs join it. Driver modules register the result as the
 * `db.transaction` service, which `transactional` routes and {@link UnitOfWork.run} use.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param transaction Runs a callback in a transaction, joining an open one.
 */
export const withUnitOfWork =
	(transaction: TransactionRunner): TransactionRunner =>
	async <T>(callback: () => Promise<T>, connection?: string): Promise<T> => {
		if (currentFrame()) return transaction(callback, connection);

		const frame: Frame = { afterCommit: [], afterRollback: [] };
		const store = new Map(Application.context.getStore());
		store.set(FRAME, frame);
		let result: T;
		try {
			result = await Application.context.run(store, () =>
				transaction(async () => {
					const value = await callback();
					// A returned DomainError refuses the work: it rolls back like a thrown one.
					if (value instanceof DomainError) throw new Refusal(value);
					return value;
				}, connection)
			);
		} catch (error) {
			await runHooks(frame.afterRollback, 'afterRollback');
			if (error instanceof Refusal) return error.error as T;
			throw error;
		}
		await runHooks(frame.afterCommit, 'afterCommit');
		return result;
	};

export namespace UnitOfWork {
	/**
	 * Runs a callback in a unit of work: one transaction on the connection that every repository
	 * call made from the callback uses. When a unit of work is already open, the callback joins
	 * it, so services compose without knowing which of them opened it.
	 *
	 * A callback that returns a `DomainError` rolls the work back, like one that throws, and the
	 * error is returned. A joined callback hands it to the one that opened the unit of work, which
	 * rolls back when it returns it too.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param callback The work to run.
	 * @param options The connection of the transaction. Defaults to `default`.
	 * @throws {Error} When no database module provides the `db.transaction` service.
	 */
	export const run = <T>(
		callback: () => Promise<T>,
		options: { connection?: string } = {}
	): Promise<T> => {
		const runner = Service.get<TransactionRunner>(DATABASE_TRANSACTION_SERVICE);
		if (!runner) {
			throw new Error(
				`Units of work need the "${DATABASE_TRANSACTION_SERVICE}" service. ` +
					'Import a database module (such as DrizzleModule) in the application.'
			);
		}
		return runner(callback, options.connection);
	};

	/** Whether a unit of work is open in the current async context. */
	export const active = (): boolean => currentFrame() !== undefined;

	/**
	 * Runs a callback once the current unit of work has committed, such as publishing the events
	 * of an outbox. Outside a unit of work, it runs right away. A failing hook is logged.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param hook The callback.
	 */
	export const afterCommit = async (hook: Hook): Promise<void> => {
		const frame = currentFrame();
		if (frame) frame.afterCommit.push(hook);
		else await runHooks([hook], 'afterCommit');
	};

	/**
	 * Runs a callback if the current unit of work rolls back, such as deleting an uploaded file.
	 * Outside a unit of work, it never runs.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param hook The callback.
	 */
	export const afterRollback = (hook: Hook): void => {
		currentFrame()?.afterRollback.push(hook);
	};
}

/**
 * Runs a method in a unit of work (see {@link UnitOfWork.run}): a new transaction, or the one
 * already open. A method that returns a `DomainError` rolls back.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param options The connection of the transaction. Defaults to `default`.
 * @example
 * ```ts
 * @Service.register()
 * class TransferService {
 *   @Transactional()
 *   public async transfer(from: string, to: string, amount: number) {
 *     await this.accounts.debit(from, amount);
 *     await this.accounts.credit(to, amount);
 *   }
 * }
 * ```
 */
export const Transactional =
	(options: { connection?: string } = {}): MethodDecorator =>
	(_target, _key, descriptor) => {
		const method = descriptor.value as unknown as (...args: unknown[]) => Promise<unknown>;
		descriptor.value = function (this: unknown, ...args: unknown[]) {
			return UnitOfWork.run(() => method.apply(this, args), options);
		} as typeof descriptor.value;
		return descriptor;
	};
