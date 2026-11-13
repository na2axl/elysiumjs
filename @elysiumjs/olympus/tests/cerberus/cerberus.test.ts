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
import type { AbilityRules, GrantRule, VersionedFacts } from '../../src/cerberus';
import type { TestingHttpApp } from '../../src/index';

import { afterEach, describe, expect, it } from 'bun:test';

import {
	Abilities,
	Cerberus,
	CerberusModule,
	CerberusUnavailableError,
	detectSubjectType,
	InvalidAbilityDomainError,
	UnknownSubjectTypeError
} from '../../src/cerberus';
import { Application, Http, Module } from '../../src/index';
import { MnemosyneModule } from '../../src/mnemosyne';

type TestFacts = { userId: string; roles: string[] };

class Post {
	public static readonly subjectName = 'Post';

	constructor(
		public readonly authorId: string,
		public readonly status: string
	) {}
}

@Abilities.rules('posts')
class PostRules implements AbilityRules {
	public define(facts: Record<string, unknown>, can: GrantRule) {
		const { userId } = facts as TestFacts;
		can('read', 'Post', { status: 'published' });
		can('update', 'Post', { authorId: userId });
	}
}

@Abilities.rules('staff')
class StaffRules implements AbilityRules {
	public define(facts: Record<string, unknown>, can: GrantRule, cannot: GrantRule) {
		const { roles } = facts as TestFacts;
		if (roles.includes('admin')) can('manage', 'all');
		cannot('delete', 'Post', { status: 'published' });
	}
}

@Module.register({ services: [PostRules] })
class PostsModule extends Module {}

@Module.register({ services: [StaffRules] })
class StaffModule extends Module {}

@Http.controller('/posts')
class PostsController {
	@Http.get('/')
	@Cerberus.can('read', 'Post')
	public list() {
		return { ok: true };
	}

	@Http.post('/')
	@Cerberus.can('create', 'Post')
	public async create() {
		await Cerberus.ability();
		return { ok: true };
	}

	@Http.get('/guest')
	@Cerberus.cannot('manage', 'all')
	public guest() {
		return { ok: true };
	}
}

@Module.register({ controllers: [PostsController] })
class HttpModule extends Module {}

/** A cache over a map, as the configuration of CerberusModule takes one. */
const mapCache = () => {
	const entries = new Map<string, unknown>();
	return {
		entries,
		cache: {
			get: async (key: string) => entries.get(key),
			set: async (key: string, value: unknown) => {
				entries.set(key, value);
				return value;
			},
			del: async (key: string) => entries.delete(key)
		} as never
	};
};

