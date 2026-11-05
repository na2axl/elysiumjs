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

		it('refuses a singleton above a factory before building the request-scoped service', async () => {
			let built = 0;

			@Service.register({ scope: ServiceScope.REQUEST })
			class Opened {
				public async onInit() {
					built++;
				}
			}
			@Service.register({ scope: ServiceScope.FACTORY })
			class Middle {
				constructor(@Service.inject(Opened) public opened: Opened) {}
			}
			@Service.register()
			class Holder {
				constructor(@Service.inject(Middle) public middle: Middle) {}
			}
			for (const cls of [Opened, Middle, Holder]) Container.register(null, cls, undefined);

			await Service.runInRequestScope(async () => {
				await expect(Service.resolve(Holder)).rejects.toBeInstanceOf(ScopeMismatchError);
			});
			expect(built).toBe(0);
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

		describe('disposal', () => {
			const log: string[] = [];

			@Service.register({ scope: ServiceScope.REQUEST })
			class B {
				public onDestroy() {
					log.push('B');
				}
			}

			@Service.register({ scope: ServiceScope.REQUEST })
			class A {
				constructor(@Service.inject(B) public b: B) {}

				public onDestroy() {
					log.push('A');
				}
			}

			beforeEach(() => {
				log.length = 0;
				Container.register(null, B, undefined);
				Container.register(null, A, undefined);
			});

			it('destroys request instances in reverse order when an unkeyed scope ends', async () => {
				await Service.runInRequestScope(async () => Service.resolve(A));
				expect(log).toEqual(['A', 'B']);
			});

			it('destroys them even when the work throws', async () => {
				await expect(
					Service.runInRequestScope(async () => {
						await Service.resolve(A);
						throw new Error('boom');
					})
				).rejects.toThrow('boom');
				expect(log).toEqual(['A', 'B']);
			});

			it('does not dispose a joined outer scope from a nested run', async () => {
				await Service.runInRequestScope(async () => {
					await Service.resolve(A);
					await Service.runInRequestScope(async () => Service.resolve(A));
					expect(log).toEqual([]);
				});
				expect(log).toEqual(['A', 'B']);
			});

			it('disposes a keyed scope once, through disposeRequestScope', async () => {
				const key = {};
				await Container.runInRequestScope(async () => Service.resolve(A), key);
				expect(log).toEqual([]);
				await Container.disposeRequestScope(key);
				await Container.disposeRequestScope(key);
				expect(log).toEqual(['A', 'B']);
			});
		});
	});

	describe('async onInit', () => {
		let inits = 0;
		let failuresLeft = 0;

		@Service.register({ scope: ServiceScope.REQUEST })
		class Tx {
			public ready = false;

			public async onInit() {
				inits++;
				await tick();
				if (failuresLeft > 0) {
					failuresLeft--;
					throw new Error('tx failed');
				}
				this.ready = true;
			}
		}

		@Service.register({ scope: ServiceScope.REQUEST })
		class Repo {
			constructor(@Service.inject(Tx) public tx: Tx) {}
		}

		@Service.register({ scope: ServiceScope.FACTORY })
		class Flaky {
			public async onInit() {
				await tick();
				throw new Error('flaky failed');
			}
		}

		const unhandled: unknown[] = [];
		const onUnhandled = (error: unknown) => unhandled.push(error);

		beforeEach(() => {
			inits = 0;
			failuresLeft = 0;
			unhandled.length = 0;
			process.on('unhandledRejection', onUnhandled);
			for (const cls of [Tx, Repo, Flaky]) Container.register(null, cls, undefined);
		});
		afterEach(() => {
			process.off('unhandledRejection', onUnhandled);
		});

		it('resolves a request-scoped service whose onInit is async, then serves it synchronously', async () => {
			await Service.runInRequestScope(async () => {
				const tx = await Service.resolve(Tx);
				expect(tx.ready).toBe(true);
				expect(Service.get(Tx)).toBe(tx);
			});
		});

		it('injects it into a request-scoped dependant through Service.resolve', async () => {
			await Service.runInRequestScope(async () => {
				const repo = await Service.resolve(Repo);
				expect(repo.tx.ready).toBe(true);
				expect(repo.tx).toBe(Service.get(Tx)!);
			});
		});

		it('shares one onInit between concurrent resolutions in one request', async () => {
			await Service.runInRequestScope(async () => {
				const [a, b] = await Promise.all([Service.resolve(Tx), Service.resolve(Tx)]);
				expect(a).toBe(b);
				expect(inits).toBe(1);
			});
		});

		it('rethrows a failing onInit to the caller, then retries on the next resolve', async () => {
			failuresLeft = 1;
			await Service.runInRequestScope(async () => {
				await expect(Service.resolve(Tx)).rejects.toThrow('tx failed');
				const tx = await Service.resolve(Tx);
				expect(tx.ready).toBe(true);
				expect(inits).toBe(2);
			});
			await tick();
			expect(unhandled).toEqual([]);
		});

		it('rethrows a failing factory onInit without an unhandled rejection', async () => {
			await expect(Service.resolve(Flaky)).rejects.toThrow('flaky failed');
			await tick();
			expect(unhandled).toEqual([]);
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

		it('injects an async request-scoped service into a request-scoped controller and a route parameter', async () => {
			@Service.register({ scope: ServiceScope.REQUEST })
			class Session {
				public ready = false;

				public async onInit() {
					await tick();
					this.ready = true;
				}
			}

			@Http.controller({ path: '/session', scope: HttpControllerScope.REQUEST })
			class SessionController {
				constructor(@Service.inject(Session) public session: Session) {}

				@Http.get()
				public show(@Service.inject(Session) session: Session) {
					return { ctor: this.session.ready, param: session.ready, same: session === this.session };
				}
			}

			const { instance, app } = await build(SessionController, [Session]);
			const response = await app.handle(new Request('http://localhost/session'));
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ ctor: true, param: true, same: true });
			await instance.kernel.shutdown();
		});

		it('builds a factory service once for a route parameter, with its onInit done', async () => {
			let built = 0;

			@Service.register({ scope: ServiceScope.FACTORY })
			class Made {
				public readonly id = ++built;
				public ready = false;

				public async onInit() {
					await tick();
					this.ready = true;
				}
			}

			@Http.controller({ path: '/made' })
			class MadeController {
				@Http.get()
				public show(@Service.inject(Made) made: Made) {
					return { id: made.id, ready: made.ready };
				}
			}

			const { instance, app } = await build(MadeController, [Made]);
			const response = await app.handle(new Request('http://localhost/made'));
			expect(await response.json()).toEqual({ id: 1, ready: true });
			expect(built).toBe(1);
			await instance.kernel.shutdown();
		});

		it('still injects null for a route parameter whose service is not registered', async () => {
			@Http.controller({ path: '/missing' })
			class MissingController {
				@Http.get()
				public show(@Service.inject('missing.service') missing: unknown) {
					return { missing };
				}
			}

			const { instance, app } = await build(MissingController);
			const response = await app.handle(new Request('http://localhost/missing'));
			expect(await response.json()).toEqual({ missing: null });
			await instance.kernel.shutdown();
		});

		it('runs the onRequest hook of a request-scoped controller once its services are ready', async () => {
			@Service.register({ scope: ServiceScope.REQUEST })
			class Session {
				public ready = false;

				public async onInit() {
					await tick();
					this.ready = true;
				}
			}

			const seen: boolean[] = [];

			@Http.controller({ path: '/hooked', scope: HttpControllerScope.REQUEST })
			class HookedController {
				constructor(@Service.inject(Session) public session: Session) {}

				@Http.onRequest()
				public check() {
					seen.push(this.session.ready);
				}

				@Http.get()
				public show() {
					return 'ok';
				}
			}

			const { instance, app } = await build(HookedController, [Session]);
			const response = await app.handle(new Request('http://localhost/hooked'));
			expect(response.status).toBe(200);
			expect(seen).toEqual([true]);
			await instance.kernel.shutdown();
		});

		it('destroys request instances after the response, also when the handler throws', async () => {
			const destroyed: string[] = [];

			@Service.register({ scope: ServiceScope.REQUEST })
			class Inner {
				public onDestroy() {
					destroyed.push('Inner');
				}
			}
			@Service.register({ scope: ServiceScope.REQUEST })
			class Outer {
				constructor(@Service.inject(Inner) public inner: Inner) {}

				public onDestroy() {
					destroyed.push('Outer');
				}
			}

			@Http.controller({ path: '/dispose' })
			class DisposeController {
				@Http.get({ path: '/ok' })
				public ok(@Service.inject(Outer) outer: Outer) {
					return { ok: !!outer };
				}

				@Http.get({ path: '/fail' })
				public fail(@Service.inject(Outer) _outer: Outer) {
					throw new Error('handler failed');
				}
			}

			const { instance, app } = await build(DisposeController, [Inner, Outer]);
			const ok = await app.handle(new Request('http://localhost/dispose/ok'));
			const failed = await app.handle(new Request('http://localhost/dispose/fail'));
			await tick();

			expect(ok.status).toBe(200);
			expect(failed.status).toBe(500);
			expect(destroyed).toEqual(['Outer', 'Inner', 'Outer', 'Inner']);
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
