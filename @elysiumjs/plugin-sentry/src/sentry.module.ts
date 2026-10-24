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

import type * as Sentry from '@sentry/bun';

import { Application, Env, MissingModuleConfigError, Module } from '@elysiumjs/core';

import { plugin } from './plugin';

/**
 * Configurable module that installs the Sentry plugin on the root app when serving.
 * `dsn` may come from the config or from `SENTRY_DSN`; boot fails when neither is set.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Module.register({})
export class SentryModule extends Module.configurable<Sentry.BunOptions>() {
	public override onInit(): void {
		if (!this.config.dsn && !Env.get('SENTRY_DSN')) {
			throw new MissingModuleConfigError(SentryModule.name, ['dsn (or SENTRY_DSN)']);
		}
	}

	public override async onServe(app: Parameters<Module['onServe']>[0]): Promise<void> {
		app.use(await plugin(this.config)(Application.instance));
	}
}
