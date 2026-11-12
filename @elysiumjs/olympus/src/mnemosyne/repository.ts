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

import type { ModelClass, RepositoryInterface, RowKey } from './interfaces';
import type { CursorPage, OffsetPage, Page, ParsedQuery } from './query';

import Emittery from 'emittery';

import { ElysiumError, Service } from '../index';
import { UnitOfWork } from './unit-of-work';

/**
 * A row as the adapters see it: column values by property name.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type Row = Record<string, unknown>;

/**
 * The storage backends a {@link Repository} can run on, by name: the table type of a backend's
 * models, the connection `this.db` answers, and the scope conditions `list()`, `count()` and
 * {@link Pruner} take. A backend package declares its entry by declaration merging.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * declare module '@elysiumjs/olympus/mnemosyne' {
 * 	interface RepositoryDrivers {
 * 		sqlite: { table: SQLiteTable; connection: SQLiteConnection; scope: SQL };
 * 	}
 * }
 * ```
 */
export interface RepositoryDrivers {}

type DriverOf<TTable> = {
	[K in keyof RepositoryDrivers]: RepositoryDrivers[K] extends {
		table: infer T;
		connection: unknown;
		scope: unknown;
	}
		? TTable extends T
			? RepositoryDrivers[K]
			: never
		: never;
}[keyof RepositoryDrivers];

/**
 * The connection type of the backend of a table type, from {@link RepositoryDrivers}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ConnectionOf<TTable> = [DriverOf<TTable>] extends [never]
	? unknown
	: DriverOf<TTable> extends { connection: infer C }
		? C
		: unknown;

/**
 * The scope condition type of the backend of a table type, from {@link RepositoryDrivers}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ScopeOf<TTable> = [DriverOf<TTable>] extends [never]
	? unknown
	: DriverOf<TTable> extends { scope: infer S }
		? S
		: unknown;

/**
 * What a repository asks its adapter to work on: the table (resolved for the current tenant),
 * the name of the connection, and the property names of the key columns.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RepositoryTarget<TTable = unknown> = {
	table: TTable;
	/** The name of the model, for error messages. */
	model: string;
	/** The name of the connection. */
	connection: string;
	/** The property names of the key columns. */
	key: readonly string[];
};

/**
 * The storage side of a {@link Repository}: one per backend, provided by the model adapter of
 * the backend's models (`ModelAdapter.repository`). Keys arrive as objects of the key column
 * values, already checked against the key columns.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TTable The table type of the backend's models.
 * @template TConnection The connection type `this.db` answers.
 * @template TScope The scope conditions of `list()`, `count()`, `findWhere()` and `deleteWhere()`.
 */
export interface RepositoryAdapter<TTable = any, TConnection = unknown, TScope = unknown> {
	/** The property names of the primary key columns of a table, or none. */
	primaryKey(table: TTable): readonly string[];
	/** The connection of a name, or the transaction open on it. */
	connection(name: string): TConnection;
	/**
	 * Runs an operation on a connection, with what the backend needs around it, such as the
	 * tenant isolation of row-level security.
	 */
	run<T>(name: string, operation: (db: TConnection) => Promise<T>): Promise<T>;
	all(target: RepositoryTarget<TTable>): Promise<Row[]>;
	find(target: RepositoryTarget<TTable>, key: Row): Promise<Row | null>;
	findBy(target: RepositoryTarget<TTable>, column: string, value: unknown): Promise<Row | null>;
	/** The rows meeting a scope, at most `limit` of them. */
	findWhere(target: RepositoryTarget<TTable>, scope: TScope, limit?: number): Promise<Row[]>;
	insert(target: RepositoryTarget<TTable>, data: Row): Promise<Row>;
	update(target: RepositoryTarget<TTable>, key: Row, data: Row): Promise<Row | null>;
	updateAll(target: RepositoryTarget<TTable>, data: Row): Promise<Row[]>;
	delete(target: RepositoryTarget<TTable>, key: Row): Promise<Row | null>;
	/** Deletes the rows of some keys, and answers how many it deleted. */
	deleteMany(target: RepositoryTarget<TTable>, keys: readonly Row[]): Promise<number>;
	deleteAll(target: RepositoryTarget<TTable>): Promise<Row[]>;
	/** Deletes the rows meeting a scope, at most `limit` of them, and answers how many. */
	deleteWhere(target: RepositoryTarget<TTable>, scope: TScope, limit?: number): Promise<number>;
	exists(target: RepositoryTarget<TTable>, key: Row): Promise<boolean>;
	list(target: RepositoryTarget<TTable>, query: ParsedQuery, scope?: TScope): Promise<Page<Row>>;
	count(target: RepositoryTarget<TTable>, query?: ParsedQuery, scope?: TScope): Promise<number>;
}

