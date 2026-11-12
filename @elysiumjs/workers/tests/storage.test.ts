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

import type { R2BucketLike, R2ObjectBodyLike, R2ObjectLike } from '../src';

import { InvalidObjectKeyError, ObjectNotFoundError, Storage } from '@elysiumjs/olympus/pithos';
import { describe, expect, it } from 'bun:test';

import { contractUrls, diskContract } from '../../olympus/tests/pithos/disk-contract';
import { R2Disk } from '../src';

type Stored = R2ObjectLike & { bytes: Uint8Array };

/** An R2 bucket in memory, with the same listing and metadata rules. */
class FakeBucket implements R2BucketLike {
	readonly objects = new Map<string, Stored>();

	async put(key: string, value: unknown, options: Parameters<R2BucketLike['put']>[2] = {}) {
		if (value instanceof ReadableStream) throw new TypeError('R2 needs a known length.');
		const bytes =
			typeof value === 'string'
				? new TextEncoder().encode(value)
				: value instanceof Blob
					? new Uint8Array(await value.arrayBuffer())
					: value instanceof ArrayBuffer
						? new Uint8Array(value)
						: new Uint8Array((value as Uint8Array).slice());
		const object: Stored = {
			key,
			size: bytes.byteLength,
			httpEtag: `"${crypto.randomUUID()}"`,
			uploaded: new Date(),
			httpMetadata: { ...options.httpMetadata },
			customMetadata: { ...options.customMetadata },
			bytes
		};
		this.objects.set(key, object);
		return object;
	}

	async get(key: string): Promise<R2ObjectBodyLike | null> {
		const object = this.objects.get(key);
		if (!object) return null;
		return {
			...object,
			body: new Blob([object.bytes]).stream(),
			arrayBuffer: async () => object.bytes.slice().buffer,
			text: async () => new TextDecoder().decode(object.bytes)
		};
	}

	async head(key: string) {
		return this.objects.get(key) ?? null;
	}

	async delete(keys: string | string[]) {
		for (const key of [keys].flat()) this.objects.delete(key);
	}

	async list(options: Parameters<R2BucketLike['list']>[0] = {}) {
		const keys = [...this.objects.keys()]
			.filter((key) => !options.prefix || key.startsWith(options.prefix))
			.filter((key) => !options.cursor || key > options.cursor)
			.sort();
		const limit = options.limit ?? 1000;
		const page = keys.slice(0, limit);
		const truncated = keys.length > limit;
		return {
			objects: page.map((key) => this.objects.get(key)!),
			truncated,
			cursor: truncated ? page.at(-1) : undefined
		};
	}
}

diskContract(
	{ describe, it, expect },
	'r2',
	'r2',
	() => new R2Disk({ binding: new FakeBucket(), ...contractUrls('r2') }),
	{ InvalidObjectKeyError, ObjectNotFoundError }
);

describe('R2Disk', () => {
	it('is the r2 driver of the Storage port', () => {
		expect(Storage.for('r2', { binding: new FakeBucket() })).toBeInstanceOf(R2Disk);
	});

	it('reads the bucket again on every call when given a function', async () => {
		let bucket = new FakeBucket();
		const disk = new R2Disk({ binding: () => bucket });
		await disk.put('a', 'x');
		bucket = new FakeBucket();
		expect(await disk.exists('a')).toBe(false);
	});

	it('presigns URLs on the S3 API with credentials', async () => {
		const disk = new R2Disk({
			binding: new FakeBucket(),
			s3: {
				accountId: 'acct',
				bucket: 'media',
				accessKeyId: 'id',
				secretAccessKey: () => 'secret'
			},
			signing: contractUrls('r2').signing
		});
		expect(disk.served).toBeUndefined();
		const url = new URL(
			await disk.signedUrl('staging/a b', {
				method: 'PUT',
				expiresIn: 60,
				contentType: 'image/png',
				contentLength: 42
			})
		);
		expect(url.origin + url.pathname).toBe(
			'https://acct.r2.cloudflarestorage.com/media/staging/a%20b'
		);
		expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
		const get = new URL(await disk.signedUrl('a', { method: 'GET', expiresIn: 60 }));
		expect(get.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
		for (const expiresIn of [0, 1.5, 604_801]) {
			await expect(disk.signedUrl('a', { method: 'GET', expiresIn })).rejects.toBeInstanceOf(
				RangeError
			);
		}
	});

	it('reads a stream in full before writing it', async () => {
		const bucket = new FakeBucket();
		const disk = new R2Disk({ binding: bucket });
		await disk.put('s', new Blob(['streamed']).stream(), { contentType: 'text/plain' });
		expect(new TextDecoder().decode(bucket.objects.get('s')!.bytes)).toBe('streamed');
	});
});
