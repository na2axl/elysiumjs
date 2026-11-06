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

// The app the minified build check bundles: services by class, by name, by parameter type, and
// request-scoped, across two modules. It exits with an error when a service does not resolve.

import {
	Application,
	Http,
	HttpControllerScope,
	Module,
	Service,
	ServiceScope
} from '../../src/index';

@Service.register()
export class ClockService {
	public now() {
		return 42;
	}
}

@Service.register({ name: 'greeting' })
export class GreetingService {
	public greet(name: string) {
		return `hello ${name}`;
	}
}

@Service.register()
export class ReportService {
	constructor(
		@Service.inject(ClockService) private readonly clock: ClockService,
		@Service.inject('greeting') private readonly greeting: GreetingService
	) {}

	public report(name: string) {
		return `${this.greeting.greet(name)} at ${this.clock.now()}`;
	}
}

let requests = 0;

@Service.register({ scope: ServiceScope.REQUEST })
export class RequestState {
	public readonly id = ++requests;
}

@Module.register({ services: [ClockService, GreetingService], exports: [ClockService, 'greeting'] })
export class SharedModule extends Module {}

@Http.controller('/report', { scope: HttpControllerScope.REQUEST })
export class ReportController {
	constructor(
		// Resolved from the parameter type, which the bundler keeps as a class reference.
		@Service.inject() private readonly reports: ReportService,
		@Service.inject(RequestState) private readonly state: RequestState
	) {}

	@Http.get()
	public show(@Service.inject(RequestState) state: RequestState) {
		return { text: this.reports.report('ada'), sameState: state === this.state, id: state.id };
	}
}

@Module.register({
	imports: [SharedModule],
	services: [ReportService, RequestState],
	controllers: [ReportController]
})
export class ReportModule extends Module {}

const runtime = {
	name: 'minified-check',
	env: () => process.env,
	sleep: async () => {},
	serve() {},
	exit() {},
	onShutdown: () => () => {},
	argv: () => [] as string[],
	write() {},
	terminal: () => undefined
};

@Application.register({ runtime, modules: [ReportModule], openapi: false })
export class MinifiedApp extends Application {}

const fail = (message: string): never => {
	console.error(message);
	process.exit(1);
};

const app = new MinifiedApp();
const server = await app.build();
const [first, second] = await Promise.all(
	[0, 1].map(async () => {
		const response = await server.handle(new Request('http://localhost/report'));
		if (response.status !== 200)
			fail(`GET /report answered ${response.status}: ${await response.text()}`);
		return (await response.json()) as { text: string; sameState: boolean; id: number };
	})
);

if (first.text !== 'hello ada at 42') fail(`Unexpected report: ${first.text}`);
if (!first.sameState || !second.sameState) fail('A request saw two request-scoped instances.');
if (first.id === second.id) fail('Two requests shared a request-scoped instance.');

await app.kernel.shutdown();
console.log(
	`Resolved every service in the minified build (${ClockService.name} is ${JSON.stringify(ClockService.name)}).`
);
