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

import type { TSchema } from '../index';
import type { ColumnMetadata, ModelAdapter, ModelClass } from './interfaces';

import { t } from 'elysia';

import { Application, ElysiumError, Serializer } from '../index';
import { getCurrentTenant, getTenancyStrategy } from './tenancy';

/** Marks the prototype of the model classes, so that their instances are told apart. */
const MODEL = Symbol.for('elysium:mnemosyne:model');

/**
 * Thrown when two model classes have the same `modelName`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DuplicateModelError extends ElysiumError {
	constructor(
		public readonly model: string,
		first?: string,
		second?: string
	) {
		const classes = first && second ? ` (${first} and ${second})` : '';
		super(
			`Two model classes are named "${model}"${classes}: give one of them another ` +
				'`static modelName`. A subclass of a model inherits its name.'
		);
	}
}

/**
 * Thrown when a written model instance was written with another digest of the model's columns,
 * such as an instance cached before a deploy that changed its table. Caches read it as a miss.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class StaleModelError extends ElysiumError {
	constructor(public readonly model: string) {
		super(
			`An instance of the model "${model}" was written with other columns than the model has now.`
		);
	}
}

/**
 * Thrown when a written model instance names a model that is not registered.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnknownModelError extends ElysiumError {
	constructor(public readonly model: string) {
		super(
			`No model is registered with the name "${model}": import its repository, or register ` +
				'the model with Models.register().'
		);
	}
}

/** A short, stable digest of a text (32-bit FNV-1a, in hexadecimal). */
const hashOf = (text: string): string => {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
};

/** The registered model classes, by their `modelName`, shared by every copy of the package. */
const registry: Map<string, ModelClass> = ((globalThis as Record<symbol, unknown>)[
	Symbol.for('elysium:mnemosyne:models')
] ??= new Map<string, ModelClass>()) as Map<string, ModelClass>;

/**
 * Writes column values on an instance as its own properties. Own properties shadow the getters
 * of the class, and a `__proto__` key stays a plain property instead of changing the prototype.
 */
const assign = (instance: object, attributes: Record<string, unknown>): void => {
	for (const key of Object.keys(attributes)) {
		Object.defineProperty(instance, key, {
			value: attributes[key],
			enumerable: true,
			writable: true,
			configurable: true
		});
	}
};

/**
 * The model classes known by name, so that their instances can be read back from JSON: from
 * the cache, or from the input of a queued job. A model is registered when a repository is
 * created over it, when it hydrates rows, and when one of its instances is written.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export namespace Models {
	/**
	 * Registers a model class under its `modelName`. Registering the same class again does
	 * nothing.
	 * @param model The model class.
	 * @throws {DuplicateModelError} When another class has the name.
	 */
	export const register = <TModel extends ModelClass>(model: TModel): TModel => {
		const existing = registry.get(model.modelName);
		if (existing === model) return model;
		// The same class evaluated again, such as on a reload, replaces the former one.
		if (existing && (existing.name !== model.name || existing.tableName !== model.tableName)) {
			throw new DuplicateModelError(model.modelName, existing.name, model.name);
		}
		registry.set(model.modelName, model);
		return model;
	};

	/**
	 * Forgets the model class registered under a name.
	 * @param name The model name.
	 */
	export const unregister = (name: string): void => {
		registry.delete(name);
	};

	/** Forgets every registered model class, such as between tests. */
	export const clear = (): void => {
		registry.clear();
	};

	/** The model class registered under a name, if any. */
	export const find = (name: string): ModelClass | undefined => registry.get(name);

	/** Whether a value is an instance of a model class. */
	export const isInstance = (value: unknown): value is object =>
		typeof value === 'object' && value !== null && (value as { [MODEL]?: boolean })[MODEL] === true;

	/**
	 * The column values of a model instance, without its getters.
	 * @param instance The model instance.
	 */
	export const attributes = (instance: object): Record<string, unknown> => ({ ...instance });
}

/**
 * Writes model instances as their model name and column values, read back as instances of the
 * same class. The column values are written with `Json` again, so dates and the values of other
 * serializers survive.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Serializer.register({ name: 'model' })
export class ModelSerializer extends Serializer<
	object,
	{ model: string; hash?: string; attributes: Record<string, unknown> }
> {
	public supports(value: unknown): boolean {
		return Models.isInstance(value);
	}

	public serialize(instance: object) {
		const model = Models.register(instance.constructor as ModelClass);
		return {
			model: model.modelName,
			hash: model.schemaHash,
			attributes: Models.attributes(instance)
		};
	}

	public deserialize(value: { model: string; hash?: string; attributes: Record<string, unknown> }) {
		const model = Models.find(value.model);
		if (!model) throw new UnknownModelError(value.model);
		if (value.hash !== undefined && value.hash !== model.schemaHash) {
			throw new StaleModelError(value.model);
		}
		return model.hydrate(value.attributes) as object;
	}
}

/**
 * Creates a validation schema from normalized column metadata.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param columns The column metadata to create the schema from.
 * @param options The schema generation options.
 * @returns A validation schema based on the given columns.
 */
