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

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Storage } from '@elysiumjs/olympus/pithos';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { contractUrls, diskContract } from '../../olympus/tests/pithos/disk-contract';
import { BunDisk } from '../src';

let root = '';

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'pithos-bun-'));
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

diskContract(
	{ describe, it, expect },
	'bun',
	'bun',
	() => new BunDisk({ root: join(root, crypto.randomUUID()), ...contractUrls('bun') })
);

describe('BunDisk', () => {
	it('is the bun driver of the Storage port', () => {
		expect(Storage.for('bun', { root })).toBeInstanceOf(BunDisk);
	});

	it('keeps metadata out of listings and out of reach', async () => {
		const folder = join(root, 'meta');
		const disk = new BunDisk({ root: folder });
		await disk.put('a', 'x', { contentType: 'text/plain' });
		expect((await disk.list()).items.map((item) => item.key)).toEqual(['a']);
		expect(await readdir(folder)).toContain('.pithos');
		await expect(disk.get('.pithos/a.json')).rejects.toHaveProperty('name', 'ObjectNotFoundError');
	});

	it('lists nothing before the first write', async () => {
		const disk = new BunDisk({ root: join(root, 'empty') });
		expect(await disk.list()).toEqual({ items: [], nextCursor: null });
	});
});
