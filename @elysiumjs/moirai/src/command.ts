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

import { DATABASE_TRANSACTION_SERVICE, DomainError, Metadata, Service } from '@elysiumjs/core';
import { UnitOfWork } from '@elysiumjs/mnemosyne';
import Value from 'typebox/value';

import { commandLock, idempotencyStore, options } from './config';
import {
	CommandForbiddenError,
	IdempotencyKeyRequiredError,
	IdempotencyKeyReusedError,
	InvalidInputError
} from './errors';
import { requestHash } from './hash';

const COMMAND = Symbol.for('elysium:moirai:command');
const QUERY = Symbol.for('elysium:moirai:query');
type EffectHandler = (payload: unknown, row: unknown) => unknown;
const EFFECTS = new Map<string, EffectHandler>();

/**
 * What a command or a query handler receives besides its input.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HandlerContext = {
	/** The name of the command or the query. */
	name: string;
	/** The idempotency key of the call, if any. */
	idempotencyKey?: string;
	/** The attempt, from 1, when the command retries after a transient error. */
	attempt: number;
};

/**
 * A command or a query: a class whose `handle()` gets the validated input. Returning or throwing a
 * `DomainError` refuses the call.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface Handler<TInput = any, TResult = any> {
	handle(
		input: TInput,
		context: HandlerContext
	): Promise<TResult | DomainError> | TResult | DomainError;
}

export type HandlerClass<TInput = any, TResult = any> = new (
	...args: any[]
) => Handler<TInput, TResult>;

type InputOf<C extends HandlerClass> = Parameters<InstanceType<C>['handle']>[0];
type ResultOf<C extends HandlerClass> = Exclude<
	Awaited<ReturnType<InstanceType<C>['handle']>>,
	DomainError
>;

/**
 * The options of a command.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type CommandOptions<S extends TSchema = TSchema> = {
	/** The name of the command, in idempotency records and problems. Defaults to the class name. */
	name?: string;
	/** The schema of the input. */
	input: S;
	/**
	 * Whether a call needs an idempotency key. A repeat with the same key and input replays the
	 * stored response; with another input, it is refused with a 422 problem. Defaults to `false`.
	 */
	idempotent?: boolean;
	/** Whether the command runs in a unit of work, or joins the open one. Defaults to `true`. */
	transactional?: boolean;
	/** The database connection of the unit of work. Defaults to `default`. */
	connection?: string;
	/**
	 * Serializes the calls that give the same key, so that a double tap waits for the first call
	 * and replays it instead of racing it. Needs a `lock` store.
	 */
	serializeBy?: (input: Static<S>) => string;
	/** Whether a transient failure retries in a new unit of work. Defaults to `true`. */
	retry?: boolean;
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

export namespace Moirai {
	/**
	 * Marks a class as a command: a write, validated, run in a unit of work, retried on transient
	 * failures, and idempotent when asked. Run it with {@link Commands.execute}.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The options of the command.
	 * @example
	 * ```ts
	 * @Moirai.command({ input: t.Object({ amount: t.Integer({ minimum: 1 }) }), idempotent: true })
	 * class TopUpCommand {
	 * 	constructor(@Service.inject() private readonly wallets: WalletRepository) {}
	 *
	 * 	public async handle(input: { amount: number }) {
	 * 		const wallet = await this.wallets.credit(input.amount);
	 * 		await Outbox.enqueue({ kind: 'wallet.credited', payload: { id: wallet.id } });
	 * 		return { balance: wallet.balance };
	 * 	}
	 * }
	 * ```
	 */
	export const command =
		<S extends TSchema>(props: CommandOptions<S>) =>
		(target: HandlerClass): void => {
			Metadata.define(COMMAND, { ...props, name: props.name ?? target.name }, target);
		};

	/**
	 * Marks a class as a query: a read, validated and run without a transaction. Run it with
	 * {@link Queries.ask}.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The options of the query.
	 */
	export const query =
		<S extends TSchema>(props: QueryOptions<S>) =>
		(target: HandlerClass): void => {
			Metadata.define(QUERY, { ...props, name: props.name ?? target.name }, target);
		};

	/**
	 * Marks a service method as the handler of the outbox rows of a kind. The method gets the
	 * payload and the row; throwing retries the row later.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param kind The kind of effect.
	 */
	export const effect =
		(kind: string): MethodDecorator =>
		(target, method) => {
			EFFECTS.set(kind, (payload, row) => {
				const instance = instanceOf(target.constructor as HandlerClass) as unknown as Record<
					string | symbol,
					EffectHandler
				>;
				return instance[method]!(payload, row);
			});
		};
}

