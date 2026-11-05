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

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { Application } from '../src/app';
import { Container } from '../src/container';
import { ElysiumError, OutsideRequestScopeError, ScopeMismatchError } from '../src/errors';
import { Http, HttpControllerScope } from '../src/http';
import { Module } from '../src/module';
import { Service, ServiceScope } from '../src/service';

const reset = () => {
	Container.reset();
	Container.setVisibility(null);
	Container.setModuleInitHook(null);
	Container.setSkippedLookup(null);
};

describe('Request scope', () => {
	beforeEach(reset);
	afterEach(reset);

	let counter = 0;

	@Service.register({ scope: ServiceScope.REQUEST })
	class RequestState {
		public readonly id = ++counter;
	}

	const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

	describe('container', () => {
		it('shares one instance within a scope, including across awaits', async () => {
			Container.register(null, RequestState, undefined);

			const [first, second] = await Promise.all(
				[0, 1].map(() =>
					Service.runInRequestScope(async () => {
						const before = Service.get(RequestState);
						await tick();
						expect(Service.get(RequestState)).toBe(before);
						return before;
					})
				)
			);

			expect(first).toBeInstanceOf(RequestState);
			expect(first).not.toBe(second);
		});

		it('joins the enclosing scope, and shares a scope per key', () => {
			Container.register(null, RequestState, undefined);
			const key = {};

			const outer = Service.runInRequestScope(() => [
				Service.get(RequestState),
				Service.runInRequestScope(() => Service.get(RequestState))
			]);
			expect(outer[0]).toBe(outer[1]);

			const a = Container.runInRequestScope(() => Service.get(RequestState), key);
			const b = Container.runInRequestScope(() => Service.get(RequestState), key);
			const c = Container.runInRequestScope(() => Service.get(RequestState), {});
			expect(a).toBe(b);
			expect(c).not.toBe(a);
		});

		it('throws when resolved outside a request', () => {
			Container.register(null, RequestState, undefined);
			expect(Container.inRequestScope()).toBe(false);
			expect(() => Service.get(RequestState)).toThrow(OutsideRequestScopeError);
			expect(Service.runInRequestScope(() => Container.inRequestScope())).toBe(true);
		});

		it('refuses a singleton that depends on a request-scoped service', () => {
			@Service.register()
			class Captive {
				constructor(@Service.inject(RequestState) public state: RequestState) {}
			}
			Container.register(null, RequestState, undefined);
			Container.register(null, Captive, undefined);

			expect(() => Service.runInRequestScope(() => Service.get(Captive))).toThrow(
				ScopeMismatchError
			);
			expect(() => Service.runInRequestScope(() => Service.bind(Captive))).toThrow(
				ScopeMismatchError
			);
		});

		it('lets request-scoped and factory services depend on request-scoped ones', () => {
			@Service.register({ scope: ServiceScope.REQUEST })
			class PerRequest {
				constructor(@Service.inject(RequestState) public state: RequestState) {}
			}
			@Service.register({ scope: ServiceScope.FACTORY })
			class PerCall {
				constructor(@Service.inject(RequestState) public state: RequestState) {}
			}
			for (const cls of [RequestState, PerRequest, PerCall]) {
				Container.register(null, cls, undefined);
			}

			Service.runInRequestScope(() => {
				const state = Service.get(RequestState);
				expect(Service.get(PerRequest)!.state).toBe(state);
				expect(Service.get(PerCall)!.state).toBe(state);
			});
		});
	});

	describe('inject', () => {
		it('injects by class when no token is given', () => {
			class Dep {}
			class Consumer {
				constructor(@Service.inject(Dep) public dep: Dep) {}
			}
			const dep = Service.bind(Dep);
			expect(Service.make(Consumer).dep).toBe(dep);
		});

		it('throws when the service cannot be told from the parameter', () => {
			expect(() => {
				class Consumer {
					constructor(@Service.inject() public dep: any) {}
				}
				return Consumer;
			}).toThrow(ElysiumError);
		});
	});

	describe('http', () => {
		const build = async (controller: Function, services: Function[] = [RequestState]) => {
			@Module.register({ services: services as any, controllers: [controller as any] })
			class RequestModule extends Module {}

			@Application.register({ modules: [RequestModule], openapi: false })
			class RequestApp extends Application {}

			const instance = new RequestApp();
			return { instance, app: await instance.build() };
		};

		it('gives each request its own instance, shared by the controller and the handler', async () => {
			@Http.controller({ path: '/state', scope: HttpControllerScope.REQUEST })
			class StateController {
				constructor(@Service.inject(RequestState) public state: RequestState) {}

				@Http.get()
				public async show(@Service.inject(RequestState) state: RequestState) {
					await tick();
					return { same: state === this.state, id: state.id };
				}
			}

			const { instance, app } = await build(StateController);
			const [first, second] = await Promise.all([
				app.handle(new Request('http://localhost/state')).then((r) => r.json()),
				app.handle(new Request('http://localhost/state')).then((r) => r.json())
			]);

			expect(first.same).toBe(true);
			expect(second.same).toBe(true);
			expect(first.id).not.toBe(second.id);
			await instance.kernel.shutdown();
		});

		it('fails a server-scoped controller that depends on a request-scoped service', async () => {
			@Http.controller({ path: '/captive' })
			class CaptiveController {
				constructor(@Service.inject(RequestState) public state: RequestState) {}

				@Http.get()
				public show() {
					return this.state.id;
				}
			}

			const { instance, app } = await build(CaptiveController);
			const response = await app.handle(new Request('http://localhost/captive'));
			expect(response.status).toBe(500);
			await instance.kernel.shutdown();
		});
	});
});
