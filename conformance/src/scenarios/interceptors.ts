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

import type { Interceptor, InterceptorContext } from '@elysiumjs/olympus';
import type { Scenario } from './types';

import { Application, Http, Module, TimingInterceptor } from '@elysiumjs/olympus';

const make = async (): Promise<Application> => {
	const tag = (name: string) =>
		class implements Interceptor {
			public async intercept(_ctx: InterceptorContext, next: () => Promise<unknown>) {
				const result = (await next()) as { trail: string[] };
				return { trail: [...result.trail, name] };
			}
		};

	@Http.controller('/wrapped', { interceptors: [tag('controller')] })
	class WrappedController {
		@Http.get('/', { interceptors: [tag('route')] })
		public show() {
			return { trail: ['handler'] };
		}
	}

	@Module.register({ controllers: [WrappedController], interceptors: [tag('module')] })
	class WrappedModule extends Module {}

	@Application.register({
		modules: [WrappedModule],
		openapi: false,
		interceptors: [TimingInterceptor, tag('app')]
	})
	class WrappedApp extends Application {}

	return new WrappedApp();
};

/**
 * Interceptors wrap the handler from the app inwards to the route.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const interceptors: Scenario = {
	name: 'interceptors: app, module, controller and route wrap the handler',
	app: make,
	requests: [
		{
			request: () => new Request('http://localhost/wrapped'),
			expect: {
				status: 200,
				headers: { 'server-timing': 'handler;dur=' },
				json: { trail: ['handler', 'route', 'controller', 'module', 'app'] }
			}
		}
	]
};
