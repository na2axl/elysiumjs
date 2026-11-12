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

import { Password, PasswordHasher } from '@elysiumjs/olympus/harpocrates';
import { afterEach, describe, expect, it } from 'bun:test';

import { BunPasswordHasher } from '../src';

describe('BunPasswordHasher', () => {
	afterEach(() => Password.reset());

	it('is the bun driver of the PasswordHasher port', () => {
		expect(PasswordHasher.for('bun')).toBeInstanceOf(BunPasswordHasher);
	});

	it('hashes with Argon2id and verifies', async () => {
		const hasher = new BunPasswordHasher({ memoryCost: 4096, timeCost: 2 });
		const hash = await hasher.hash('correct horse');
		expect(hash.startsWith('$argon2id$')).toBe(true);
		expect(await hasher.verify('correct horse', hash)).toBe(true);
		expect(await hasher.verify('wrong horse', hash)).toBe(false);
		expect(await hasher.verify('correct horse', 'not a hash')).toBe(false);
	});

	it('asks for a rehash under weaker parameters', async () => {
		const weak = await new BunPasswordHasher({ memoryCost: 4096, timeCost: 2 }).hash('pw');
		expect(new BunPasswordHasher().needsRehash(weak)).toBe(true);
		expect(new BunPasswordHasher({ memoryCost: 4096, timeCost: 2 }).needsRehash(weak)).toBe(false);
		expect(new BunPasswordHasher().needsRehash('$scrypt$x')).toBe(true);
	});

	it('lets Password verify Argon2id hashes without ever using the bun driver', async () => {
		const hash = await new BunPasswordHasher({ memoryCost: 4096, timeCost: 2 }).hash('pw');
		expect(await Password.verify('pw', hash)).toBe(true);
		expect(await Password.verify('nope', hash)).toBe(false);
	});

	it('lets Password verify Argon2id hashes once another driver makes new ones', async () => {
		Password.use('bun');
		const hash = await Password.hash('correct horse');
		Password.use('scrypt');
		expect(await Password.verify('correct horse', hash)).toBe(true);
		expect(Password.needsRehash(hash)).toBe(true);
	});
});