/** The handler of a kind of effect, if any. */
export const effectHandler = (kind: string): EffectHandler | undefined => EFFECTS.get(kind);

/**
 * Registers the handler of a kind of effect with a function, for packages that ship effects.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param kind The kind of effect.
 * @param handler Gets the payload and the row; throwing retries the row later.
 */
export const registerEffect = (kind: string, handler: EffectHandler): void => {
	EFFECTS.set(kind, handler);
};

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
				detail: error.message
			}))
		);
	}
	return value;
};

/** The result, or the DomainError it is thrown as. */
const unwrap = <T>(result: T | DomainError): T => {
	if (result instanceof DomainError) throw result;
	return result;
};

export namespace Commands {
	/**
	 * Runs a command: validates the input, checks `authorize`, then runs the handler in a unit of
	 * work (or joins the open one), retrying transient failures, and replaying the stored response
	 * of an idempotent command called again with the same key.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param command The command class.
	 * @param input The raw input.
	 * @param call The idempotency key of the call.
	 * @throws {InvalidInputError} When the input does not match the schema (400).
	 * @throws {CommandForbiddenError} When `authorize` refuses the call (403).
	 * @throws {IdempotencyKeyRequiredError} When an idempotent command gets no key (428).
	 * @throws {IdempotencyKeyReusedError} When the key was used for another request (422).
	 * @throws {DomainError} When the handler refuses the call.
	 */
	export const execute = async <C extends HandlerClass>(
		command: C,
		input: InputOf<C>,
		call: { idempotencyKey?: string } = {}
	): Promise<ResultOf<C>> => {
		const props = Metadata.get(COMMAND, command) as (CommandOptions & { name: string }) | undefined;
		if (!props) throw new TypeError(`${command.name} is not marked with @Moirai.command().`);
		const { name, idempotent = false, transactional = true, retry = true } = props;
		const config = options();

		const value = validate(props.input, input, name);
		if (props.authorize && !(await props.authorize(value))) throw new CommandForbiddenError(name);
		const key = call.idempotencyKey;
		if (idempotent && !key) throw new IdempotencyKeyRequiredError(name);

		const body = async (attempt: number): Promise<ResultOf<C>> => {
			const release = props.serializeBy
				? await commandLock().lock(props.serializeBy(value))
				: undefined;
			try {
				const handler = instanceOf(command);
				const context: HandlerContext = { name, idempotencyKey: key, attempt };
				if (!idempotent) return unwrap(await handler.handle(value, context)) as ResultOf<C>;

				const store = idempotencyStore();
				const hash = await requestHash(value);
				const seen = await store.get(key!);
				if (seen) {
					if (seen.command === name && seen.requestHash === hash)
						return seen.response as ResultOf<C>;
					throw new IdempotencyKeyReusedError(key!);
				}
				const response = unwrap(await handler.handle(value, context)) as ResultOf<C>;
				await store.put({
					key: key!,
					command: name,
					requestHash: hash,
					response: response === undefined ? null : structuredClone(response),
					createdAt: new Date()
				});
				return response;
			} finally {
				release?.();
			}
		};

		const transaction = transactional && Service.exists(DATABASE_TRANSACTION_SERVICE);
		// A command that joins an open unit of work leaves the retries to whoever opened it.
		if (transaction && UnitOfWork.active()) return body(1);

		for (let attempt = 1; ; attempt++) {
			try {
				return transaction
					? await UnitOfWork.run(() => body(attempt), { connection: props.connection })
					: await body(attempt);
			} catch (error) {
				const again = retry && attempt < config.maxAttempts && config.isTransient(error);
				if (!again) throw error;
			}
		}
	};
}

export namespace Queries {
	/**
	 * Runs a query: validates the input, checks `authorize`, and runs the handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param query The query class.
	 * @param input The raw input.
	 * @throws {InvalidInputError} When the input does not match the schema (400).
	 * @throws {CommandForbiddenError} When `authorize` refuses the call (403).
	 * @throws {DomainError} When the handler refuses the call.
	 */
	export const ask = async <C extends HandlerClass>(
		query: C,
		input: InputOf<C>
	): Promise<ResultOf<C>> => {
		const props = Metadata.get(QUERY, query) as (QueryOptions & { name: string }) | undefined;
		if (!props) throw new TypeError(`${query.name} is not marked with @Moirai.query().`);
		const value = validate(props.input, input, props.name);
		if (props.authorize && !(await props.authorize(value)))
			throw new CommandForbiddenError(props.name);
		return unwrap(
			await instanceOf(query).handle(value, { name: props.name, attempt: 1 })
		) as ResultOf<C>;
	};
}
