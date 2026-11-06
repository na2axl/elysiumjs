// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

/**
 * A small Elysium app, built the way a Cloudflare Workers entry builds it, for the AOT gate.
 */

import { Application, Http, Middleware, Module, Service, t } from '@elysiumjs/core';

import { createRuntime } from '../../src/index';

@Service.register({ name: 'follows' })
class FollowService {
	public follow(creatorProfileId: string, note?: string) {
		return { creatorProfileId, following: true, note: note ?? null };
	}
}

class TenantHeader extends Middleware {
	public onAfterHandle(c: { set: { headers: Record<string, string> } }) {
		c.set.headers['x-module'] = 'social';
	}
}

@Http.controller('/me/follows')
class FollowController {
	public constructor(@Service.inject('follows') private readonly follows: FollowService) {}

	@Http.post('/:id')
	public follow(
		@Http.param('id', t.String({ minLength: 3 })) id: string,
		@Http.body(t.Object({ note: t.Optional(t.String()) })) body: { note?: string }
	) {
		return this.follows.follow(id, body.note);
	}
}

@Middleware.register(TenantHeader)
@Module.register({ services: [FollowService], controllers: [FollowController] })
class SocialModule extends Module {}

@Application.register({
	runtime: createRuntime({ env: { NODE_ENV: 'production' } }),
	modules: [SocialModule],
	openapi: {}
})
class App extends Application {}

export const app = await new App().build();

export default { fetch: (request: Request) => app.fetch(request) };
