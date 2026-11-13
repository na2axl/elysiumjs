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

import { afterEach, describe, expect, it } from 'bun:test';

import { Application, Http } from '../../src/index';
import {
	DiskCannotSignError,
	DiskNotPublicError,
	InvalidObjectKeyError,
	MemoryDisk,
	ObjectNotFoundError,
	PithosModule,
	Storage,
	StorageController,
	StoredObjectView,
	UnknownDiskError
} from '../../src/pithos/index';
import { contractUrls, diskContract } from './disk-contract';

const signing = (disk: string) => ({
	url: `http://localhost/storage/${disk}`,
	secret: 'x'.repeat(32)
});

diskContract({ describe, it, expect }, 'memory', 'm', () => new MemoryDisk(contractUrls('m')), {
	InvalidObjectKeyError,
	ObjectNotFoundError
});

describe('disks without a URL or signing', () => {
	it('refuse url() and signedUrl()', async () => {
		const disk = new MemoryDisk();
		expect(() => disk.url('a')).toThrow(DiskNotPublicError);
		await expect(disk.signedUrl('a', { method: 'GET', expiresIn: 1 })).rejects.toBeInstanceOf(
			DiskCannotSignError
		);
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

	it('declares the responses of its routes: the bytes of an object, and none for an upload', () => {
		const routes = Http.describe(StorageController)!.routes;
		expect(routes.find((r) => r.method === 'GET')).toMatchObject({ responds: true });
		expect(routes.find((r) => r.method === 'PUT')).toMatchObject({ status: 204 });
		expect(StoredObjectView.contentType).toBe('application/octet-stream');
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
		expect(downloaded.headers.get('x-content-type-options')).toBe('nosniff');
		expect(downloaded.headers.get('content-security-policy')).toContain('sandbox');
		expect(downloaded.headers.get('cache-control')).toBeNull();
		expect(await downloaded.text()).toBe('hello');

		// An object written with a Cache-Control header is served with it.
		await uploads.put('cached.txt', 'cached', {
			contentType: 'text/plain',
			cacheControl: 'public, max-age=60'
		});
		const cached = await uploads.signedUrl('cached.txt', { method: 'GET', expiresIn: 60 });
		expect((await testing!.http.get(path(cached)).send()).headers.get('cache-control')).toBe(
			'public, max-age=60'
		);
		expect((await testing!.http.get(path(get).replace('a.txt', 'b.txt')).send()).status).toBe(403);
		expect((await testing!.http.get('/storage/public/a').send()).status).toBe(404);
	});

	it('refuses an upload of another size than signed', async () => {
		await boot();
		const put = new URL(
			await uploads.signedUrl('staging/sized.txt', {
				method: 'PUT',
				expiresIn: 60,
				contentLength: 5
			})
		);
		const send = (body: string) =>
			testing!.http
				.put(put.pathname + put.search)
				.body(body)
				.send();
		expect((await testing!.http.put(put.pathname + put.search).send()).status).toBe(411);
		expect((await send('too long')).status).toBe(403);
		expect(await uploads.exists('staging/sized.txt')).toBe(false);
		expect((await send('fives')).status).toBe(204);
	});
});
