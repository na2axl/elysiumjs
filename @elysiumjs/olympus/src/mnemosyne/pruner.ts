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

import type { ModelClass } from './interfaces';
import type { RepositoryAdapter, RepositoryTarget, Row, ScopeOf } from './repository';

import { Job } from '../heracles/job';
import { MissingRepositoryAdapterError, RepositoryKeyError } from './repository';

/**
 * The base of the classes {@link Pruner} creates: a job that deletes the rows of its model that
 * `prunable` names, chunk by chunk.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TSelect The row type of the model.
 * @template TScope The scope conditions of the model's backend.
 */
export abstract class PrunerJob<TSelect = Row, TScope = unknown> extends Job {
	/** The model whose rows the job deletes, set by {@link Pruner}. */
	public static readonly Model: ModelClass;

	/** The database connection name to use. Override it to use another connection. */
	public static readonly connection: string = 'default';

	/** How many rows were deleted by the last run. */
	public pruned = 0;

	/**
	 * The condition of the rows to delete, read on each run. `undefined` means that there is
	 * nothing to prune this time.
	 */
	protected abstract get prunable(): TScope | undefined;

	/** How many rows each statement deletes, read on each run. Defaults to 1,000. */
	protected get chunkSize(): number {
		return 1000;
	}

	/**
	 * Called with each chunk of rows before they are deleted, such as to delete their files.
	 * Leave it out to delete without loading the rows.
	 */
	protected pruning?(rows: TSelect[]): Promise<void> | void;

	protected async execute(): Promise<void> {
		const { Model: model, connection } = this.constructor as typeof PrunerJob;
		const adapter = model.adapter?.repository as RepositoryAdapter<unknown, unknown, TScope>;
		if (!adapter) throw new MissingRepositoryAdapterError(model.name);

		this.pruned = 0;
		const scope = this.prunable;
		if (scope === undefined || scope === null) return;
		const size = Math.max(1, Math.floor(this.chunkSize));
		const target: RepositoryTarget = {
			table: model.table,
			model: model.name,
			connection,
			key: adapter.primaryKey(model.table)
		};

		if (this.pruning && target.key.length === 0) {
			throw new RepositoryKeyError(
				`The table of ${model.name} has no primary key: a pruner with a pruning() hook needs one.`
			);
		}

		for (;;) {
			let deleted: number;
			if (this.pruning) {
				const rows = await adapter.findWhere(target, scope, size);
				if (rows.length === 0) break;
				await this.pruning(rows as TSelect[]);
				const keys = rows.map((row) =>
					Object.fromEntries(target.key.map((column) => [column, row[column]]))
				);
				deleted = await adapter.deleteMany(target, keys);
				this.pruned += deleted;
				if (rows.length < size) break;
			} else {
				deleted = await adapter.deleteWhere(target, scope, size);
				this.pruned += deleted;
				if (deleted < size) break;
			}
			// Rows the hook saw but that were not deleted would come back forever.
			if (deleted === 0) break;
		}
	}
}

/**
 * The class {@link Pruner} returns: an abstract {@link PrunerJob} constructor with the statics
 * a job class needs.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type PrunerClass<TSelect, TScope> = (abstract new () => PrunerJob<TSelect, TScope>) &
	Pick<typeof PrunerJob, 'Model' | 'connection' | 'register' | 'generateJobId' | 'description'>;

/**
 * Creates a job class that deletes the stale rows of a model, chunk by chunk. A subclass names
 * the rows with the `prunable` getter, in its backend's terms (an SQL condition with Drizzle),
 * and registers itself as a job, usually on a schedule. Getters are read on each run, so a time
 * window such as "older than 90 days" stays current.
 *
 * Without a `pruning()` hook, rows are deleted without being loaded. With one, each chunk is
 * loaded, given to the hook, then deleted by the table's primary key.
 *
 * A pruner works on the table of the tenant in context when it runs: with per-tenant tables, run
 * it once per tenant.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param model The model class.
 * @example
 * ```ts
 * @Job.register({ queue: 'maintenance' })
 * @Scheduler.job('0 3 * * *')
 * export class PruneSessions extends Pruner(SessionModel) {
 * 	protected get prunable() {
 * 		return lt(sessions.expiresAt, new Date());
 * 	}
 * }
 * ```
 */
export const Pruner = <TModel extends ModelClass>(model: TModel) => {
	abstract class P extends PrunerJob<TModel['$inferSelect'], ScopeOf<TModel['table']>> {
		public static override readonly Model: ModelClass = model;
	}
	// Typed without the protected statics of the console mixin, so that apps that emit
	// declarations can export their pruners.
	return P as unknown as PrunerClass<TModel['$inferSelect'], ScopeOf<TModel['table']>>;
};
