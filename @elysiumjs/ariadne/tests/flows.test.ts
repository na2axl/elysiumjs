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
import type { FlowContext, FlowStore } from '../src';

import { Application, BadRequestError, ConflictError, Http, Module, t } from '@elysiumjs/core';
import { Auth, Jwt, jwtGuard, ThemisModule } from '@elysiumjs/themis';
import { afterEach, describe, expect, it } from 'bun:test';

import {
	AriadneModule,
	Flow,
	FLOW_KEY_HEADER,
	FLOW_OWNER_HEADER,
	FLOW_STEP_HEADER,
	InvalidFlowError,
	MemoryFlowStore
} from '../src';

type SignUp = { email?: string; attempts: number; rewound?: number };

const effects: string[] = [];

const EmailBody = t.Object({ email: t.String({ format: 'email' }) });
const CodeBody = t.Object({ code: t.String() });

@Flow.controller('sign-up', { ttl: 900, owner: 'guest' })
class SignUpFlow {
	@Flow.initial()
	public initial(): SignUp {
		return { attempts: 0 };
	}

	@Flow.step<SignUp>({
		next: ['code'],
		back: ['email'],
		onRewind: (state) => ({ ...state, rewound: (state.rewound ?? 0) + 1 })
	})
	public email(
		@Http.body(EmailBody) { email }: typeof EmailBody.static,
		@Flow.state() state: SignUp
	) {
		effects.push(`mail:${email}`);
		return Flow.advance({ ...state, email }, { sentTo: email });
	}

	@Flow.step()
	public code(@Flow.state() state: SignUp, @Http.body(CodeBody) { code }: typeof CodeBody.static) {
		if (code === 'boom') throw new Error('provider down');
		if (code === 'later') throw new ConflictError('Try again later.');
		if (code === 'busy') return new ConflictError('Busy, try again.');
		if (code !== '123456') {
			const attempts = state.attempts + 1;
			return Flow.refuse({ ...state, attempts }, new BadRequestError(`Wrong code (${attempts}).`), {
				end: attempts >= 3
			});
		}
		return { welcome: state.email, attempts: state.attempts, rewound: state.rewound ?? 0 };
	}
}

@Flow.controller('profile', { path: '/me/profile-flow', ttl: 60, owner: 'user' })
@Auth({ guards: ['jwt'] })
class ProfileFlow {
	@Flow.initial()
	public initial(ctx: FlowContext) {
		return { owner: ctx.owner };
	}

	@Flow.step('name')
	public setName(
		@Http.body(t.Object({ name: t.String() })) { name }: { name: string },
		@Flow.state() state: { owner: string },
		@Flow.context() ctx: FlowContext
	) {
		return { name, owner: state.owner, flow: ctx.flow, step: ctx.step };
	}
}

type Plan = { plan?: string };

@Flow.controller('plan', { ttl: 60, owner: 'guest', start: ['choose'] })
class PlanFlow {
	/** A free plan ends the flow, a paid one goes on to payment. */
	@Flow.step<Plan>({ next: (state) => (state.plan === 'free' ? [] : ['pay']) })
	public choose(@Http.body(t.Object({ plan: t.String() })) { plan }: { plan: string }) {
		return Flow.advance({ plan }, { plan });
	}

	@Flow.step()
	public pay() {
		return { paid: true };
	}
}

const SECRET = 'j'.repeat(32);
const users: Record<string, { id: string }> = { u1: { id: 'u1' }, u2: { id: 'u2' } };

type Pin = { attempts: number };

/** A first step that refuses: its attempts must add up from the first try. */
@Flow.controller('pin', { ttl: 60, owner: 'guest' })
class PinFlow {
	@Flow.initial()
	public initial(): Pin {
		return { attempts: 0 };
	}

	@Flow.step({ lease: 120 })
	public check(
		@Http.body(t.Object({ pin: t.String() })) { pin }: { pin: string },
		@Flow.state() state: Pin
	) {
		if (pin === '1234') return { attempts: state.attempts };
		const attempts = state.attempts + 1;
		return Flow.refuse({ attempts }, new BadRequestError(`Wrong pin (${attempts}).`), {
			end: attempts >= 3
		});
	}
}

/** A user flow behind a guard whose user is the JWT claims. */
@Flow.controller('claims', { ttl: 60, owner: 'user' })
@Auth({ guards: ['claims'] })
class ClaimsFlow {
	@Flow.step()
	public hello(@Flow.context() ctx: FlowContext) {
		return { owner: ctx.owner };
	}
}

@Module.register({ controllers: [SignUpFlow, ProfileFlow, PlanFlow, PinFlow, ClaimsFlow] })
class FlowsModule extends Module {}

