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

import type { TestingHttpApp } from '@elysiumjs/core';
import type { FlowStore } from '../src';

import { Application, DomainError, t } from '@elysiumjs/core';
import { Auth, Jwt, jwtGuard, ThemisModule } from '@elysiumjs/themis';
import { afterEach, describe, expect, it } from 'bun:test';

import { AriadneModule, Flow, FLOW_OWNER_HEADER, InvalidFlowError, MemoryFlowStore } from '../src';

type SignUp = { email?: string; attempts: number; rewound?: number };

const effects: string[] = [];

const signUp = Flow.define({
	name: 'sign-up',
	ttlSeconds: 900,
	owner: 'guest',
	initial: (): SignUp => ({ attempts: 0 }),
	steps: {
		email: {
			body: t.Object({ email: t.String({ format: 'email' }) }),
			next: () => ['code'],
			back: ['email'],
			onRewind: (_ctx, state) => ({ ...state, rewound: (state.rewound ?? 0) + 1 }),
			run: async (_ctx, state, { email }) => {
				effects.push(`mail:${email}`);
				return { state: { ...state, email }, answer: { sentTo: email } };
			}
		},
		code: {
			body: t.Object({ code: t.String() }),
			next: () => [],
			run: async (_ctx, state, { code }) => {
				if (code === 'boom') throw new Error('provider down');
				if (code === 'later') return DomainError.conflict('Try again later.');
				if (code !== '123456') {
					const attempts = state.attempts + 1;
					return Flow.refuse(
						{ ...state, attempts },
						DomainError.badRequest(`Wrong code (${attempts}).`),
						{ end: attempts >= 3 }
					);
				}
				return {
					state,
					answer: { welcome: state.email, attempts: state.attempts, rewound: state.rewound ?? 0 },
					terminal: true
				};
			}
		}
	}
});

const profile = Flow.define({
	name: 'profile',
	ttlSeconds: 60,
	owner: 'user',
	initial: (ctx) => ({ owner: ctx.owner }),
	steps: {
		name: {
			body: t.Object({ name: t.String() }),
			next: () => [],
			run: async (ctx, state, { name }) => ({
				state,
				answer: { name, owner: (state as { owner: string }).owner, flow: ctx.flow },
				terminal: true
			})
		}
	}
});

const SECRET = 'j'.repeat(32);
const users: Record<string, { id: string }> = { u1: { id: 'u1' }, u2: { id: 'u2' } };

const makeApp = (store: FlowStore, admit?: () => DomainError | undefined) => {
	@Application.register({
		modules: [
			ThemisModule.with({
				secret: 's'.repeat(32),
				guards: { jwt: jwtGuard({ secret: SECRET, user: (claims) => users[claims.sub as string] }) }
			}),
			AriadneModule.with({
				flows: [signUp, profile],
				store,
				admit,
				authenticate: Auth({ guards: ['jwt'] })
			})
		],
		openapi: false
	})
	class App extends Application {}
	return App;
};

const bearer = async (sub: string) =>
	`Bearer ${await Jwt.sign({}, { secret: SECRET, subject: sub, expiresIn: 60 })}`;

describe('Flow.define', () => {
	const step = { body: t.Object({}), next: () => [], run: async () => ({ state: {}, answer: {} }) };

	it('refuses a flow without steps, with a bad name, a bad TTL or unknown steps', () => {
		const base = { ttlSeconds: 1, owner: 'guest' as const, initial: () => ({}) };
		expect(() => Flow.define({ ...base, name: 'a', steps: {} })).toThrow(InvalidFlowError);
		expect(() => Flow.define({ ...base, name: 'Bad Name', steps: { a: step } })).toThrow(
			'kebab-case'
		);
		expect(() => Flow.define({ ...base, name: 'a', ttlSeconds: 0, steps: { a: step } })).toThrow(
			'ttlSeconds'
		);
		expect(() =>
			Flow.define({ ...base, name: 'a', start: ['x'], steps: { a: { ...step, back: ['y'] } } })
		).toThrow('unknown steps: x, y');
	});
});