/**
 * Raised when a repository cannot tell the key of its table, or gets a key that does not match
 * it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class RepositoryKeyError extends ElysiumError {}

/**
 * Raised when a model has no repository adapter: its backend package provides none.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MissingRepositoryAdapterError extends ElysiumError {
	constructor(model: string) {
		super(`The model ${model} has no repository adapter: create it with a backend's model helper.`);
	}
}

/**
 * The events of a repository, with what their listeners receive. A listener of a `-ing` event
 * runs before the write and may change `data`, or refuse the write by returning an error; a
 * listener of a `-ed` event runs after the write, once its unit of work commits.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RepositoryEvents<TSelect, TInsert, TUpdate> = {
	creating: { data: TInsert };
	created: { row: TSelect };
	updating: { key: RowKey; data: TUpdate };
	updated: { row: TSelect };
	deleting: { key: RowKey };
	deleted: { row: TSelect };
};

/** The events that run before a write, and may refuse it. */
type BeforeEvent = 'creating' | 'updating' | 'deleting';

/**
 * A listener of a repository event. The listeners of the `-ing` events may return an error to
 * refuse the write: the repository method throws it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RepositoryListener<TEvents, TName extends keyof TEvents> = (
	payload: TEvents[TName]
) => TName extends BeforeEvent ? void | Error | Promise<void | Error> : void | Promise<void>;

/**
 * The methods a repository observer may have: one per event, each a listener of it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RepositoryObserver<TEvents> = {
	[K in keyof TEvents]?: RepositoryListener<TEvents, K>;
};

/**
 * Options of {@link Repository}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RepositoryOptions<TSelect> = {
	/**
	 * The key columns, by their property names. Defaults to the primary key of the table.
	 */
	key?: readonly (keyof TSelect & string)[];
};

/** Where the errors the `-ing` listeners return are collected, out of their sight. */
const REFUSALS = Symbol('refusals');

type Payload = Record<string, unknown> & { [REFUSALS]?: Error[] };

const emitters = new WeakMap<Function, Emittery<Record<string, Payload>>>();

/** The emitter of a repository class, created on first use. */
const emitterOf = (repository: Function): Emittery<Record<string, Payload>> => {
	let emitter = emitters.get(repository);
	if (!emitter) {
		emitter = new Emittery();
		emitters.set(repository, emitter);
	}
	return emitter;
};

/** Subscribes a listener to an event of a repository class. */
const subscribe = (repository: Function, event: string, listener: Function): (() => void) =>
	emitterOf(repository).on(event, async ({ data }) => {
		const result = await listener(data);
		if (result instanceof Error) (data[REFUSALS] ??= []).push(result);
	});

/**
 * Creates a repository class over a model: CRUD, listing and counting over the model's
 * backend, with events. The backend comes from the model: its model adapter provides the
 * {@link RepositoryAdapter}. Writes join the transaction open on the connection, and the
 * table is resolved for the current tenant on each call.
 *
 * `find`, `update`, `delete` and `exists` take the key of a row: its value, or an object of the
 * values of the key columns when the key spans several. Custom queries use `this.db`, the
 * backend's own connection; they do not fire events.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TModel The model class.
 * @param model The model class.
 * @param options The key columns, when they differ from the table's primary key.
 * @example
 * ```ts
 * @Service.register()
 * export class BookRepository extends Repository(BookModel) {
 * 	public findByAuthor(authorId: string) {
 * 		return this.db.select().from(books).where(eq(books.authorId, authorId));
 * 	}
 * }
 * ```
 */
