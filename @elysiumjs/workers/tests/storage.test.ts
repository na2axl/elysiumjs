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

import type { R2BucketLike, R2MultipartUploadLike, R2ObjectBodyLike, R2ObjectLike } from '../src';

import {
	InvalidObjectKeyError,
	MultipartPartsMismatchError,
	MultipartUploadNotFoundError,
	ObjectNotFoundError,
	Storage
} from '@elysiumjs/olympus/pithos';
import { afterEach, describe, expect, it } from 'bun:test';

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

	readonly uploads = new Map<
		string,
		{
			key: string;
			options: Parameters<R2BucketLike['put']>[2];
			parts: Map<number, { etag: string; bytes: Uint8Array }>;
		}
	>();

	async createMultipartUpload(key: string, options: Parameters<R2BucketLike['put']>[2] = {}) {
		const uploadId = `up/${crypto.randomUUID()}`;
		this.uploads.set(uploadId, { key, options, parts: new Map() });
		return this.resumeMultipartUpload(key, uploadId);
	}

	resumeMultipartUpload(key: string, uploadId: string): R2MultipartUploadLike {
		const found = () => {
			const upload = this.uploads.get(uploadId);
			if (!upload || upload.key !== key) {
				throw new Error('The specified multipart upload does not exist. (10024)');
			}
			return upload;
		};
		return {
			key,
			uploadId,
			uploadPart: async (partNumber, value) => {
				const etag = crypto.randomUUID();
				found().parts.set(partNumber, { etag, bytes: new Uint8Array(value as Uint8Array) });
				return { partNumber, etag: `"${etag}"` };
			},
			abort: async () => {
				found();
				this.uploads.delete(uploadId);
			},
			complete: async (parts) => {
				const upload = found();
				const chunks = parts.map(({ partNumber, etag }) => {
					const part = upload.parts.get(partNumber);
					if (!part || part.etag !== etag) throw new Error('InvalidPart (10025)');
					return part.bytes;
				});
				this.uploads.delete(uploadId);
				return this.put(key, await new Blob(chunks).arrayBuffer(), upload.options);
			}
		};
	}

	async get(
		key: string,
		options: { range?: { offset: number; length: number } } = {}
	): Promise<R2ObjectBodyLike | null> {
		const object = this.objects.get(key);
		if (!object) return null;
		const { range } = options;
		const bytes = range
			? object.bytes.slice(range.offset, range.offset + range.length)
			: object.bytes;
		return {
			...object,
			body: new Blob([bytes]).stream(),
			arrayBuffer: async () => bytes.slice().buffer,
			text: async () => new TextDecoder().decode(bytes)
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

describe('R2Disk uploads in parts', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	const s3 = { accountId: 'acct', bucket: 'media', accessKeyId: 'id', secretAccessKey: 'secret' };

	it('has no multipart support without a way to sign part URLs', () => {
		expect(new R2Disk({ binding: new FakeBucket() }).multipart).toBeUndefined();
	});

	it('reads a range of an object', async () => {
		const disk = new R2Disk({ binding: new FakeBucket() });
		await disk.put('r', 'abcdefgh');
		const head = await disk.get('r', { range: { offset: 0, length: 3 } });
		expect(head?.size).toBe(8);
		expect(await head?.text()).toBe('abc');
	});

	it('presigns parts on the S3 API with their exact length, and lists them with ListParts', async () => {
		const bucket = new FakeBucket();
		const disk = new R2Disk({ binding: bucket, s3 });
		const multipart = disk.multipart!;
		const uploadId = await multipart.create('movie/1', { contentType: 'video/mp4' });
		expect(bucket.uploads.get(uploadId)?.options?.httpMetadata).toEqual({
			contentType: 'video/mp4'
		});
		expect([...bucket.objects.keys()]).toEqual([]);

		const url = new URL(
			await multipart.signPart('movie/1', uploadId, 2, { contentLength: 42, expiresIn: 3600 })
		);
		expect(url.origin + url.pathname).toBe('https://acct.r2.cloudflarestorage.com/media/movie/1');
		expect(url.searchParams.get('partNumber')).toBe('2');
		expect(url.searchParams.get('uploadId')).toBe(uploadId);
		expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;host');

		const asked: URL[] = [];
		const pages = [
			`<ListPartsResult><IsTruncated>true</IsTruncated><NextPartNumberMarker>1</NextPartNumberMarker>
			<Part><PartNumber>1</PartNumber><ETag>&quot;e1&quot;</ETag><Size>5</Size></Part></ListPartsResult>`,
			`<ListPartsResult><IsTruncated>false</IsTruncated>
			<Part><PartNumber>2</PartNumber><ETag>"e2"</ETag><Size>3</Size></Part></ListPartsResult>`
		];
		globalThis.fetch = (async (input: string) => {
			asked.push(new URL(input));
			return new Response(pages.shift());
		}) as unknown as typeof fetch;
		expect(await multipart.listParts('movie/1', uploadId)).toEqual([
			{ number: 1, size: 5, etag: 'e1' },
			{ number: 2, size: 3, etag: 'e2' }
		]);
		expect(asked.map((u) => u.searchParams.get('part-number-marker'))).toEqual([null, '1']);
		expect(asked[0]!.searchParams.get('uploadId')).toBe(uploadId);

		globalThis.fetch = (async () =>
			new Response('<Error><Code>NoSuchUpload</Code></Error>', {
				status: 404
			})) as unknown as typeof fetch;
		expect(await multipart.listParts('movie/1', uploadId)).toBeNull();
		globalThis.fetch = (async () =>
			new Response('<Error><Code>AccessDenied</Code></Error>', {
				status: 403
			})) as unknown as typeof fetch;
		await expect(multipart.listParts('movie/1', uploadId)).rejects.toThrow('AccessDenied');
	});

	it('uploads, lists, joins and aborts parts through the binding with served URLs', async () => {
		const bucket = new FakeBucket();
		const disk = new R2Disk({ binding: bucket, ...contractUrls('r2') });
		const multipart = disk.multipart!;
		const uploadId = await multipart.create('movie/2');
		expect(await multipart.listParts('movie/2', uploadId)).toEqual([]);
		const url = new URL(
			await multipart.signPart('movie/2', uploadId, 1, { contentLength: 3, expiresIn: 60 })
		);
		expect(url.searchParams.get('uploadId')).toBe(uploadId);

		const second = await multipart.putPart!(
			'movie/2',
			uploadId,
			2,
			new TextEncoder().encode('def')
		);
		const first = await multipart.putPart!('movie/2', uploadId, 1, new TextEncoder().encode('abc'));
		expect(second.etag).not.toContain('"');
		const listed = await multipart.listParts('movie/2', uploadId);
		expect(listed).toEqual([first, second]);

		await expect(
			multipart.complete('movie/2', uploadId, [first, { ...second, etag: 'stale' }])
		).rejects.toBeInstanceOf(MultipartPartsMismatchError);
		const object = await multipart.complete('movie/2', uploadId, listed!);
		expect(object.size).toBe(6);
		expect(await (await disk.get('movie/2'))?.text()).toBe('abcdef');
		expect([...bucket.objects.keys()]).toEqual(['movie/2']);
		expect(await multipart.listParts('movie/2', uploadId)).toBeNull();
		await expect(
			multipart.putPart!('movie/2', uploadId, 1, new Uint8Array(1))
		).rejects.toBeInstanceOf(MultipartUploadNotFoundError);

		const failing = await multipart.create('movie/4');
		const broken = bucket.resumeMultipartUpload('movie/4', failing);
		bucket.resumeMultipartUpload = () => ({
			...broken,
			complete: async () => {
				throw new Error('completeMultipartUpload: the network does not exist');
			}
		});
		await expect(multipart.complete('movie/4', failing, [])).rejects.toThrow('network');
		delete (bucket as Partial<FakeBucket>).resumeMultipartUpload;
		await multipart.abort('movie/4', failing);

		const dropped = await multipart.create('movie/3');
		await multipart.putPart!('movie/3', dropped, 1, new Uint8Array(4));
		await multipart.abort('movie/3', dropped);
		await multipart.abort('movie/3', dropped);
		expect(bucket.uploads.has(dropped)).toBe(false);
		expect([...bucket.objects.keys()]).toEqual(['movie/2']);
	});
});
