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

import type { ServiceFactoryDefinition } from '@elysiumjs/olympus';

import { Module, ServiceScope } from '@elysiumjs/olympus';

import { Workers, WORKERS_CONTEXT_SERVICE, WORKERS_ENV_SERVICE } from './workers';

/**
 * Configuration of the {@link WorkersModule}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkersModuleConfig = {
	/** The bindings to provide as services, injected with `@Workers.inject(name)`. */
	bindings: string[];
};

/**
 * Provides the Worker's env (`workers.env`), the execution context (`workers.context`) and
 * each listed binding (`workers.binding.<name>`) as global request-scoped services: they hold
 * the values of the invocation being handled, never values kept across invocations.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Module.register<WorkersModuleConfig>({
	services: (config) => {
		const perInvocation = (name: string, read: () => unknown): ServiceFactoryDefinition => ({
			name,
			global: true,
			scope: ServiceScope.REQUEST,
			factory: read
		});
		return [
			perInvocation(WORKERS_ENV_SERVICE, () => Workers.env()),
			perInvocation(WORKERS_CONTEXT_SERVICE, () => Workers.context()),
			...config.bindings.map((name) =>
				perInvocation(Workers.bindingService(name), () => Workers.binding(name))
			)
		];
	}
})
export class WorkersModule extends Module.configurable<WorkersModuleConfig>({
	defaults: { bindings: [] }
}) {}