describe('flows over HTTP', () => {
	let testing: TestingHttpApp | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
		effects.length = 0;
	});

	const guest = async (
		store: FlowStore = new MemoryFlowStore(),
		admit?: () => DomainError | undefined
	) => {
		testing = await Application.testing({ app: makeApp(store, admit) });
		const http = testing.http;
		const started = await http.post('/flows/sign-up');
		expect(started.status).toBe(201);
		const { flowKey, owner, nextSteps } = await started.json();
		expect(nextSteps).toEqual(['email']);
		const step = (name: string, stepId: string, body: object, token = owner) =>
			http
				.post(`/flows/sign-up/${name}`)
				.header(FLOW_OWNER_HEADER, token)
				.json({ flowKey, stepId, ...body });
		const state = (token = owner) =>
			http.get(`/flows/sign-up?flowKey=${flowKey}`).header(FLOW_OWNER_HEADER, token);
		return { http, flowKey, owner, step, state };
	};

	it('runs a guest flow: start, steps, replay of a step id, and the end', async () => {
		const { step, state } = await guest();

		const email = await step('email', 's1', { email: 'ada@example.com' });
		expect(await email.json()).toEqual({
			answer: { sentTo: 'ada@example.com' },
			nextSteps: ['code'],
			backSteps: ['email']
		});
		// A repeat of the step id replays the answer, and the step does not run again.
		expect((await (await step('email', 's1', { email: 'ada@example.com' })).json()).answer).toEqual(
			{
				sentTo: 'ada@example.com'
			}
		);
		expect(effects).toEqual(['mail:ada@example.com']);

		expect(await (await state()).json()).toMatchObject({
			step: 'email',
			nextSteps: ['code'],
			backSteps: ['email'],
			answer: { sentTo: 'ada@example.com' }
		});

		const done = await step('code', 's2', { code: '123456' });
		expect(await done.json()).toEqual({
			answer: { welcome: 'ada@example.com', attempts: 0, rewound: 0 },
			nextSteps: [],
			backSteps: []
		});
		// The last answer stays replayable, while any other call learns that the flow is finished.
		expect((await (await step('code', 's2', { code: '123456' })).json()).answer.welcome).toBe(
			'ada@example.com'
		);
		expect((await step('code', 's3', { code: '123456' })).status).toBe(410);
		expect((await state()).status).toBe(410);
	});

	it('answers 409 with the next steps for an unexpected step, and for a step id reused on another step', async () => {
		const { step } = await guest();
		const early = await step('code', 's1', { code: '1' });
		expect(early.status).toBe(409);
		expect(await early.json()).toMatchObject({ nextSteps: ['email'], backSteps: [], answer: null });

		await step('email', 's1', { email: 'ada@example.com' });
		expect((await step('code', 's1', { code: '123456' })).status).toBe(409);
	});

	it('refuses another owner, a missing flow, and a bad body', async () => {
		const { http, step } = await guest();
		expect((await step('email', 's1', { email: 'ada@example.com' }, 'forged')).status).toBe(403);
		expect((await step('email', 's1', { email: 'ada@example.com' }, '')).status).toBe(403);

		const missing = await http
			.post('/flows/sign-up/email')
			.json({ flowKey: 'nope', stepId: 's1', email: 'ada@example.com' });
		expect(missing.status).toBe(410);

		const invalid = await step('email', 's1', { email: 'not an email' });
		expect(invalid.status).toBe(422);
		expect((await invalid.json()).errors[0].pointer).toBe('/body/email');

		const bare = await http.post('/flows/sign-up/email').json({});
		expect(bare.status).toBe(422);
		expect((await bare.json()).errors.map((e: { pointer: string }) => e.pointer)).toEqual([
			'/body/flowKey',
			'/body/stepId'
		]);
		expect((await http.get('/flows/sign-up')).status).toBe(422);
	});

	it('keeps the state of a refused step, and ends the flow on the last attempt', async () => {
		const { step, state } = await guest();
		await step('email', 's1', { email: 'ada@example.com' });

		const wrong = await step('code', 's2', { code: '000000' });
		expect(wrong.status).toBe(400);
		expect((await wrong.json()).detail).toBe('Wrong code (1).');
		// The same step id may be retried, and the attempt was counted.
		expect((await (await step('code', 's2', { code: '000000' })).json()).detail).toBe(
			'Wrong code (2).'
		);
		expect(await (await state()).json()).toMatchObject({ step: 'email' });

		expect((await (await step('code', 's3', { code: '000000' })).json()).detail).toBe(
			'Wrong code (3).'
		);
		expect((await state()).status).toBe(410);
	});

	it('gives the step back when it fails, so that the same step id can be retried', async () => {
		const { step } = await guest();
		await step('email', 's1', { email: 'ada@example.com' });
		expect((await step('code', 's2', { code: 'later' })).status).toBe(409);
		expect((await step('code', 's2', { code: 'boom' })).status).toBe(500);
		const done = await step('code', 's2', { code: '123456' });
		expect(done.status).toBe(200);
	});

	it('goes back to an earlier step, running onRewind on its state', async () => {
		const { step } = await guest();
		await step('email', 's1', { email: 'ada@example.com' });
		const again = await step('email', 's2', { email: 'grace@example.com' });
		expect(await again.json()).toEqual({
			answer: { sentTo: 'grace@example.com' },
			nextSteps: ['code'],
			backSteps: ['email']
		});
		expect(effects).toEqual(['mail:ada@example.com', 'mail:grace@example.com']);
		expect((await (await step('code', 's3', { code: '123456' })).json()).answer).toEqual({
			welcome: 'grace@example.com',
			attempts: 0,
			rewound: 1
		});
	});

	it('answers 409 while the same step runs in another request', async () => {
		const store = new MemoryFlowStore();
		const { flowKey, step } = await guest(store);
		await store.claim(`sign-up:${flowKey}`, {
			stepId: 's1',
			step: 'email',
			expectStep: null,
			leaseSeconds: 30
		});
		const busy = await step('email', 's1', { email: 'ada@example.com' });
		expect(busy.status).toBe(409);
		expect((await busy.json()).type).toBe('flow-step-in-progress');
		expect((await step('email', 's2', { email: 'ada@example.com' })).status).toBe(409);
	});

	it('lets admit refuse a start', async () => {
		testing = await Application.testing({
			app: makeApp(new MemoryFlowStore(), () => new DomainError({ status: 429 }))
		});
		expect((await testing.http.post('/flows/sign-up')).status).toBe(429);
	});

	it('gives a user flow to the signed-in user', async () => {
		testing = await Application.testing({ app: makeApp(new MemoryFlowStore()) });
		const http = testing.http;
		expect((await http.post('/flows/profile')).status).toBe(401);

		const started = await http.post('/flows/profile').header('authorization', await bearer('u1'));
		const { flowKey, owner } = await started.json();
		expect(owner).toBeUndefined();

		const other = await http
			.post('/flows/profile/name')
			.header('authorization', await bearer('u2'))
			.json({ flowKey, stepId: 's1', name: 'Ada' });
		expect(other.status).toBe(403);

		const done = await http
			.post('/flows/profile/name')
			.header('authorization', await bearer('u1'))
			.json({ flowKey, stepId: 's1', name: 'Ada' });
		expect((await done.json()).answer).toEqual({ name: 'Ada', owner: 'u1', flow: 'profile' });
	});
});
