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

import type { TestingHttpApp } from '../../src/index';
import type { StorageDriver } from '../../src/pithos/index';

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';

import { Application } from '../../src/index';
import {
	DiskCannotSignError,
	DiskNotPublicError,
	InvalidObjectKeyError,
	LocalDisk,
	MemoryDisk,
	ObjectNotFoundError,
	PithosModule,
	Storage,
	UnknownDiskError
} from '../../src/pithos/index';

const signing = (disk: string) => ({
	url: `http://localhost/storage/${disk}`,
	secret: 'x'.repeat(32)
});

let root = '';

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'pithos-'));
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

const disks: [string, () => StorageDriver][] = [
	['memory', () => new MemoryDisk({ url: 'https://cdn.example.com/m', signing: signing('m') })],
	[
		'local',
		() =>
			new LocalDisk({
				root: join(root, crypto.randomUUID()),
				url: 'https://cdn.example.com/l',
				signing: signing('l')
			})
	]
];

describe.each(disks)('%s disk', (_name, make) => {
	it('writes, reads and describes objects', async () => {
		const disk = make();
		const info = await disk.put('avatars/42.txt', 'hello', {
			contentType: 'text/plain',
			metadata: { owner: 'u1' }
		});
		expect(info).toMatchObject({ key: 'avatars/42.txt', size: 5, contentType: 'text/plain' });
		const object = await disk.get('avatars/42.txt');
		expect(await object?.text()).toBe('hello');
		expect(object?.metadata).toEqual({ owner: 'u1' });
		expect(await disk.head('avatars/42.txt')).toMatchObject({ size: 5, metadata: { owner: 'u1' } });
		expect(await disk.exists('avatars/42.txt')).toBe(true);
		expect(await disk.get('avatars/none.txt')).toBeNull();
		expect(await disk.head('avatars/none.txt')).toBeNull();

		await disk.put('bytes.bin', new Uint8Array([1, 2, 3]));
		await disk.put('stream.bin', new Blob([new Uint8Array([4, 5])]).stream());
		expect([...((await (await disk.get('bytes.bin'))?.bytes()) ?? [])]).toEqual([1, 2, 3]);
		expect([...((await (await disk.get('stream.bin'))?.bytes()) ?? [])]).toEqual([4, 5]);
	});

	it('lists by prefix, page by page', async () => {
		const disk = make();
		for (const key of ['a/1', 'a/2', 'a/3', 'b/1']) await disk.put(key, key);
		const first = await disk.list({ prefix: 'a/', limit: 2 });
		expect(first.items.map((item) => item.key)).toEqual(['a/1', 'a/2']);
		const second = await disk.list({ prefix: 'a/', limit: 2, cursor: first.nextCursor! });
		expect(second).toMatchObject({ items: [{ key: 'a/3' }], nextCursor: null });
		expect((await disk.list()).items.map((item) => item.key)).toEqual(['a/1', 'a/2', 'a/3', 'b/1']);
	});

	it('copies, moves and deletes', async () => {
		const disk = make();
		await disk.put('staging/x', 'x', { contentType: 'text/plain' });
		await disk.copy('staging/x', 'copy/x');
		await disk.move('staging/x', 'final/x');
		expect(await disk.exists('staging/x')).toBe(false);
		expect(await (await disk.get('final/x'))?.text()).toBe('x');
		expect((await disk.head('copy/x'))?.contentType).toBe('text/plain');
		expect(await disk.delete('final/x')).toBe(true);
		expect(await disk.delete('final/x')).toBe(false);
		await expect(disk.copy('none', 'other')).rejects.toBeInstanceOf(ObjectNotFoundError);
	});

	it('refuses keys that climb out of the disk', async () => {
		const disk = make();
		for (const key of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', 'a\\b']) {
			await expect(disk.put(key, 'x')).rejects.toBeInstanceOf(InvalidObjectKeyError);
		}
	});

	it('gives public and signed URLs', async () => {
		const disk = make();
		expect(disk.url('a b/c.png')).toMatch(/^https:\/\/cdn\.example\.com\/[ml]\/a%20b\/c\.png$/);
		const signed = new URL(await disk.signedUrl('a/b', { method: 'PUT', expiresIn: 60 }));
		expect(signed.searchParams.get('method')).toBe('PUT');
		expect(signed.searchParams.get('signature')).toBeTruthy();
	});
});