export const createSchemaFromModel = (
	columns: ColumnMetadata[],
	{ mode = 'select' }: { mode?: 'create' | 'update' | 'select' } = {}
) => {
	if (columns === undefined || columns.length === 0) return t.Object({});

	const properties: { [key: string]: TSchema } = {};

	for (const column of columns) {
		if (['create', 'update'].includes(mode) && column.isPrimaryKey) {
			continue;
		}

		properties[column.name] = parseColumnType(column);

		if (column.nullable) {
			properties[column.name] = t.Nullable(properties[column.name]);
		}

		if (mode === 'update' || column.hasDefault || column.nullable) {
			properties[column.name] = t.Optional(properties[column.name]);
		}
	}

	return t.Object(properties);
};

/**
 * Creates a validation schema from a column's metadata.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param column The column metadata.
 * @returns A validation schema based on the given column.
 */
const parseColumnType = (column: ColumnMetadata) => {
	switch (column.dataType) {
		case 'string':
			return t.String();
		case 'uuid':
			return t.String({ format: 'uuid' });
		case 'number':
			return t.Number();
		case 'boolean':
			return t.Boolean();
		case 'array':
			return t.Array(t.Any());
		case 'json':
			return t.Object({});
		case 'date':
			return t
				.Codec(t.String({ format: 'date' }))
				.Decode((date: string) => new Date(date))
				.Encode((date: Date) => date.toISOString());
		case 'datetime':
			return t
				.Codec(t.String({ format: 'date-time' }))
				.Decode((date: string) => new Date(date))
				.Encode((date: Date) => date.toISOString());
		case 'bigint':
			return t.BigInt();
		case 'buffer':
			return t.File();
		default:
			return t.Never();
	}
};

/**
 * Mixin used to create a new abstract model class.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TTable The ORM-specific table type.
 * @template TColumns The table columns configuration type.
 * @param tableName The name of the table.
 * @param columns The table columns configuration.
 * @param adapter The model adapter for the ORM.
 * @param baseTable The base ORM table instance.
 */
