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

import { Metadata } from './metadata';
import { currentEnvironment } from './utils';

const ENVIRONMENTS = Symbol.for('elysium:Environments');

/**
 * An environment name, the value of `NODE_ENV`. Elysium knows `development`, `test` and
 * `production`; apps may use their own, such as `staging`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type Environment = 'development' | 'test' | 'production' | (string & {});

/**
 * The environments (`NODE_ENV` values) in which a service, controller, command or job is active,
 * as a module's `env` does for a whole module. A class without any is active everywhere; one
 * inactive in the current environment is left out when its module loads.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export namespace Environments {
	/** The environments that run on a developer's machine: `development` and `test`. */
	export const local: readonly Environment[] = Object.freeze(['development', 'test']);

	/**
	 * Whether the current environment is `development`.
	 */
	export const isDevelopment = (): boolean => currentEnvironment() === 'development';

	/**
	 * Whether the current environment is `test`.
	 */
	export const isTest = (): boolean => currentEnvironment() === 'test';

	/**
	 * Whether the current environment is `production`.
	 */
	export const isProduction = (): boolean => currentEnvironment() === 'production';

	/**
	 * Records the environments in which `target` is active. Decorators call it with their `env`
	 * option; `undefined` leaves the class active everywhere.
	 * @param target The decorated class.
	 * @param env The environments in which it is active.
	 */
	export const set = (target: Function, env: readonly Environment[] | undefined): void => {
		if (env !== undefined) Metadata.define(ENVIRONMENTS, [...env], target);
	};

	/**
	 * Gets the environments in which `target` is active, or `undefined` when it is active everywhere.
	 * @param target The class.
	 */
	export const of = (target: Function): readonly Environment[] | undefined =>
		Metadata.get(ENVIRONMENTS, target);

	/**
	 * Whether a list of environments includes `environment`. No list means every environment.
	 * @param env The environments, as a module's or a class's `env`.
	 * @param environment The environment to check. Defaults to the current one.
	 */
	export const includes = (
		env: readonly Environment[] | undefined,
		environment: Environment = currentEnvironment()
	): boolean => env === undefined || env.includes(environment);

	/**
	 * Whether `target` is active in `environment`.
	 * @param target The class.
	 * @param environment The environment to check. Defaults to the current one.
	 */
	export const isActive = (
		target: Function,
		environment: Environment = currentEnvironment()
	): boolean => includes(of(target), environment);
}