const createRepository = <TModel extends ModelClass>(
	model: TModel,
	options: RepositoryOptions<TModel['$inferSelect']> = {}
) => {
	type TSelect = TModel['$inferSelect'];
	type TInsert = TModel['$inferInsert'];
	type TUpdate = TModel['$inferUpdate'];
	type TTable = TModel['table'];
	type TKey = RowKey | Partial<TSelect>;
	type TScope = ScopeOf<TTable>;
	type TEvents = RepositoryEvents<TSelect, TInsert, TUpdate>;

	const adapter = (): RepositoryAdapter<TTable, ConnectionOf<TTable>, TScope> => {
		const found = model.adapter?.repository;
		if (!found) throw new MissingRepositoryAdapterError(model.name);
		return found as RepositoryAdapter<TTable, ConnectionOf<TTable>, TScope>;
	};

	let keyColumns: readonly string[] | undefined;
	/** The key columns, read from the table once. */
	const key = (): readonly string[] => {
		keyColumns ??= options.key ?? adapter().primaryKey(model.table);
		return keyColumns;
	};

	/** The key of a row as an object of the key column values, checked against the columns. */
	const keyValues = (id: TKey): Row => {
		const columns = key();
		if (columns.length === 0) {
			throw new RepositoryKeyError(
				`The table of ${model.name} has no primary key: declare one, or pass \`key\` to Repository().`
			);
		}
		if (typeof id !== 'object' || id === null) {
			if (columns.length > 1) {
				throw new RepositoryKeyError(
					`The primary key of ${model.name} spans ${columns.join(', ')}: pass an object of their values.`
				);
			}
			return { [columns[0]!]: id };
		}
		const values = id as Row;
		const missing = columns.filter((column) => values[column] === undefined);
		if (missing.length > 0) {
			throw new RepositoryKeyError(`The key of ${model.name} misses ${missing.join(', ')}.`);
		}
		return Object.fromEntries(columns.map((column) => [column, values[column]]));
	};

	/** The connection name of a repository instance. */
	const connectionOf = (repository: object): string =>
		(repository.constructor as unknown as { connection: string }).connection;

	/** What the adapter works on, with the table resolved for the current tenant. */
	const targetOf = (repository: object): RepositoryTarget<TTable> => ({
		table: model.table,
		model: model.name,
		connection: connectionOf(repository),
		key: key()
	});

	/** Runs the listeners of a `-ing` event, and throws the first error one returned. */
	const before = async (repository: object, event: BeforeEvent, payload: Row): Promise<void> => {
		const emitter = emitters.get(repository.constructor);
		if (!emitter || emitter.listenerCount(event) === 0) return;
		const data: Payload = { ...payload };
		await emitter.emit(event, data);
		if (data[REFUSALS]?.length) throw data[REFUSALS][0];
	};

	/** Runs the listeners of a `-ed` event, after the unit of work commits by default. */
	const after = async (
		repository: object,
		event: 'created' | 'updated' | 'deleted',
		row: unknown
	): Promise<void> => {
		const emitter = emitters.get(repository.constructor);
		if (!emitter || emitter.listenerCount(event) === 0) return;
		const emit = () => emitter.emit(event, { row });
		if ((repository.constructor as unknown as { afterCommit: boolean }).afterCommit) {
			await UnitOfWork.afterCommit(emit);
		} else await emit();
	};

	abstract class R implements RepositoryInterface<TSelect, TInsert, TUpdate, TKey> {
		/**
		 * The model class wrapped by this repository.
		 */
		public static readonly Model: TModel = model;

		/**
		 * The database connection name to use. Override it to use another connection.
		 */
		public static readonly connection: string = 'default';

		/**
		 * Whether the `created`, `updated` and `deleted` events wait for the unit of work to
		 * commit. Override it with `false` to run them right after the write.
		 */
		public static readonly afterCommit: boolean = true;

		/**
		 * Subscribes a listener to an event of this repository class.
		 * @author Axel Nana <ax.lnana@outlook.com>
		 * @param event The event.
		 * @param listener The listener. A `-ing` listener may return an error to refuse the write.
		 * @returns A function that unsubscribes the listener.
		 * @example
		 * ```ts
		 * BookRepository.on('creating', ({ data }) => {
		 * 	if (!data.title.trim()) return new InvalidTitleError();
		 * 	data.slug = slugify(data.title);
		 * });
		 * ```
		 */
		public static on<TName extends keyof TEvents>(
			this: Function,
			event: TName,
			listener: RepositoryListener<TEvents, TName>
		): () => void {
			return subscribe(this, event as string, listener);
		}

		/**
		 * The connection of this repository: the backend's own client, or the transaction open on
		 * it. Use it for custom queries; they do not fire events.
		 */
		public get db(): ConnectionOf<TTable> {
			return adapter().connection(connectionOf(this));
		}

		/**
		 * Runs an operation on the connection of this repository, with what the backend needs
		 * around it, such as the tenant isolation of row-level security. Custom queries that must
		 * honour that isolation go through it.
		 * @param operation The operation, given the connection.
		 */
		public withConnection<T>(operation: (db: ConnectionOf<TTable>) => Promise<T>): Promise<T> {
			return adapter().run(connectionOf(this), operation);
		}

		/** Retrieves every row. */
		public async all(): Promise<TSelect[]> {
			return (await adapter().all(targetOf(this))) as TSelect[];
		}

		/**
		 * Retrieves a row by its key.
		 * @param id The key: its value, or an object of the key column values.
		 * @returns The row, or `null` when none has that key.
		 */
		public async find(id: TKey): Promise<TSelect | null> {
			return (await adapter().find(targetOf(this), keyValues(id))) as TSelect | null;
		}

		/**
		 * Finds the first row whose column has a value.
		 * @param column The column.
		 * @param value The value.
		 * @returns The row, or `null` when none matches.
		 */
		public async findBy<TColumn extends keyof TSelect>(
			column: TColumn,
			value: TSelect[TColumn]
		): Promise<TSelect | null> {
			return (await adapter().findBy(targetOf(this), column as string, value)) as TSelect | null;
		}

		/**
		 * Inserts a row. The `creating` listeners run first and may change the data or refuse the
		 * write; the `created` listeners run once the unit of work commits.
		 * @param data The data.
		 * @returns The inserted row.
		 */
		public async insert(data: TInsert): Promise<TSelect> {
			const payload = { data: { ...(data as Row) } };
			await before(this, 'creating', payload);
			const row = (await adapter().insert(targetOf(this), payload.data)) as TSelect;
			await after(this, 'created', row);
			return row;
		}

		/**
		 * Updates a row. The `updating` listeners run first and may change the data or refuse the
		 * write; the `updated` listeners run once the unit of work commits.
		 * @param id The key.
		 * @param data The changes.
		 * @returns The updated row, or `null` when none has that key.
		 */
		public async update(id: TKey, data: TUpdate): Promise<TSelect | null> {
			const values = keyValues(id);
			const payload = { key: id, data: { ...(data as Row) } };
			await before(this, 'updating', payload);
			const row = (await adapter().update(targetOf(this), values, payload.data)) as TSelect | null;
			if (row) await after(this, 'updated', row);
			return row;
		}

		/**
		 * Updates every row, without events.
		 * @param data The changes.
		 * @returns The updated rows.
		 */
		public async updateAll(data: TUpdate): Promise<TSelect[]> {
			return (await adapter().updateAll(targetOf(this), data as Row)) as TSelect[];
		}

		/**
		 * Deletes a row. The `deleting` listeners run first and may refuse the write; the
		 * `deleted` listeners run once the unit of work commits.
		 * @param id The key.
		 * @returns The deleted row, or `null` when none has that key.
		 */
		public async delete(id: TKey): Promise<TSelect | null> {
			const values = keyValues(id);
			await before(this, 'deleting', { key: id });
			const row = (await adapter().delete(targetOf(this), values)) as TSelect | null;
			if (row) await after(this, 'deleted', row);
			return row;
		}

		/**
		 * Deletes every row, without events.
		 * @returns The deleted rows.
		 */
		public async deleteAll(): Promise<TSelect[]> {
			return (await adapter().deleteAll(targetOf(this))) as TSelect[];
		}

		/**
		 * Deletes the rows meeting a scope, without events.
		 * @param scope The condition, in the backend's terms (an SQL condition with Drizzle).
		 * @param limit The most rows to delete.
		 * @returns How many rows were deleted.
		 */
		public deleteWhere(scope: TScope, limit?: number): Promise<number> {
			return adapter().deleteWhere(targetOf(this), scope, limit);
		}

		/**
		 * Whether a row has a key.
		 * @param id The key.
		 */
		public exists(id: TKey): Promise<boolean> {
			return adapter().exists(targetOf(this), keyValues(id));
		}

		/**
		 * Lists a page of rows matching a parsed query (see `Listing.parse`): its filters, its sort
		 * and its page. With offset pagination, the page tells the total of the rows matching the
		 * filters.
		 * @param query The parsed query.
		 * @param scope A condition the rows must also meet, such as their owner, in the backend's
		 * terms.
		 * @returns The rows of the page and the cursor of the next one, or the page and the total.
		 */
		public async list(query: ParsedQuery<'offset'>, scope?: TScope): Promise<OffsetPage<TSelect>>;
		public async list(query: ParsedQuery<'cursor'>, scope?: TScope): Promise<CursorPage<TSelect>>;
		public async list(query: ParsedQuery, scope?: TScope): Promise<Page<TSelect>>;
		public async list(query: ParsedQuery, scope?: TScope): Promise<Page<TSelect>> {
			return (await adapter().list(targetOf(this), query, scope)) as Page<TSelect>;
		}

		/**
		 * Counts the rows matching the filters of a parsed query, ignoring its cursor.
		 * @param query The parsed query.
		 * @param scope A condition the rows must also meet, as for `list()`.
		 */
		public count(query?: ParsedQuery, scope?: TScope): Promise<number> {
			return adapter().count(targetOf(this), query, scope);
		}
	}

	return R;
};

