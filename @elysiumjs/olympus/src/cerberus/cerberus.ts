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
import type { Ability, AbilityAction, SubjectInput, SubjectName } from './abilities';

import { Http } from '../http';
import { Middleware } from '../middleware';
import { ForbiddenError } from '../problem';
import { Abilities } from './abilities';
import { cerberusConfig } from './config';

const ABILITY = Symbol.for('elysium:cerberus:ability');

type Check = ['can' | 'cannot', AbilityAction, SubjectName];

/**
 * Refuses a request, with `FORBIDDEN`, unless the ability of its actor passes the check of
 * `@Cerberus.can()` or `@Cerberus.cannot()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class AbilityMiddleware extends Middleware<Check> {
	/** The problems it answers with, documented on the routes it guards. */
	public static errors = [ForbiddenError];

	public override async onBeforeHandle(): Promise<void> {
		const [method, action, subject] = this.guards;
		const ability = await Cerberus.ability();
		const allowed =
			method === 'can' ? ability?.can(action, subject) : ability?.cannot(action, subject);
		if (!allowed) throw new ForbiddenError('You cannot do this.');
	}
}

/**
 * Checks what the actor of the current request or call may do.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export namespace Cerberus {
	/**
	 * The ability of the actor of the current request or call, built once per request. Undefined
	 * without an actor, or for an actor without abilities.
	 */
	export const ability = async (): Promise<Ability | undefined> => {
		const context = Http.currentContext<{ [ABILITY]?: Promise<Ability | undefined> }>();
		if (context?.[ABILITY]) return context[ABILITY];
		const actor = cerberusConfig().actor();
		const found = actor === undefined ? Promise.resolve(undefined) : Abilities.of(actor);
		if (context) context[ABILITY] = found;
		return found;
	};

	/**
	 * Whether the actor of the current request or call may do an action on a subject. False
	 * without an actor.
	 * @param action The action, such as `update`.
	 * @param subject The subject: a name, or an instance whose conditions are checked.
	 */
	export const check = async (action: AbilityAction, subject: SubjectInput): Promise<boolean> =>
		(await ability())?.can(action, subject) ?? false;

	/**
	 * The `authorize` hook of an action or a query: the call is refused with `CALL_FORBIDDEN`
	 * unless the actor may do the action on the subject.
	 * @param action The action, such as `update`.
	 * @param subject The subject, or a function of the input that answers it.
	 * @example
	 * ```ts
	 * @Action.register({ name: 'posts.publish', input: PublishPost, authorize: Cerberus.may('publish', 'Post') })
	 * ```
	 */
	export const may =
		<I = unknown>(action: AbilityAction, subject: SubjectInput | ((input: I) => SubjectInput)) =>
		(input: I): Promise<boolean> =>
			check(action, typeof subject === 'function' ? subject(input) : subject);

	/**
	 * Lets a route, or every route of a controller, run only when the actor may do an action on
	 * a subject; other requests answer `FORBIDDEN`.
	 * @param action The action, such as `create`.
	 * @param subject The subject name.
	 */
	export const can = (
		action: AbilityAction,
		subject: SubjectName
	): MethodDecorator & ClassDecorator =>
		Middleware.register(AbilityMiddleware.guards(['can', action, subject]));

	/**
	 * Lets a route, or every route of a controller, run only when the actor may not do an action
	 * on a subject; other requests answer `FORBIDDEN`.
	 * @param action The action.
	 * @param subject The subject name.
	 */
	export const cannot = (
		action: AbilityAction,
		subject: SubjectName
	): MethodDecorator & ClassDecorator =>
		Middleware.register(AbilityMiddleware.guards(['cannot', action, subject]));
}