export const AbstractModel = <TTable, TColumns extends Record<string, unknown>>(
	tableName: string,
	columns: TColumns,
	adapter: ModelAdapter<TTable>,
	baseTable: TTable
) => {
	const columnMetadata = adapter.getColumns(baseTable);

	class M {
		/**
		 * Creates an instance holding the column values of a row. Repositories create them with
		 * {@link M.hydrate}.
		 * @param attributes The column values.
		 */
		public constructor(attributes?: Record<string, unknown>) {
			if (attributes) assign(this, attributes);
		}

		/**
		 * The name the model is known by in cached values and queued jobs: unique, and stable
		 * across deploys. Defaults to the name the backend gives the table, such as the table
		 * name with its schema. Override it when two models share a table, and in a subclass of
		 * a model, which inherits it.
		 */
		public static readonly modelName: string = adapter.getModelName?.(baseTable) ?? tableName;

		/**
		 * A digest of the table's columns, part of the keys of cached rows, so that a change of
		 * the columns never reads back rows cached before it.
		 */
		public static readonly schemaHash: string = hashOf(
			JSON.stringify({ tableName, columns: columnMetadata })
		);

		/**
		 * The columns left out of {@link M.toJSON}, and hidden by `ModelResource()`.
		 */
		public static readonly hidden: readonly string[] = [];

		/**
		 * The getters written by {@link M.toJSON} besides the columns, and exposed by
		 * `ModelResource()`.
		 */
		public static readonly appends: readonly string[] = [];

		/**
		 * Creates instances of the model from rows: one row, a list of rows, or `null`.
		 * @param row The row, the rows, or `null`.
		 */
		public static hydrate<T extends new (...args: any[]) => any>(
			this: T,
			row: Record<string, unknown>
		): InstanceType<T>;
		public static hydrate<T extends new (...args: any[]) => any>(
			this: T,
			row: Record<string, unknown> | null
		): InstanceType<T> | null;
		public static hydrate<T extends new (...args: any[]) => any>(
			this: T,
			rows: readonly Record<string, unknown>[]
		): InstanceType<T>[];
		public static hydrate(
			this: new (attributes?: Record<string, unknown>) => object,
			row: Record<string, unknown> | readonly Record<string, unknown>[] | null
		): unknown {
			Models.register(this as unknown as ModelClass);
			if (row === null || row === undefined) return null;
			// Built first and filled after, so that the class fields of a subclass do not reset
			// the columns: a column a subclass names again is declared with `declare`.
			const make = (item: Record<string, unknown>) => {
				if (item instanceof this) return item;
				const instance = new this();
				assign(instance, item);
				return instance;
			};
			if (Array.isArray(row)) return row.map(make);
			return make(row as Record<string, unknown>);
		}

		/**
		 * The JSON form of the instance: its columns and the getters in `appends`, without the
		 * columns in `hidden`.
		 */
		public toJSON(): Record<string, unknown> {
			const model = this.constructor as unknown as {
				hidden: readonly string[];
				appends: readonly string[];
			};
			const hidden = new Set(model.hidden);
			const json: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(this)) {
				if (!hidden.has(key)) json[key] = value;
			}
			for (const name of model.appends) {
				if (!hidden.has(name)) json[name] = (this as Record<string, unknown>)[name];
			}
			return json;
		}

		/**
		 * The data type returned by the select queries.
		 */
		public static readonly $inferSelect: unknown = undefined;

		/**
		 * The data type needed by the insert queries.
		 */
		public static readonly $inferInsert: unknown = undefined;

		/**
		 * The data type needed by the update queries.
		 */
		public static readonly $inferUpdate: unknown = undefined;

		/**
		 * The ORM-specific table schema wrapped by this model.
		 * Will be automatically resolved to a tenant-scoped table when tenancy is active.
		 */
		public static get table(): TTable {
			// If we are not inside an Application context, we can't use the tenancy system
			if (!Application.instance || !Application.context.getStore) {
				return baseTable;
			}

			if (this.supportTenancy) {
				const tenant = getCurrentTenant() ?? 'public';
				if (tenant !== 'public') {
					const strategy = getTenancyStrategy();
					if (strategy) {
						return strategy.resolveTable(baseTable, tenant) as TTable;
					}
					return adapter.createTenantTable(baseTable, tenant);
				}
			}

			return baseTable;
		}

		/**
		 * The name of the table wrapped by the model.
		 */
		public static readonly tableName: string = tableName;

		/**
		 * The table columns configuration.
		 */
		public static readonly columns: TColumns = columns;

		/**
		 * The validation schema for creating records.
		 */
		public static readonly insertSchema = createSchemaFromModel(columnMetadata, { mode: 'create' });

		/**
		 * The validation schema for updating records.
		 */
		public static readonly updateSchema = createSchemaFromModel(columnMetadata, { mode: 'update' });

		/**
		 * The validation schema for selecting records.
		 */
		public static readonly selectSchema = createSchemaFromModel(columnMetadata, { mode: 'select' });

		/**
		 * Whether the model supports tenancy.
		 *
		 * Set it to `true` if the model supports tenancy. This means that the model will be
		 * wrapped by the tenancy strategy when the current tenant is not `public`.
		 */
		public static readonly supportTenancy: boolean = false;

		/**
		 * The model adapter of the model's backend, whose repository adapter serves
		 * `Repository(Model)`.
		 */
		public static readonly adapter: ModelAdapter<TTable> = adapter;
	}

	Object.defineProperty(M.prototype, MODEL, { value: true });

	return M;
};

/**
 * An instance of a model: its column values, and a `toJSON()` typed as them, so that the routes
 * answering instances are typed by their columns for clients. The getters in `appends` and the
 * columns in `hidden` change the JSON at run time only: a response schema types a response
 * precisely.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ModelInstance<TInstance, TSelect> = Omit<TInstance, 'toJSON'> &
	TSelect & { toJSON(): TSelect };

/**
 * The type of a model class made by a backend's model helper: the statics of the base class, and
 * instances holding the column values of a row, typed as the select type.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TBase The class made by {@link AbstractModel}.
 * @template TSelect The type returned by select queries.
 * @template TInsert The type needed by insert queries.
 * @template TUpdate The type needed by update queries.
 * @template TTable The table type.
 */
export type TypedModel<
	TBase extends new (...args: any[]) => any,
	TSelect,
	TInsert,
	TUpdate,
	TTable
> = Omit<
	TBase,
	'prototype' | '$inferSelect' | '$inferInsert' | '$inferUpdate' | 'table' | 'hidden'
> & {
	new (attributes?: Partial<TSelect>): ModelInstance<InstanceType<TBase>, TSelect>;
	readonly prototype: ModelInstance<InstanceType<TBase>, TSelect>;
	readonly $inferSelect: TSelect;
	readonly $inferInsert: TInsert;
	readonly $inferUpdate: TUpdate;
	readonly table: TTable;
	readonly hidden: readonly (keyof TSelect & string)[];
};
