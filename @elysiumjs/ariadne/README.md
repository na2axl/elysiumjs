# @elysiumjs/ariadne

Multi-step flows for [Elysium.js](../core) apps, such as a sign-up with a code check or a checkout. The state of a flow stays on the server between steps, and each step runs once: a repeated step id replays the stored answer.

## Installation

```bash
bun add @elysiumjs/ariadne
```

## Declaring a flow

```ts
import { Flow } from '@elysiumjs/ariadne';
import { DomainError, t } from '@elysiumjs/core';

export const signUp = Flow.define({
	name: 'sign-up',
	ttlSeconds: 900,
	owner: 'guest',
	initial: () => ({ attempts: 0 }),
	steps: {
		email: {
			body: t.Object({ email: t.String({ format: 'email' }) }),
			next: () => ['code'],
			back: ['email'],
			run: async (ctx, state, { email }) => {
				await codes.send(email);
				return { state: { ...state, email }, answer: { sentTo: email } };
			}
		},
		code: {
			body: t.Object({ code: t.String() }),
			next: () => [],
			run: async (ctx, state, { code }) => {
				if (!(await codes.check(state.email, code))) {
					const attempts = state.attempts + 1;
					return Flow.refuse({ ...state, attempts }, DomainError.badRequest('Wrong code.'), {
						end: attempts >= 3
					});
				}
				return { state, answer: { userId: await users.create(state.email) }, terminal: true };
			}
		}
	}
});
```

- `next(state)` lists the steps that may follow the step, and `back` the earlier steps the client may submit again from there. `onRewind` runs on the state of a step submitted again.
- `start` lists the steps accepted first, and defaults to the first declared step.
- A step that returns or throws an error commits nothing, and the client may retry the same step id.
- `Flow.refuse(state, error)` refuses the step but keeps its state, such as a counted attempt. With `{ end: true }`, the flow is deleted.
- A step whose result has `terminal: true` ends the flow.

## Serving flows

```ts
import { AriadneModule, RedisFlowStore } from '@elysiumjs/ariadne';
import { Application } from '@elysiumjs/core';
import { Auth } from '@elysiumjs/themis';

@Application.register({
	modules: [
		AriadneModule.with({
			flows: [signUp, changeEmail],
			store: new RedisFlowStore({ connection: () => Redis.connection() }),
			authenticate: Auth(),
			admit: ({ request }) => limiter.check(request)
		})
	]
})
class App extends Application {}
```

Each flow gets three routes under `prefix` (`flows` by default):

| Route                        | Body                           | Answer                                            |
| ---------------------------- | ------------------------------ | ------------------------------------------------- |
| `POST /flows/{flow}`         |                                | 201 `{ flowKey, owner?, nextSteps, backSteps }`   |
| `GET /flows/{flow}?flowKey=` |                                | `{ flowKey, step, nextSteps, backSteps, answer }` |
| `POST /flows/{flow}/{step}`  | `{ flowKey, stepId, ...body }` | `{ answer, nextSteps, backSteps }`                |

- A `guest` flow belongs to the `owner` token answered at start. Later calls send it in the `x-flow-owner` header.
- A `user` flow belongs to the signed-in user. `authenticate` decorates its routes, and `user` reads the user id from the context (the `id` of `currentUser` by default, which `@Auth()` sets).
- `admit` runs before a flow starts and before its state is read. A returned error is the answer.

The routes answer problems:

- 410 when the flow expired, or is finished;
- 409 for a step the flow does not accept now (with `nextSteps`, `backSteps` and the last `answer`), and for a step another request is running;
- 403 when the caller does not own the flow, and 401 for a user flow without a user;
- 422 for a body that does not match the step's schema, or misses `flowKey` or `stepId`.

## Stores

- `MemoryFlowStore`, for tests and single-process apps.
- `RedisFlowStore`, whose claims and commits are Lua scripts run with `EVAL`, which Upstash runs too.
- `durableFlowStore` of [`@elysiumjs/ariadne-workers`](../ariadne-workers), a Durable Object per flow on Cloudflare Workers.

A finished flow keeps its last answer replayable for up to 10 minutes. Then only its owner and end time stay, for its TTL, so that a late call learns that the flow is finished. A custom store implements `FlowStore`, and can follow `FlowRules` to answer like the others.
