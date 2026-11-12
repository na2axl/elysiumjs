// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

// A Node.js server entry for the NodeBuilder tests: a controller whose service is injected by
// its constructor type, which needs the decorator metadata emitted at build time.
import { runtime } from '@elysiumjs/node';
import { Application, Http, Module, Service } from '@elysiumjs/olympus';

@Service.register()
class Greeter {
	public greet(name: string) {
		return `Hello, ${name}`;
	}
}

@Http.controller('/greet')
class GreetController {
	constructor(@Service.inject() private readonly greeter: Greeter) {}

	@Http.get('/:name')
	public show(@Http.context() c: { params: { name: string } }) {
		return { message: this.greeter.greet(c.params.name), runtime: typeof Bun };
	}
}

@Module.register({ controllers: [GreetController], services: [Greeter] })
class GreetModule extends Module {}

@Application.register({ runtime, modules: [GreetModule], openapi: false })
class App extends Application {}

await new App().run(['serve']);
console.log('listening');