describe('disks without a URL or signing', () => {
	it('refuse url() and signedUrl()', async () => {
		const disk = new MemoryDisk();
		expect(() => disk.url('a')).toThrow(DiskNotPublicError);
		await expect(disk.signedUrl('a', { method: 'GET', expiresIn: 1 })).rejects.toBeInstanceOf(
			DiskCannotSignError
		);
	});

	it('keeps metadata out of local listings', async () => {
		const folder = join(root, 'meta');
		const disk = new LocalDisk({ root: folder });
		await disk.put('a', 'x', { contentType: 'text/plain' });
		expect((await disk.list()).items.map((item) => item.key)).toEqual(['a']);
		expect(await readdir(folder)).toContain('.pithos');
		await expect(disk.get('.pithos/a.json')).rejects.toBeInstanceOf(ObjectNotFoundError);
	});
});

describe('PithosModule', () => {
	let testing: TestingHttpApp | undefined;
	const uploads = new MemoryDisk({ signing: signing('uploads') });

	const boot = async () => {
		@Application.register({
			modules: [
				PithosModule.with({
					disks: { public: () => new MemoryDisk({ url: 'https://cdn.example.com' }), uploads },
					default: 'public'
				})
			]
		})
		class App extends Application {}
		testing = await Application.testing({ app: App });
		// Modules boot on the first request.
		await testing.http.get('/health').send();
	};

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
		Storage.restore();
	});

	it('answers disks by name, the default without one', async () => {
		await boot();
		expect(Storage.disk().url('a')).toBe('https://cdn.example.com/a');
		expect(Storage.disk('uploads')).toBe(uploads);
		expect(() => Storage.disk('nowhere')).toThrow(UnknownDiskError);
	});

	it('fakes a disk until restore', async () => {
		await boot();
		const fake = Storage.fake('uploads');
		expect(Storage.disk('uploads')).toBe(fake);
		await fake.put('a', 'x');
		expect(await uploads.exists('a')).toBe(false);
		Storage.restore();
		expect(Storage.disk('uploads')).toBe(uploads);
	});

	it('serves the signed URLs of a disk that cannot', async () => {
		await boot();
		const put = await uploads.signedUrl('staging/a.txt', {
			method: 'PUT',
			expiresIn: 60,
			contentType: 'text/plain'
		});
		const path = (url: string) => {
			const parsed = new URL(url);
			return parsed.pathname + parsed.search;
		};
		const refused = await testing!.http
			.put(path(put))
			.header('content-type', 'image/png')
			.body('nope')
			.send();
		expect(refused.status).toBe(403);
		const uploaded = await testing!.http
			.put(path(put))
			.header('content-type', 'text/plain')
			.body('hello')
			.send();
		expect(uploaded.status).toBe(204);
		expect(await (await uploads.get('staging/a.txt'))?.text()).toBe('hello');

		// A PUT URL does not download, and a changed key breaks the signature.
		expect((await testing!.http.get(path(put)).send()).status).toBe(403);
		const get = await uploads.signedUrl('staging/a.txt', { method: 'GET', expiresIn: 60 });
		const downloaded = await testing!.http.get(path(get)).send();
		expect(downloaded.status).toBe(200);
		expect(downloaded.headers.get('content-type')).toBe('text/plain');
		expect(await downloaded.text()).toBe('hello');
		expect((await testing!.http.get(path(get).replace('a.txt', 'b.txt')).send()).status).toBe(403);
		expect((await testing!.http.get('/storage/public/a').send()).status).toBe(404);
	});
});
