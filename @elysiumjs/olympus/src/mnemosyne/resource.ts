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

import type { TObject, TSchema } from '../index';
import type { ModelClass } from './interfaces';

import { t } from 'elysia';

import { Resource } from '../index';

/**
 * Options of {@link ModelResource}.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TKey The column names of the model.
 */
export type ModelResourceOptions<TKey extends string = string> = {
	/** Columns kept out of responses and of the OpenAPI document, such as `passwordHash`. */
	hidden?: TKey[];
	/** Only these columns are exposed. */
	pick?: TKey[];
	/** These columns are left out of the schema entirely. */
	omit?: TKey[];
	/** Extra fields the resource exposes, such as computed or related values. */
	extend?: Record<string, TSchema>;
};

/**
 * The response schema of a model: its select schema, with hidden, picked and omitted columns
 * applied. The model's own `hidden` columns are hidden too, and the getters in its `appends` are
 * exposed, `pick` or not, typed by `extend` when it names them. Use it as a route's `response`:
 * the handler can return model instances as they are, and the response holds only the exposed
 * fields, with dates as ISO strings.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param model The model class.
 * @param options The columns to hide, pick or omit, and extra fields.
 * @example
 * ```ts
 * const UserResource = ModelResource(User, { hidden: ['passwordHash'] });
 *
 * @Http.get('/:id', { response: UserResource })
 * public show(@Http.param('id') id: string) {
 *   return this.users.find(id);
 * }
 * ```
 */
export const ModelResource = <TModel extends ModelClass>(
	model: TModel,
	options: ModelResourceOptions<Extract<keyof TModel['$inferSelect'], string>> = {}
): TObject => {
	const select = model.selectSchema as unknown as { properties: Record<string, TSchema> };
	const hidden = new Set<string>([...(model.hidden ?? []), ...(options.hidden ?? [])]);
	const omit = new Set<string>(options.omit ?? []);
	const pick = options.pick ? new Set<string>(options.pick) : undefined;

	const properties: Record<string, TSchema> = {};
	for (const [name, schema] of Object.entries(select.properties)) {
		if (omit.has(name) || (pick && !pick.has(name) && !hidden.has(name))) continue;
		properties[name] = hidden.has(name) ? Resource.hidden(schema) : schema;
	}
	// The getters the model appends, typed by `extend` when it gives their schema.
	for (const name of model.appends ?? []) {
		if (hidden.has(name) || omit.has(name)) continue;
		properties[name] = t.Unknown();
	}
	return t.Object({ ...properties, ...options.extend });
};
