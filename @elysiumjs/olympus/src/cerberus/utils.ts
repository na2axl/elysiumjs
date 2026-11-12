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

import type { defineAbility } from '@casl/ability';
import type { Context } from '../index';

/**
 * A subject.
 *
 * Can be a requester (usually, an `User` object), or any resource (e.g. `Article`, `Post`, `Order`, etc.).
 * The subject needs to expose an `id` field of type `string`.
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type Subject = {
	/**
	 * Unique identifier for the subject.
	 */
	id: string;
};

/**
 * An Ability.
 *
 * An ability is represented as an `action` over a specific `resource`. The list of abilities depends
 * on your system, for example:
 *
 * ```js
 * const createPostAbility = {
 *   action: 'create',
 *   resource: 'Post'
 * };
 * ```
 *
 * It is also possible to provide an array of `fields` in the resource on which the requester may
 * perform the action. This is helpful to create abilities on a subset of a resource:
 *
 * ```js
 * const canWriteSensitiveDataAbility = {
 *  action: 'update',
 *  resource: 'Foo',
 *  fields: ['sensitive_data', 'another_sensitive_data']
 * }
 * ```
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type Ability = {
	/**
	 * The ability action (e.g. `create`, `update`, `read`, `upload`, etc.)
	 */
	action: string;

	/**
	 * The resource on which the `action` is being applied.
	 */
	resource: string;

	/**
	 * The fields in the resource the requester want to access to.
	 */
	fields?: string[];
};

/**
 * Cerberus Configuration.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type CerberusConfig = {
	/**
	 * Returns the list of abilities for the given context.
	 * @param ctx The request context.
	 */
	getAbilities?(ctx: Context): Promise<Ability[]>;

	/**
	 * Returns the subject for the given context.
	 * @param ctx The request context.
	 */
	getSubject(ctx: Context): Promise<Subject | null>;

	/**
	 * Custom ability definition function.
	 *
	 * Use this function if you need to have control on how Cerberus defines abilities. If this
	 * function is not provided, Cerberus will use the default ability definition function, with
	 * the abilities returned by `getAbilities`.
	 *
	 * @param subject The subject for which create the abilities.
	 * @param define The ability definition function.
	 */
	defineAbility?(
		subject: Subject | null,
		define: typeof defineAbility
	): Promise<ReturnType<typeof defineAbility>>;
};