const makeApp = (store: FlowStore) => {
	@Application.register({
		modules: [
			ThemisModule.with({
				secret: 's'.repeat(32),
				guards: {
					jwt: jwtGuard({ secret: SECRET, user: (claims) => users[claims.sub as string] }),
					claims: jwtGuard({ secret: SECRET })
				}
			}),
			AriadneModule.with({ store }),
			FlowsModule
		],
		openapi: false
	})
	class App extends Application {}
	return App;
};

const bearer = async (sub: string) =>
	`Bearer ${await Jwt.sign({}, { secret: SECRET, subject: sub, expiresIn: 60 })}`;

describe('Flow.controller', () => {
	it('describes the flow from its steps', () => {
		const description = Flow.describe(SignUpFlow)!;
		expect(description.start).toEqual(['email']);
		expect([...description.steps.keys()]).toEqual(['email', 'code']);
		expect(description.steps.get('code')!.next({})).toEqual([]);
		expect(Flow.describe(class {})).toBeUndefined();
	});

	it('refuses a flow without steps, with a bad name, a bad ttl or unknown steps', () => {
		const declare = (
			{ name, ...options }: { name: string } & Parameters<typeof Flow.controller>[1],
			withStep = true
		) => {
			class Target {
				public a() {}
			}
			if (withStep) {
				Flow.step({ back: ['y'] })(
					Target.prototype,
					'a',
					Object.getOwnPropertyDescriptor(Target.prototype, 'a')!
				);
			}
			Flow.controller(name, options)(Target);
		};
		const base = { name: 'a', ttl: 1, owner: 'guest' as const };
		expect(() => declare(base, false)).toThrow(InvalidFlowError);
		expect(() => declare({ ...base, name: 'Bad Name' })).toThrow('kebab-case');
		expect(() => declare({ ...base, ttl: 0 })).toThrow('positive ttl');
		expect(() => declare({ ...base, start: ['x'] })).toThrow('unknown steps: x, y');
	});
});

