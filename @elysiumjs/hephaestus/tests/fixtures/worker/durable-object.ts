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
// A Worker entry that exports a Durable Object class, as `@elysiumjs/ariadne-workers` asks.
import { DurableObject } from 'cloudflare:workers';
import { Elysia } from 'elysia';

export class Counter extends DurableObject {
	public count(): number {
		return 1;
	}
}

export const app = new Elysia().get('/', () => 'ok');

export default { fetch: (request: Request) => app.fetch(request) };