describe('cerberus', () => {
	let testing: TestingHttpApp | undefined;
	const people: Record<string, VersionedFacts> = {};
	let reads = 0;

	const boot = async (options: { cache?: false | (() => never); mnemosyne?: boolean } = {}) => {
		reads = 0;
		people.ada = { version: 1, facts: { userId: 'ada', roles: [] } };
		people.root = { version: 1, facts: { userId: 'root', roles: ['admin'] } };
		@Application.register({
			modules: [
				...(options.mnemosyne ? [MnemosyneModule] : []),
				CerberusModule.with({
					facts: (id) => {
						reads += 1;
						return people[id] ?? null;
					},
					actor: () => Http.currentContext()?.request.headers.get('x-user') ?? undefined,
					...(options.cache !== undefined && { cache: options.cache })
				}),
				PostsModule,
				StaffModule,
				HttpModule
			],
			openapi: false
		})
		class App extends Application {}
		testing = await Application.testing({ app: App, boot: 'eager' });
	};

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	it('composes the rules of every domain over the facts', async () => {
		await boot();
		expect(Abilities.domains()).toEqual(['posts', 'staff']);
		const ada = Abilities.compose({ userId: 'ada', roles: [] });
		expect(ada.can('update', new Post('ada', 'draft'))).toBe(true);
		expect(ada.can('update', new Post('bob', 'draft'))).toBe(false);
		expect(ada.can('read', Abilities.subject('Post', { status: 'published' }))).toBe(true);
		const root = Abilities.compose({ userId: 'root', roles: ['admin'] });
		expect(root.can('delete', new Post('bob', 'draft'))).toBe(true);
		expect(root.can('delete', new Post('bob', 'published'))).toBe(false);
	});

	it('builds the ability of rules alone', () => {
		const ability = Abilities.from<TestFacts>(new PostRules() as never)({
			userId: 'ada',
			roles: []
		});
		expect(ability.can('update', new Post('ada', 'draft'))).toBe(true);
		const inline = Abilities.from<TestFacts>((facts, can) => can('read', 'Post'))({
			userId: 'ada',
			roles: []
		});
		expect(inline.can('read', 'Post')).toBe(true);
	});

	it('packs and unpacks an ability', async () => {
		await boot();
		const ability = Abilities.compose({ userId: 'ada', roles: [] });
		const packed = Abilities.pack(ability);
		expect(JSON.parse(JSON.stringify(packed))).toEqual(packed);
		const unpacked = Abilities.unpack(packed);
		expect(unpacked.can('update', new Post('ada', 'draft'))).toBe(true);
		expect(unpacked.can('update', new Post('bob', 'draft'))).toBe(false);
	});

	it('detects subject types without class names', () => {
		expect(detectSubjectType('Post')).toBe('Post');
		expect(detectSubjectType(new Post('a', 'draft'))).toBe('Post');
		expect(detectSubjectType(Abilities.subject('Comment', {}))).toBe('Comment');
		expect(() => detectSubjectType({})).toThrow(UnknownSubjectTypeError);
		expect(() => Abilities.rules('Not Kebab')).toThrow(InvalidAbilityDomainError);
	});

	it('caches abilities per version of the facts and fingerprint of the rules', async () => {
		const { cache, entries } = mapCache();
		await boot({ cache: () => cache });
		const fingerprint = await Abilities.fingerprint();
		expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
		expect(await Abilities.fingerprint()).toBe(fingerprint);

		expect((await Abilities.of('ada'))?.can('update', new Post('ada', 'draft'))).toBe(true);
		expect(entries.get('cerberus:ability:ada')).toMatchObject({ version: 1, fingerprint });
		const kept = entries.get('cerberus:ability:ada');
		await Abilities.of('ada');
		expect(entries.get('cerberus:ability:ada')).toBe(kept);

		// A fact changed: the new version builds the ability again.
		people.ada = { version: 2, facts: { userId: 'ada', roles: ['admin'] } };
		expect((await Abilities.of('ada'))?.can('delete', new Post('bob', 'draft'))).toBe(true);
		expect(entries.get('cerberus:ability:ada')).toMatchObject({ version: 2 });

		// A cached ability of other rules is never served.
		entries.set('cerberus:ability:ada', { version: 2, fingerprint: 'other', rules: [] });
		expect((await Abilities.of('ada'))?.can('delete', new Post('bob', 'draft'))).toBe(true);

		await Abilities.forget('ada');
		expect(entries.has('cerberus:ability:ada')).toBe(false);
		expect(await Abilities.of('nobody')).toBeUndefined();
	});

	it('caches in the memory cache of MnemosyneModule by default', async () => {
		await boot({ mnemosyne: true });
		expect((await Abilities.of('ada'))?.can('read', 'Post')).toBe(true);
		people.ada = { version: 1, facts: { userId: 'ada', roles: ['admin'] } };
		// Same version: the cached ability is served.
		expect((await Abilities.of('ada'))?.can('manage', 'all')).toBe(false);
	});

	it('builds abilities on each call without a cache', async () => {
		await boot({ cache: false });
		await Abilities.of('ada');
		await Abilities.of('ada');
		expect(reads).toBe(2);
	});

	it('guards routes with the ability of the actor', async () => {
		await boot({ cache: false });
		const as = (user?: string) => (user ? { 'x-user': user } : ({} as Record<string, string>));
		expect((await testing!.http.get('/posts').headers(as('ada')).send()).status).toBe(200);
		expect((await testing!.http.get('/posts').send()).status).toBe(403);
		expect((await testing!.http.get('/posts').headers(as('nobody')).send()).status).toBe(403);
		expect((await testing!.http.post('/posts').headers(as('ada')).send()).status).toBe(403);

		reads = 0;
		expect((await testing!.http.post('/posts').headers(as('root')).send()).status).toBe(200);
		// The guard and the handler share the ability of the request.
		expect(reads).toBe(1);

		expect((await testing!.http.get('/posts/guest').headers(as('ada')).send()).status).toBe(200);
		expect((await testing!.http.get('/posts/guest').headers(as('root')).send()).status).toBe(403);
	});

	it('authorizes calls with the ability of the actor', async () => {
		const actor: { id?: string } = {};
		@Application.register({
			modules: [
				CerberusModule.with({
					facts: (id) => people[id] ?? null,
					actor: () => actor.id,
					cache: false
				}),
				PostsModule,
				StaffModule
			],
			openapi: false
		})
		class App extends Application {}
		testing = await Application.testing({ app: App, boot: 'eager' });
		const mayUpdate = Cerberus.may<{ authorId: string }>(
			'update',
			(input) => new Post(input.authorId, 'draft')
		);
		expect(await mayUpdate({ authorId: 'ada' })).toBe(false);
		actor.id = 'ada';
		expect(await mayUpdate({ authorId: 'ada' })).toBe(true);
		expect(await mayUpdate({ authorId: 'bob' })).toBe(false);
		expect(await Cerberus.may('read', 'Post')(undefined)).toBe(true);
		expect(await Cerberus.check('delete', 'Post')).toBe(false);
	});

	it('needs CerberusModule for the abilities of actors', async () => {
		@Application.register({ modules: [PostsModule], openapi: false })
		class App extends Application {}
		testing = await Application.testing({ app: App, boot: 'eager' });
		expect(Abilities.domains()).toEqual(['posts']);
		await expect(Abilities.of('ada')).rejects.toBeInstanceOf(CerberusUnavailableError);
	});
});
