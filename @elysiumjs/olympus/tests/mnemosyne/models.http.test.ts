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

import { afterEach, beforeAll, describe, expect, it } from 'bun:test';

import { Application, Http, Module, Runtime, t } from '../../src/index';
import { CacheInterceptor, MemoryModel, MnemosyneModule } from '../../src/mnemosyne';

type Note = { id: string; text: string; token: string };

class NoteModel extends MemoryModel<Note>('http-notes') {
	public static override readonly hidden = ['token'] as const;
	public static override readonly appends = ['length'] as const;

	public get length(): number {
		return this.text.length;
	}
}

const note = () => NoteModel.hydrate({ id: 'n1', text: 'hello', token: 'secret' });
let calls = 0;

@Http.controller('/notes')
class NoteController {
	@Http.get('/plain')
	public plain() {
		return note();
	}

	@Http.get('/resource', {
		response: t.Object({ id: t.String(), text: t.String(), length: t.Integer() })
	})
	public resource() {
		return note();
	}

	@Http.get('/cached', { interceptors: [CacheInterceptor.with({ ttl: 60_000 })] })
	public cached() {
		calls++;
		return note();
	}
}

@Module.register({ controllers: [NoteController] })
class NoteModule extends Module {}

@Application.register({ modules: [MnemosyneModule, NoteModule], openapi: false })
class NoteApp extends Application {}

describe('Model instances over HTTP', () => {
	beforeAll(() => {
		Runtime.use({
			name: 'test',
			env: () => ({ NODE_ENV: 'test' }),
			sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
			serve: () => {},
			exit: () => {},
			argv: () => [],
			write: () => {},
			terminal: () => undefined,
			onShutdown: () => () => {}
		});
	});

	let testing: { shutdown(): Promise<void>; http: any } | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	it('answers the JSON form of an instance: columns and appends, without hidden columns', async () => {
		testing = await Application.testing({ app: NoteApp });
		const response = await testing.http.get('/notes/plain');
		expect(await response.json()).toEqual({ id: 'n1', text: 'hello', length: 5 });
	});

	it('answers an instance through a response schema', async () => {
		testing = await Application.testing({ app: NoteApp });
		const response = await testing.http.get('/notes/resource');
		expect(await response.json()).toEqual({ id: 'n1', text: 'hello', length: 5 });
	});

	it('serves a cached instance', async () => {
		testing = await Application.testing({ app: NoteApp });
		await testing.http.get('/notes/cached');
		const second = await testing.http.get('/notes/cached');
		expect(second.headers.get('x-cache')).toBe('hit');
		expect(await second.json()).toEqual({ id: 'n1', text: 'hello', length: 5 });
		expect(calls).toBe(1);
	});
});
