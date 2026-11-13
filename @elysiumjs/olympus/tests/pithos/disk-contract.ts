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

import type { StorageDriver } from '../../src/pithos/index';

/** The test functions the contract runs on: those of `bun:test` or of Vitest. */
export type TestApi = {
	describe: (name: string, body: () => void) => void;
	it: (name: string, body: () => Promise<void>) => void;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	expect: (value: unknown) => any;
};

/** The URLs a disk under contract is built with: `url` public, `signing` for served URLs. */
export const contractUrls = (path: string) => ({
	url: `https://cdn.example.com/${path}`,
	signing: { url: `http://localhost/storage/${path}`, secret: 'x'.repeat(32) }
});

/** The error classes the contract expects, from the copy of olympus the disk was built with. */
export type ContractErrors = {
	ObjectNotFoundError: abstract new (...args: never[]) => Error;
	InvalidObjectKeyError: abstract new (...args: never[]) => Error;
};

/**
 * What every disk does, run on the disks of olympus and of the runtime packages. `make` builds an
 * empty disk with `contractUrls(path)`. The runtime packages use a built copy of olympus, so they
 * give the error classes of that copy.
 */
export const diskContract = (
	{ describe, it, expect }: TestApi,
	name: string,
	path: string,
	make: () => StorageDriver,
	errors: ContractErrors
): void => {
	const rejectsWith = async (promise: Promise<unknown>, error: keyof ContractErrors) => {
		await expect(promise).rejects.toBeInstanceOf(errors[error]);
	};

	describe(`${name} disk`, () => {
		it('writes, reads and describes objects', async () => {
			const disk = make();
			const info = await disk.put('avatars/42.txt', 'hello', {
				contentType: 'text/plain',
				cacheControl: 'public, max-age=60',
				metadata: { owner: 'u1' }
			});
			expect(info).toMatchObject({
				key: 'avatars/42.txt',
				size: 5,
				contentType: 'text/plain',
				cacheControl: 'public, max-age=60'
			});
			const object = await disk.get('avatars/42.txt');
			expect(await object?.text()).toBe('hello');
			expect(object?.metadata).toEqual({ owner: 'u1' });
			expect(await disk.head('avatars/42.txt')).toMatchObject({
				size: 5,
				cacheControl: 'public, max-age=60',
				metadata: { owner: 'u1' }
			});
			expect(await disk.exists('avatars/42.txt')).toBe(true);
			expect(await disk.get('avatars/none.txt')).toBeNull();
			expect(await disk.head('avatars/none.txt')).toBeNull();
		});

		it('takes bytes, blobs and streams', async () => {
			const disk = make();
			await disk.put('bytes.bin', new Uint8Array([1, 2, 3]));
			await disk.put('stream.bin', new Blob([new Uint8Array([4, 5])]).stream());
			expect([...((await (await disk.get('bytes.bin'))?.bytes()) ?? [])]).toEqual([1, 2, 3]);
			expect([...((await (await disk.get('stream.bin'))?.bytes()) ?? [])]).toEqual([4, 5]);
		});

		it('replaces an object and its metadata', async () => {
			const disk = make();
			await disk.put('a', 'first', {
				contentType: 'text/plain',
				cacheControl: 'no-store',
				metadata: { v: '1' }
			});
			await disk.put('a', 'second!');
			expect(await disk.head('a')).toMatchObject({ size: 7, metadata: {} });
			expect((await disk.head('a'))?.contentType).toBeUndefined();
			expect((await disk.head('a'))?.cacheControl).toBeUndefined();
		});

		it('lists by prefix, page by page', async () => {
			const disk = make();
			for (const key of ['a/1', 'a/2', 'a/3', 'b/1']) await disk.put(key, key);
			const first = await disk.list({ prefix: 'a/', limit: 2 });
			expect(first.items.map((item) => item.key)).toEqual(['a/1', 'a/2']);
			const second = await disk.list({ prefix: 'a/', limit: 2, cursor: first.nextCursor! });
			expect(second).toMatchObject({ items: [{ key: 'a/3' }], nextCursor: null });
			expect((await disk.list()).items.map((item) => item.key)).toEqual([
				'a/1',
				'a/2',
				'a/3',
				'b/1'
			]);
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
			await rejectsWith(disk.copy('none', 'other'), 'ObjectNotFoundError');
		});

		it('refuses keys that climb out of the disk', async () => {
			const disk = make();
			for (const key of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', 'a\\b']) {
				await rejectsWith(disk.put(key, 'x'), 'InvalidObjectKeyError');
			}
		});

		it('gives public and signed URLs', async () => {
			const disk = make();
			expect(disk.url('a b/c.png')).toBe(`https://cdn.example.com/${path}/a%20b/c.png`);
			const signed = new URL(await disk.signedUrl('a/b', { method: 'PUT', expiresIn: 60 }));
			expect(signed.searchParams.get('method')).toBe('PUT');
			expect(signed.searchParams.get('signature')).toBeTruthy();
		});
	});
};
