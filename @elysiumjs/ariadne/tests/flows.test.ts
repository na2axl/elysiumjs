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

import type { Static, TestingHttpApp } from '@elysiumjs/core';
import type { FlowAnswer, FlowContext, FlowStore } from '../src';

import {
	Application,
	AsyncResult,
	BadRequestError,
	ConflictError,
	Environments,
	Http,
	Module,
	Result,
	Service,
	t
} from '@elysiumjs/core';
import { Auth, Jwt, jwtGuard, ThemisModule } from '@elysiumjs/themis';
import { afterEach, describe, expect, expectTypeOf, it } from 'bun:test';

import {
	AriadneModule,
	Flow,
	FLOW_KEY_HEADER,
	FLOW_OWNER_HEADER,
	FLOW_STEP_HEADER,
	FlowRouteTypes,
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
		@Http.body(EmailBody) { email }: Static<typeof EmailBody>,
		@Flow.state() state: SignUp
	) {
		effects.push(`mail:${email}`);
		return Flow.advance({ ...state, email }, { sentTo: email });
	}

	@Flow.step()
	public code(@Flow.state() state: SignUp, @Http.body(CodeBody) { code }: Static<typeof CodeBody>) {
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

let quoteTtl = 120;

@Flow.controller('quote', { ttl: () => quoteTtl, owner: 'guest' })
class QuoteFlow {
	@Flow.step({ next: ['confirm'] })
	public price(@Http.body(t.Object({ amount: t.Number() })) { amount }: { amount: number }) {
		return amount > 0
			? Result.pass(Flow.advance({ amount }, { amount }))
			: Result.fail(new ConflictError('The amount must be positive.'));
	}

	@Flow.step()
	public async confirm(@Flow.state() state: { amount: number }) {
		return AsyncResult.from(Promise.resolve(Result.pass({ confirmed: state.amount })));
	}
}

@Module.register({
	controllers: [SignUpFlow, ProfileFlow, PlanFlow, PinFlow, ClaimsFlow, QuoteFlow]
})
class FlowsModule extends Module {}

const makeApp = (store: FlowStore, openapi: false | object = false) => {
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
		openapi
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

	it('declares the response schemas of the start and state routes', () => {
		const routes = Http.describe(SignUpFlow)!.routes;
		const start = routes.find((route) => route.name === 'ariadne:start')!;
		const state = routes.find((route) => route.name === 'ariadne:state')!;
		expect(start).toMatchObject({ method: 'POST', status: 201, responds: true });
		expect(state).toMatchObject({ method: 'GET', responds: true });
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
		// A ttl given as a function is read when the flow runs.
		expect(() => declare({ ...base, ttl: () => 0 })).toThrow('unknown steps: y');
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

	it('documents the flow headers in OpenAPI', async () => {
		testing = await Application.testing({ app: makeApp(new MemoryFlowStore(), {}) });
		const { paths } = await (await testing.http.get('/openapi/json')).json();
		const headers = (operation: {
			parameters?: { in: string; name: string; required: boolean }[];
		}) =>
			Object.fromEntries(
				(operation.parameters ?? [])
					.filter((parameter) => parameter.in === 'header')
					.map((parameter) => [parameter.name, parameter.required])
			);

		expect(headers(paths['/flows/sign-up/email'].post)).toEqual({
			[FLOW_KEY_HEADER]: true,
			[FLOW_STEP_HEADER]: true,
			[FLOW_OWNER_HEADER]: false
		});
		expect(headers((paths['/flows/sign-up'] ?? paths['/flows/sign-up/']).get)).toEqual({
			[FLOW_KEY_HEADER]: false,
			[FLOW_OWNER_HEADER]: false
		});
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
		expect(bare.status).toBe(400);
		expect((await bare.clone().json()).code).toBe('BAD_REQUEST');
		expect((await bare.json()).errors.map((e: { pointer: string }) => e.pointer)).toEqual([
			`/headers/${FLOW_KEY_HEADER}`,
			`/headers/${FLOW_STEP_HEADER}`
		]);
		expect((await http.get('/flows/sign-up')).status).toBe(400);
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

describe('steps giving a Result, and a ttl read at run time', () => {
	let testing: TestingHttpApp | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
		quoteTtl = 120;
	});

	class TtlStore extends MemoryFlowStore {
		public readonly ttls: number[] = [];
		public override init(key: string, owner: string, ttlSeconds: number) {
			this.ttls.push(ttlSeconds);
			return super.init(key, owner, ttlSeconds);
		}
	}

	const quote = async (store: FlowStore) => {
		testing = await Application.testing({ app: makeApp(store) });
		const http = testing.http;
		const started = await http.post('/flows/quote');
		const { flowKey, owner } = await started.json();
		const step = (name: string, stepId: string, body: object = {}) =>
			http
				.post(`/flows/quote/${name}`)
				.header(FLOW_OWNER_HEADER, owner)
				.header(FLOW_KEY_HEADER, flowKey)
				.header(FLOW_STEP_HEADER, stepId)
				.json(body);
		return { http, started, step };
	};

	it('answers the value of a passed Result, and refuses the step on a failed one', async () => {
		const { step } = await quote(new MemoryFlowStore());

		const refused = await step('price', 's1', { amount: 0 });
		expect(refused.status).toBe(409);
		expect((await refused.json()).detail).toBe('The amount must be positive.');

		const priced = await step('price', 's2', { amount: 5 });
		expect(await priced.json()).toEqual({
			answer: { amount: 5 },
			nextSteps: ['confirm'],
			backSteps: []
		});
		expect(await (await step('confirm', 's3')).json()).toEqual({
			answer: { confirmed: 5 },
			nextSteps: [],
			backSteps: []
		});
	});

	it('reads a ttl given as a function each time a flow starts, and refuses a bad one', async () => {
		const store = new TtlStore();
		const { http } = await quote(store);
		quoteTtl = 30;
		expect((await http.post('/flows/quote')).status).toBe(201);
		expect(store.ttls).toEqual([120, 30]);

		quoteTtl = 0;
		expect((await http.post('/flows/quote')).status).toBe(500);
		expect(store.ttls).toEqual([120, 30]);
	});

	it('types the answer of a step that gives a Result', () => {
		expectTypeOf<FlowAnswer<ReturnType<QuoteFlow['price']>>>().toEqualTypeOf<{
			amount: number;
		}>();
		expectTypeOf<FlowAnswer<ReturnType<QuoteFlow['confirm']>>>().toEqualTypeOf<{
			confirmed: number;
		}>();
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

describe('FlowRouteTypes', () => {
	const types = new FlowRouteTypes();
	const routes = () => Http.describe(SignUpFlow)!.routes;
	const route = (name: string) => routes().find((r) => r.name === name)!;
	const ref = { method: "C['email']", parameter: (i: number) => `Parameters<C['email']>[${i}]` };

	it('types the routes of flow controllers only', () => {
		expect(types.supports(SignUpFlow)).toBe(true);
		expect(types.supports(class Other {})).toBe(false);
	});

	it('types the start and state routes, and the replies of the steps', () => {
		const from = (name: string) => [{ from: '@elysiumjs/ariadne', names: [name] }];
		expect(types.route(SignUpFlow, route('ariadne:start'), {})).toEqual({
			response: 'FlowStart',
			imports: from('FlowStart')
		});
		expect(types.route(SignUpFlow, route('ariadne:state'), {})).toEqual({
			response: 'FlowStatus',
			imports: from('FlowStatus')
		});
		expect(types.route(SignUpFlow, route('email'), ref)).toEqual({
			response: "FlowStepReply<ReturnType<C['email']>>",
			imports: from('FlowStepReply')
		});
		// Without a way to refer to the step method, its types stay unknown.
		expect(types.route(SignUpFlow, route('email'), {})).toBeUndefined();
	});

	it('answers what a step advances with or returns, without refusals and errors', () => {
		expectTypeOf<FlowAnswer<ReturnType<SignUpFlow['email']>>>().toEqualTypeOf<{
			sentTo: string;
		}>();
		expectTypeOf<FlowAnswer<ReturnType<SignUpFlow['code']>>>().toEqualTypeOf<{
			welcome: string | undefined;
			attempts: number;
			rewound: number;
		}>();
		expectTypeOf<FlowAnswer<Promise<void>>>().toEqualTypeOf<null>();
	});

	it('is a route types contributor active in development only', () => {
		expect(Service.tagsOf(FlowRouteTypes)).toContain(Http.RouteTypes);
		expect(Environments.isActive(FlowRouteTypes, 'development')).toBe(true);
		expect(Environments.isActive(FlowRouteTypes, 'production')).toBe(false);
	});
});
