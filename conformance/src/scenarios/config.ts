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

import type { Scenario } from './types';

import { Application, Env, Http, Module, Secret } from '@elysiumjs/olympus';
import { t } from 'elysia';

const make = async (): Promise<Application> => {
	@Http.controller('/config')
	class ConfigController {
		@Http.get()
		public show() {
			return {
				region: Env.get('CONFORMANCE_REGION' as never),
				retries: Env.get('CONFORMANCE_RETRIES' as never),
				token: String(Env.get('CONFORMANCE_TOKEN' as never))
			};
		}
	}

	@Module.register({
		controllers: [ConfigController],
		envSchema: t.Object({ CONFORMANCE_TOKEN: Secret.schema(t.String({ default: 'tok_123' })) })
	})
	class ConfigModule extends Module {}

	@Application.register({
		modules: [ConfigModule],
		openapi: false,
		env: t.Object({
			CONFORMANCE_REGION: t.String({ default: 'eu' }),
			CONFORMANCE_RETRIES: t.Number({ default: 3 })
		})
	})
	class ConfigApp extends Application {}

	return new ConfigApp();
};

/**
 * The environment schemas of the app and its modules are merged and validated through the
 * runtime, with defaults applied and secrets redacted.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const config: Scenario = {
	name: 'config: merged environment schemas with defaults and secrets',
	app: make,
	requests: [
		{
			request: () => new Request('http://localhost/config'),
			expect: { status: 200, json: { region: 'eu', retries: 3, token: '[secret]' } }
		}
	]
};