const observerInstances = new WeakMap<Function, unknown>();

/** The observer instance: resolved from the container when registered there, else built once. */
const observerOf = async (observer: new () => object): Promise<Record<string, Function>> => {
	if (Service.exists(observer))
		return Service.resolve(observer) as Promise<Record<string, Function>>;
	let instance = observerInstances.get(observer);
	if (!instance) {
		instance = new observer();
		observerInstances.set(observer, instance);
	}
	return instance as Record<string, Function>;
};

const EVENTS = ['creating', 'created', 'updating', 'updated', 'deleting', 'deleted'] as const;

/**
 * Marks a class as an observer of a repository: each of its methods named after an event
 * (`creating`, `created`, `updating`, `updated`, `deleting`, `deleted`) listens to it. The
 * observer is resolved from the container when it is registered there, so it can inject
 * services.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param repository The repository class.
 * @example
 * ```ts
 * @Repository.observer(OrderRepository)
 * export class OrderObserver {
 * 	public creating({ data }: { data: NewOrder }) {
 * 		if (data.total <= 0) return new EmptyOrderError();
 * 	}
 *
 * 	public async created({ row }: { row: Order }) {
 * 		await Heracles.dispatch(SendOrderConfirmation, [row.id]);
 * 	}
 * }
 * ```
 */
const observer =
	<TRepository extends { on(event: never, listener: never): () => void }>(
		repository: TRepository
	) =>
	<TObserver extends new () => object>(target: TObserver): void => {
		for (const event of EVENTS) {
			if (typeof (target.prototype as Record<string, unknown>)[event] !== 'function') continue;
			subscribe(repository as unknown as Function, event, async (payload: unknown) => {
				const instance = await observerOf(target);
				return instance[event]!.call(instance, payload);
			});
		}
	};

/**
 * Creates a repository class over a model (see {@link createRepository}), and holds
 * `Repository.observer()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const Repository = Object.assign(createRepository, { observer });
