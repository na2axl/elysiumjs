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

import type { Scenario } from './types';

import { Application, Http, Module } from '@elysiumjs/core';
import { Auth, jwtGuard, Password, Pbkdf2PasswordHasher, ThemisModule } from '@elysiumjs/themis';

const JWT_SECRET = 'conformance-jwt-secret-of-32-chars!';

/**
 * A token for `u1`, signed with {@link JWT_SECRET} and expiring in 2100: the AOT lane sends requests
 * from outside the app.
 */
const TOKEN =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3OTM5Mzk1MTIsImV4cCI6NDEwMjQ0NDgwMCwic3ViIjoidTEifQ.qCL4IwM_73qFOLP2_ibEcFY48KFAVov9TEgHz0KRul4';

const make = async (): Promise<Application> => {
	const users: Record<string, { id: string; name: string }> = { u1: { id: 'u1', name: 'Ada' } };

	@Http.controller('/me')
	@Auth()
	class MeController {
		@Http.get('/')
		public me(@Http.context() c: { currentUser: unknown }) {
			return {
				user: Auth.currentUser(),
				same: c.currentUser === Auth.currentUser(),
				guard: Auth.guard()
			};
		}
	}

	@Http.controller('/password')
	class PasswordController {
		@Http.post('/')
		public async check() {
			Password.use(new Pbkdf2PasswordHasher());
			const hash = await Password.hash('correct horse');
			return {
				format: hash.split('$')[1],
				verified: await Password.verify('correct horse', hash),
				wrong: await Password.verify('wrong horse', hash)
			};
		}
	}

	@Module.register({ controllers: [MeController, PasswordController] })
	class AuthModule extends Module {}

	@Application.register({
		modules: [
			ThemisModule.with({
				secret: 's'.repeat(32),
				guards: {
					jwt: jwtGuard({ secret: JWT_SECRET, user: (claims) => users[claims.sub as string] })
				}
			}),
			AuthModule
		],
		openapi: false
	})
	class AuthApp extends Application {}

	return new AuthApp();
};

const me = (authorization?: string) => () =>
	new Request('http://localhost/me', { headers: authorization ? { authorization } : {} });

/**
 * `@Auth()` refuses a request without credentials (401) or with a forged token, and a valid JWT
 * puts its user in the request; PBKDF2 hashes and verifies a password.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const auth: Scenario = {
	name: 'auth: 401, JWT user and PBKDF2 passwords',
	app: make,
	requests: [
		{
			request: me(),
			expect: { status: 401, headers: { 'content-type': 'application/problem+json' } }
		},
		{ request: me(`Bearer ${TOKEN}x`), expect: { status: 401 } },
		{
			request: me(`Bearer ${TOKEN}`),
			expect: { status: 200, json: { user: { id: 'u1', name: 'Ada' }, same: true, guard: 'jwt' } }
		},
		{
			request: () => new Request('http://localhost/password', { method: 'POST' }),
			expect: { status: 200, json: { format: 'pbkdf2-sha256', verified: true, wrong: false } }
		}
	]
};
