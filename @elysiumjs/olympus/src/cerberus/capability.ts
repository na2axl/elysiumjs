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
import type { Ability } from './utils';

import { Middleware } from '../index';

class AbilityMiddleware extends Middleware<
	['can' | 'cannot', Ability['action'], Ability['resource']]
> {
	public override async onBeforeHandle(ctx: Context) {
		const ability = ctx['elysium:cerberus'] as ReturnType<typeof defineAbility>;
		if (ability === undefined) {
			throw ctx.status(500, 'Cerberus middleware is not configured');
		}

		const [method, action, resource] = this.guards;

		if (ability[method](action, resource)) {
			return;
		}

		throw ctx.status(403, 'Forbidden');
	}
}

export namespace Cerberus {
	/**
	 * Allows to run the request only if the requester has the given ability.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param ability The required ability the requester needs to have before to execute the request.
	 */
	export const can = (ability: Ability): MethodDecorator & ClassDecorator => {
		return Middleware.register(AbilityMiddleware.guards(['can', ability.action, ability.resource]));
	};

	/**
	 * Allows to run the request only if the requester DOESN'T HAVE the given ability
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param ability The required ability the request needs to NOT have before the execute the request.
	 */
	export const cannot = (ability: Ability): MethodDecorator & ClassDecorator => {
		return Middleware.register(
			AbilityMiddleware.guards(['cannot', ability.action, ability.resource])
		);
	};
}
