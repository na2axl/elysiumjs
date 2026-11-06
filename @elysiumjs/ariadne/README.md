# @elysiumjs/ariadne

Multi-step flows for [Elysium.js](../core) apps, such as a sign-up with a code check or a checkout. The state of a flow stays on the server between steps, and each step runs once: a repeated step id replays the stored answer.

## Installation

```bash
bun add @elysiumjs/ariadne
```

## Declaring a flow

A flow is a controller. Each step is a `POST` route of it, so the `@Http.*()` parameter decorators work on a step like on any route.

```ts
import { Flow } from '@elysiumjs/ariadne';
import { DomainError, Http, t } from '@elysiumjs/core';

type SignUp = { email?: string; attempts: number };

const EmailBody = t.Object({ email: t.String({ format: 'email' }) });
const CodeBody = t.Object({ code: t.String() });

@Flow.controller({ name: 'sign-up', ttl: 900, owner: 'guest' })
export class SignUpFlow {
	constructor(
		private readonly codes: CodeService,
		private readonly users: UserService
	) {}

	@Flow.initial()
	public initial(): SignUp {
		return { attempts: 0 };
	}

	@Flow.step({ next: ['code'], back: ['email'] })
	public async email(
		@Http.body(EmailBody) { email }: typeof EmailBody.static,
		@Flow.state() state: SignUp
	) {
		await this.codes.send(email);
		return Flow.advance({ ...state, email }, { sentTo: email });
	}

	@Flow.step()
	public async code(
		@Http.body(CodeBody) { code }: typeof CodeBody.static,
		@Flow.state() state: SignUp
	) {
		if (!(await this.codes.check(state.email!, code))) {
			const attempts = state.attempts + 1;
			return Flow.refuse({ ...state, attempts }, DomainError.badRequest('Wrong code.'), {
				end: attempts >= 3
			});
		}
		return { userId: await this.users.create(state.email!) };
	}
}
```

- `next` lists the steps that may follow the step, or is a function of the state the step produced. The flow ends when it gives no step, which is the default.
- `back` lists the earlier steps the client may submit again from there, and `onRewind(state, ctx)` runs on the state of a step submitted again.
- `start` lists the steps accepted first, and defaults to the first declared step. `name` names a step after something other than its method.
- `@Flow.initial()` marks the method that builds the state before the first step. Without one, the state starts as `{}`.
- `@Flow.state()` injects the state, and `@Flow.context()` the flow, its key, the step id and the owner.
- `Flow.advance(state, answer)` moves the flow forward. A step that returns anything else answers it and keeps the state.
- `Flow.refuse(state, error)` refuses the step but keeps its state, such as a counted attempt. With `{ end: true }`, the flow is deleted.
- A step that throws commits nothing, and the client may retry the same step id.

The other options of `@Http.controller()` apply to `@Flow.controller()`, and those of the route decorators to `@Flow.step()`. Guards, rate limits, interceptors and filters decorate a flow like any controller.

## Serving flows

```ts
import { AriadneModule } from '@elysiumjs/ariadne';
import { RedisFlowStore } from '@elysiumjs/ariadne-redis';
import { Application, Module } from '@elysiumjs/core';

@Module.register({ controllers: [SignUpFlow, ChangeEmailFlow] })
class AccountModule extends Module {}

@Application.register({
	modules: [
		AriadneModule.with({ store: new RedisFlowStore({ connection: () => Redis.connection() }) }),
		AccountModule
	]
})
class App extends Application {}
```

A flow answers under `path`, which defaults to `/flows/{name}`:

| Route                       | Headers                     | Answer                                            |
| --------------------------- | --------------------------- | ------------------------------------------------- |
| `POST /flows/{flow}`        |                             | 201 `{ flowKey, owner?, nextSteps, backSteps }`   |
| `GET /flows/{flow}`         | `x-flow-key`                | `{ flowKey, step, nextSteps, backSteps, answer }` |
| `POST /flows/{flow}/{step}` | `x-flow-key`, `x-flow-step` | `{ answer, nextSteps, backSteps }`                |

- `x-flow-step` is the id of the submission, which the client picks and sends again to retry it.
- A `guest` flow belongs to the `owner` token answered at start. Later calls send it in the `x-flow-owner` header.
- A `user` flow belongs to the signed-in user, so its controller needs a guard, such as `@Auth()` from themis. `user` in the module options reads the user id from the context (the `id` of `currentUser` by default, which `@Auth()` sets).

The routes answer problems:

- 410 when the flow expired, or is finished;
- 409 for a step the flow does not accept now (with `nextSteps`, `backSteps` and the last `answer`), and for a step another request is running;
- 403 when the caller does not own the flow, and 401 for a user flow without a user;
- 422 for a body that does not match the step's schema, or a request without `x-flow-key` or `x-flow-step`.

## Stores

- `MemoryFlowStore`, for tests and single-process apps.
- `RedisFlowStore` of [`@elysiumjs/ariadne-redis`](../ariadne-redis), whose claims and commits are Lua scripts run with `EVAL`, which Upstash runs too.
- `durableFlowStore` of [`@elysiumjs/ariadne-workers`](../ariadne-workers), a Durable Object per flow on Cloudflare Workers.

A finished flow keeps its last answer replayable for up to 10 minutes. Then only its owner and end time stay, for its TTL, so that a late call learns that the flow is finished. A custom store implements `FlowStore`, and can follow `FlowRules` to answer like the others.