describe('flows over HTTP', () => {
	let testing: TestingHttpApp | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
		effects.length = 0;
	});

	const guest = async (store: FlowStore = new MemoryFlowStore()) => {
		testing = await Application.testing({ app: makeApp(store) });
		const http = testing.http;
		const started = await http.post('/flows/sign-up');
		expect(started.status).toBe(201);
		const { flowKey, owner, nextSteps } = await started.json();
		expect(nextSteps).toEqual(['email']);
		const step = (name: string, stepId: string, body: object, token = owner) =>
			http
				.post(`/flows/sign-up/${name}`)
				.header(FLOW_OWNER_HEADER, token)
				.header(FLOW_KEY_HEADER, flowKey)
				.header(FLOW_STEP_HEADER, stepId)
				.json(body);
		const state = (token = owner) =>
			http.get('/flows/sign-up').header(FLOW_OWNER_HEADER, token).header(FLOW_KEY_HEADER, flowKey);
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
			.header(FLOW_KEY_HEADER, 'nope')
			.header(FLOW_STEP_HEADER, 's1')
			.json({ email: 'ada@example.com' });
		expect(missing.status).toBe(410);

		const invalid = await step('email', 's1', { email: 'not an email' });
		expect(invalid.status).toBe(422);
		expect((await invalid.json()).errors[0].pointer).toBe('/body/email');

		const bare = await http.post('/flows/sign-up/email').json({ email: 'ada@example.com' });
		expect(bare.status).toBe(422);
		expect((await bare.json()).errors.map((e: { pointer: string }) => e.pointer)).toEqual([
			`/headers/${FLOW_KEY_HEADER}`,
			`/headers/${FLOW_STEP_HEADER}`
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
		// A returned error refuses the step like a thrown one: nothing is committed.
		const busy = await step('code', 's2', { code: 'busy' });
		expect(busy.status).toBe(409);
		expect((await busy.json()).code).toBe('CONFLICT');
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

	it('ends the flow when next gives no step for the state', async () => {
		testing = await Application.testing({ app: makeApp(new MemoryFlowStore()) });
		const http = testing.http;
		const run = async (plan: string) => {
			const { flowKey, owner } = await (await http.post('/flows/plan')).json();
			const step = (name: string, stepId: string, body: object = {}) =>
				http
					.post(`/flows/plan/${name}`)
					.header(FLOW_OWNER_HEADER, owner)
					.header(FLOW_KEY_HEADER, flowKey)
					.header(FLOW_STEP_HEADER, stepId)
					.json(body);
			return { chosen: await (await step('choose', 's1', { plan })).json(), step };
		};

		const free = await run('free');
		expect(free.chosen).toEqual({ answer: { plan: 'free' }, nextSteps: [], backSteps: [] });
		expect((await free.step('pay', 's2')).status).toBe(410);

		const paid = await run('pro');
		expect(paid.chosen.nextSteps).toEqual(['pay']);
		expect(await (await paid.step('pay', 's2')).json()).toEqual({
			answer: { paid: true },
			nextSteps: [],
			backSteps: []
		});
	});

	it('gives a user flow to the signed-in user, on the path of the controller', async () => {
		testing = await Application.testing({ app: makeApp(new MemoryFlowStore()) });
		const http = testing.http;
		expect((await http.post('/me/profile-flow')).status).toBe(401);

		const started = await http.post('/me/profile-flow').header('authorization', await bearer('u1'));
		const { flowKey, owner } = await started.json();
		expect(owner).toBeUndefined();

		const name = async (sub: string) =>
			http
				.post('/me/profile-flow/name')
				.header('authorization', await bearer(sub))
				.header(FLOW_KEY_HEADER, flowKey)
				.header(FLOW_STEP_HEADER, 's1')
				.json({ name: 'Ada' });
		expect((await name('u2')).status).toBe(403);
		expect((await (await name('u1')).json()).answer).toEqual({
			name: 'Ada',
			owner: 'u1',
			flow: 'profile',
			step: 'name'
		});
	});
});

describe('flow state between attempts', () => {
	let testing: TestingHttpApp | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	const pin = async (store: FlowStore) => {
		testing = await Application.testing({ app: makeApp(store) });
		const http = testing.http;
		const { flowKey, owner } = await (await http.post('/flows/pin')).json();
		const check = (stepId: string, value: string) =>
			http
				.post('/flows/pin/check')
				.header(FLOW_OWNER_HEADER, owner)
				.header(FLOW_KEY_HEADER, flowKey)
				.header(FLOW_STEP_HEADER, stepId)
				.json({ pin: value });
		return { flowKey, check };
	};

	it('keeps the state of a refused first step, and ends the flow on the last attempt', async () => {
		const { check } = await pin(new MemoryFlowStore());
		expect((await (await check('s1', '0000')).json()).detail).toBe('Wrong pin (1).');
		expect((await (await check('s2', '0000')).json()).detail).toBe('Wrong pin (2).');
		expect((await (await check('s3', '0000')).json()).detail).toBe('Wrong pin (3).');
		expect((await check('s4', '1234')).status).toBe(410);
	});

	it('runs a step on the state the store holds when the step is reserved', async () => {
		// The load of the second attempt happens before the first attempt is refused, and its claim
		// after: the step must see the first refusal.
		let gate: Promise<void> | undefined;
		let paused: (() => void) | undefined;
		class GatedStore extends MemoryFlowStore {
			public override async load(key: string) {
				const record = await super.load(key);
				if (gate) {
					const wait = gate;
					gate = undefined;
					paused?.();
					await wait;
				}
				return record;
			}
		}
		const store = new GatedStore();
		const { check } = await pin(store);

		let open!: () => void;
		gate = new Promise((resolve) => (open = resolve));
		const loaded = new Promise<void>((resolve) => (paused = resolve));
		// The test client sends a request when it is awaited.
		const second = (async () => await check('s2', '0000'))();
		await loaded;
		expect((await (await check('s1', '0000')).json()).detail).toBe('Wrong pin (1).');
		open();
		expect((await (await second).json()).detail).toBe('Wrong pin (2).');
		expect((await (await check('s3', '0000')).json()).detail).toBe('Wrong pin (3).');
	});

	it('takes the lease of a step from its options', () => {
		expect(Flow.describe(PinFlow)!.steps.get('check')!.lease).toBe(120);
		expect(Flow.describe(PlanFlow)!.steps.get('pay')!.lease).toBe(30);
	});

	it('answers in-flight to another submission while a step runs', async () => {
		const store = new MemoryFlowStore();
		const { flowKey, check } = await pin(store);
		await store.claim(`pin:${flowKey}`, {
			stepId: 's1',
			step: 'check',
			expectStep: null,
			leaseSeconds: 30
		});
		const busy = await check('s2', '0000');
		expect(busy.status).toBe(409);
		expect((await busy.json()).type).toBe('flow-step-in-progress');
	});

	it('reads the owner of a user flow from JWT claims', async () => {
		testing = await Application.testing({ app: makeApp(new MemoryFlowStore()) });
		const http = testing.http;
		const auth = await bearer('u9');
		const { flowKey } = await (
			await http.post('/flows/claims').header('authorization', auth)
		).json();
		const hello = await http
			.post('/flows/claims/hello')
			.header('authorization', auth)
			.header(FLOW_KEY_HEADER, flowKey)
			.header(FLOW_STEP_HEADER, 's1')
			.json({});
		expect((await hello.json()).answer).toEqual({ owner: 'u9' });
	});
});

describe('AriadneModule', () => {
	it('needs a store', async () => {
		@Application.register({ modules: [AriadneModule.with({})], openapi: false })
		class App extends Application {}
		await expect(Application.testing({ app: App })).rejects.toThrow('store');
	});
});
