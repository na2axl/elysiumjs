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
import type {
	FileEvent,
	FileOwner,
	FileRecord,
	MultipartStorage,
	MultipartTicket,
	UploadRequest
} from '../../src/pithos/index';

import { afterEach, describe, expect, it } from 'bun:test';

import { Application, Clock, DomainError, Lifecycle } from '../../src/index';
import {
	Files,
	MemoryDisk,
	MemoryFileStore,
	MIN_PART_BYTES,
	MultipartOnPublicDiskError,
	MultipartPartsMismatchError,
	MultipartUploadNotFoundError,
	partCountOf,
	partSizeOf,
	PITHOS_FILE_EXPIRED,
	PITHOS_FILE_READY,
	PITHOS_FILE_REJECTED,
	PithosModule,
	Upload,
	UploadExpiredError,
	UploadMissingError,
	UploadNotPendingError,
	UploadPartInvalidError,
	UploadPartSizeError,
	UploadRejectedError,
	Uploads
} from '../../src/pithos/index';
import { BadRequestError, NotFoundError } from '../../src/problem';
import { Result } from '../../src/result';

const MiB = 1024 * 1024;
const alice: FileOwner = { type: 'user', id: 'alice' };

/** The start of an MP4 file: an `ftyp` box, which `file-type` reads as `video/mp4`. */
const MP4_HEAD = Uint8Array.from([
	0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
	0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d
]);

/** A video of `size` bytes: an MP4 head, then bytes that tell their offset. */
const video = (size: number): Uint8Array => {
	const bytes = new Uint8Array(size);
	for (let i = 0; i < size; i += 1) bytes[i] = i % 251;
	bytes.set(MP4_HEAD, 0);
	return bytes;
};

class QuotaExceededError extends DomainError.for('QUOTA_EXCEEDED', 422) {
	constructor() {
		super('No room left.');
	}
}

@Upload.purpose('movie')
class MovieUpload extends Upload<{ headBytes: number }> {
	public override get disk() {
		return 'vault';
	}

	public get types() {
		return ['video/mp4', 'video/quicktime'];
	}

	public get maxBytes() {
		return 64 * MiB;
	}

	public override get multipart() {
		return { partBytes: 5 * MiB };
	}

	public override get uploadTtl() {
		return 600;
	}

	public override get uploadTtlMax() {
		return 1500;
	}

	public override get sniffBytes() {
		return 64;
	}

	public override admit(request: UploadRequest) {
		const seconds = request.declared?.seconds;
		if (typeof seconds !== 'number') return Result.fail(new QuotaExceededError());
		return Result.pass({ declaredSeconds: seconds });
	}

	public override metadata(_file: FileRecord, head: Uint8Array) {
		return { headBytes: head.byteLength };
	}
}

@Upload.purpose('public-movie')
class PublicMovieUpload extends MovieUpload {
	public override get disk() {
		return 'cdn';
	}
}

@Upload.purpose('tiny-parts')
class TinyPartsUpload extends MovieUpload {
	public override get multipart() {
		return { partBytes: MiB };
	}
}

@Upload.purpose('single-movie')
class SingleMovieUpload extends Upload {
	public override get disk() {
		return 'vault';
	}

	public get types() {
		return ['video/mp4'];
	}

	public get maxBytes() {
		return MiB;
	}
}

void SingleMovieUpload;
void PublicMovieUpload;
void TinyPartsUpload;

describe('Uploads in parts', () => {
	let testing: TestingHttpApp | undefined;
	let vault: MemoryDisk;
	const events: { event: string; file: FileRecord }[] = [];

	const boot = async () => {
		vault = new MemoryDisk({
			signing: { url: 'http://localhost/storage/vault', secret: 'v'.repeat(32) }
		});
		const cdn = new MemoryDisk({
			url: 'https://cdn.example.com',
			signing: { url: 'http://localhost/storage/cdn', secret: 'c'.repeat(32) }
		});
		@Application.register({
			// Served part URLs go through the application, and its body limit.
			http: { bodyLimit: 8 * MiB },
			modules: [
				PithosModule.with({
					disks: { vault, cdn },
					files: { store: new MemoryFileStore(), uploadTtl: 60, unclaimedTtl: 3600 }
				})
			]
		})
		class App extends Application {}
		testing = await Application.testing({ app: App, boot: 'eager' });
		await testing.http.get('/health').send();
		for (const event of [PITHOS_FILE_READY, PITHOS_FILE_REJECTED, PITHOS_FILE_EXPIRED]) {
			Lifecycle.on<FileEvent>(event, ({ data }) => void events.push({ event, file: data.file }));
		}
	};

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
		events.length = 0;
		Lifecycle.clear();
		Clock.reset();
	});

	const open = async (size: number, patch: Partial<UploadRequest> = {}) => {
		const ticket = (
			await Uploads.open({
				purpose: 'movie',
				contentType: 'video/mp4',
				size,
				owner: alice,
				user: 'alice',
				declared: { seconds: 90 },
				...patch
			})
		).orThrow();
		if (ticket.mode !== 'multipart') throw new Error('expected an upload in parts');
		return ticket;
	};

	const uploadIdOf = async (id: string) => (await Files.find(id))!.multipart!.uploadId;

	const put = async (url: string, body: Uint8Array) => {
		const parsed = new URL(url);
		return testing!.http
			.put(parsed.pathname + parsed.search)
			.header('content-type', 'application/octet-stream')
			.body(body)
			.send();
	};

	/** Sends the given parts of a file through their signed URLs. */
	const send = async (ticket: MultipartTicket, bytes: Uint8Array, numbers: number[]) => {
		const signed = (await Uploads.signParts(ticket.file.id, numbers, { user: 'alice' })).orThrow();
		for (const part of signed.parts) {
			const start = (part.number - 1) * ticket.partBytes;
			const length = Number(part.headers['content-length']);
			expect((await put(part.url, bytes.slice(start, start + length))).status).toBe(204);
		}
	};

	it('opens an upload in parts straight to the key of the file', async () => {
		await boot();
		const size = 11 * MiB + 7;
		const ticket = await open(size);
		expect(ticket).toMatchObject({ mode: 'multipart', partBytes: 5 * MiB, partCount: 3 });
		expect(ticket.file).toMatchObject({
			status: 'pending',
			key: `movie/${ticket.file.id}`,
			metadata: { declaredSeconds: 90 }
		});
		// The disk's upload id stays on the server.
		expect(ticket.file.multipart).toBeUndefined();
		expect(await uploadIdOf(ticket.file.id)).toBeString();
		expect((await Files.find(ticket.file.id))?.multipart?.partBytes).toBe(5 * MiB);
		expect(ticket.expiresAt.getTime() - ticket.file.createdAt.getTime()).toBe(600_000);
	});

	it('answers the refusal of admit() as it is', async () => {
		await boot();
		const refused = await Uploads.open({
			purpose: 'movie',
			contentType: 'video/mp4',
			size: MiB,
			owner: alice
		});
		expect(refused.error).toBeInstanceOf(QuotaExceededError);
	});

	it('signs each part with its exact size, and extends the upload', async () => {
		await boot();
		const size = 11 * MiB + 7;
		const ticket = await open(size);
		const signed = (await Uploads.signParts(ticket.file.id, [3, 1, 1])).orThrow();
		expect(signed.parts.map((part) => [part.number, part.headers['content-length']])).toEqual([
			[3, String(MiB + 7)],
			[1, String(5 * MiB)]
		]);
		expect(new URL(signed.parts[0]!.url).searchParams.get('partNumber')).toBe('3');

		Clock.travel(500_000);
		const extended = (await Uploads.signParts(ticket.file.id, [2])).orThrow();
		const slid = extended.expiresAt.getTime() - ticket.file.createdAt.getTime();
		expect(slid).toBeGreaterThanOrEqual(1_100_000);
		expect(slid).toBeLessThan(1_101_000);
		Clock.travel(500_000);
		// Capped at uploadTtlMax from the start.
		const capped = (await Uploads.signParts(ticket.file.id, [2])).orThrow();
		expect(capped.expiresAt.getTime() - ticket.file.createdAt.getTime()).toBe(1_500_000);
		expect(capped.parts[0]!.expiresAt).toEqual(capped.expiresAt);

		expect((await Uploads.signParts(ticket.file.id, [0])).error).toBeInstanceOf(
			UploadPartInvalidError
		);
		const beyond = await Uploads.signParts(ticket.file.id, [4]);
		expect(beyond.error?.extension()).toMatchObject({ partCount: 3 });
		const many = Array.from({ length: 101 }, (_, i) => i + 1);
		expect((await Uploads.signParts(ticket.file.id, many)).error).toBeInstanceOf(BadRequestError);
		expect((await Uploads.signParts(ticket.file.id, [1], { user: 'bob' })).error).toBeInstanceOf(
			NotFoundError
		);
		Clock.travel(600_000);
		expect((await Uploads.signParts(ticket.file.id, [1])).error).toBeInstanceOf(UploadExpiredError);
	});

	it('uploads, lists and joins the parts, reading only the head of the file', async () => {
		await boot();
		const size = 11 * MiB + 7;
		const bytes = video(size);
		const ticket = await open(size);

		// A part of another length is refused by its URL.
		const [first] = (await Uploads.signParts(ticket.file.id, [1])).orThrow().parts;
		expect((await put(first!.url, bytes.slice(0, 1024))).status).toBe(403);

		await send(ticket, bytes, [3, 1]);
		const progress = (await Uploads.listParts(ticket.file.id, { user: 'alice' })).orThrow();
		expect(progress.parts.map((part) => [part.number, part.size])).toEqual([
			[1, 5 * MiB],
			[3, MiB + 7]
		]);
		expect(progress.partCount).toBe(3);

		const missing = await Uploads.finish(ticket.file.id, { user: 'alice' });
		expect(missing.error).toBeInstanceOf(UploadMissingError);
		expect((await Files.find(ticket.file.id))?.status).toBe('pending');

		await send(ticket, bytes, [2]);
		const file = (await Uploads.finish(ticket.file.id, { user: 'alice' })).orThrow();
		expect(file).toMatchObject({
			status: 'ready',
			contentType: 'video/mp4',
			multipart: null,
			metadata: { declaredSeconds: 90, headBytes: 64 }
		});
		const stored = await vault.get(file.key);
		expect(stored?.size).toBe(size);
		expect(Buffer.from((await stored!.bytes()) as Uint8Array).equals(Buffer.from(bytes))).toBe(
			true
		);
		expect(events).toEqual([{ event: PITHOS_FILE_READY, file }]);
		expect((await Uploads.finish(file.id)).error).toBeInstanceOf(UploadNotPendingError);
		expect((await Uploads.listParts(file.id)).error).toBeInstanceOf(UploadNotPendingError);
	});

	it('keeps the real type of a file declared as another accepted type', async () => {
		await boot();
		const size = 5 * MiB + 1;
		const ticket = await open(size, { contentType: 'video/quicktime' });
		await send(ticket, video(size), [1, 2]);
		const file = (await Uploads.finish(ticket.file.id)).orThrow();
		expect(file.contentType).toBe('video/mp4');
	});

	it('refuses a file whose content is not of an accepted type, and drops it', async () => {
		await boot();
		const size = 5 * MiB + 1;
		const ticket = await open(size);
		await send(ticket, new Uint8Array(size), [1, 2]);
		const refused = await Uploads.finish(ticket.file.id);
		expect(refused.error).toBeInstanceOf(UploadRejectedError);
		expect(await vault.exists(ticket.file.key)).toBe(false);
		expect(events.map((event) => event.event)).toEqual([PITHOS_FILE_REJECTED]);
	});

	it('finishes again an upload whose parts were joined before a stop', async () => {
		await boot();
		const size = 5 * MiB + 1;
		const ticket = await open(size);
		await send(ticket, video(size), [1, 2]);
		const uploadId = await uploadIdOf(ticket.file.id);
		const parts = await vault.multipart.listParts(ticket.file.key, uploadId);
		await vault.multipart.complete(ticket.file.key, uploadId, parts!);
		const progress = (await Uploads.listParts(ticket.file.id)).orThrow();
		expect(progress).toMatchObject({ joined: true, parts: [] });
		const file = (await Uploads.finish(ticket.file.id)).orThrow();
		expect(file.status).toBe('ready');
	});

	it('drops the object of parts already joined when an upload is given up', async () => {
		await boot();
		const size = 5 * MiB + 1;
		const ticket = await open(size);
		await send(ticket, video(size), [1, 2]);
		const uploadId = await uploadIdOf(ticket.file.id);
		const parts = await vault.multipart.listParts(ticket.file.key, uploadId);
		await vault.multipart.complete(ticket.file.key, uploadId, parts!);
		expect(await vault.head(ticket.file.key)).not.toBeNull();
		expect((await Uploads.abort(ticket.file.id)).orThrow().status).toBe('expired');
		expect(await vault.head(ticket.file.key)).toBeNull();
	});

	it('refuses an upload the disk no longer has', async () => {
		await boot();
		const ticket = await open(5 * MiB + 1);
		await vault.multipart.abort(ticket.file.key, await uploadIdOf(ticket.file.id));
		expect((await Uploads.finish(ticket.file.id)).error).toBeInstanceOf(UploadRejectedError);
	});

	it('answers a part sent again while it is joined as missing', async () => {
		await boot();
		const size = 5 * MiB + 1;
		const ticket = await open(size);
		await send(ticket, video(size), [1, 2]);
		const real = vault.multipart;
		let failures = 1;
		Object.defineProperty(vault, 'multipart', {
			get: (): MultipartStorage => ({
				...real,
				complete: async (key, uploadId, parts) => {
					if (failures-- > 0) throw new MultipartPartsMismatchError(uploadId);
					return real.complete(key, uploadId, parts);
				}
			})
		});
		expect((await Uploads.finish(ticket.file.id)).error).toBeInstanceOf(UploadMissingError);
		expect((await Files.find(ticket.file.id))?.status).toBe('pending');
		expect((await Uploads.finish(ticket.file.id)).orThrow().status).toBe('ready');
	});

	it('gives up an upload, and prunes one never finished', async () => {
		await boot();
		const given = await open(5 * MiB + 1);
		await send(given, video(5 * MiB + 1), [1]);
		expect((await Uploads.abort(given.file.id, { user: 'bob' })).error).toBeInstanceOf(
			NotFoundError
		);
		const aborted = (await Uploads.abort(given.file.id, { user: 'alice' })).orThrow();
		expect(aborted.status).toBe('expired');
		const givenId = (await Files.find(given.file.id))!.multipart!.uploadId;
		expect(await vault.multipart.listParts(given.file.key, givenId)).toBeNull();
		expect((await Uploads.abort(given.file.id)).error).toBeInstanceOf(UploadNotPendingError);
		expect((await Uploads.finish(given.file.id)).error).toBeInstanceOf(UploadNotPendingError);

		const left = await open(5 * MiB + 1);
		const leftId = await uploadIdOf(left.file.id);
		Clock.travel(601_000);
		expect(await Files.prune()).toBe(1);
		expect((await Files.find(left.file.id))?.status).toBe('expired');
		expect(await vault.multipart.listParts(left.file.key, leftId)).toBeNull();
		expect(events.map((event) => [event.event, event.file.id])).toEqual([
			[PITHOS_FILE_EXPIRED, given.file.id],
			[PITHOS_FILE_EXPIRED, left.file.id]
		]);
	});

	it('aborts the upload of a file refused before its parts are joined', async () => {
		await boot();
		const size = 5 * MiB + 1;
		const ticket = await open(size);
		const uploadId = await uploadIdOf(ticket.file.id);
		await vault.multipart.putPart!(ticket.file.key, uploadId, 1, new Uint8Array(5 * MiB));
		await vault.multipart.putPart!(ticket.file.key, uploadId, 2, new Uint8Array(2));
		const refused = await Uploads.finish(ticket.file.id);
		expect((refused.error as UploadRejectedError).reason).toContain('part 2');
		expect(await vault.multipart.listParts(ticket.file.key, uploadId)).toBeNull();
		expect(await vault.exists(ticket.file.key)).toBe(false);
	});

	it('refuses after a retry an upload the disk dropped while joining it', async () => {
		await boot();
		const size = 5 * MiB + 1;
		const ticket = await open(size);
		await send(ticket, video(size), [1, 2]);
		const uploadId = await uploadIdOf(ticket.file.id);
		const real = vault.multipart;
		Object.defineProperty(vault, 'multipart', {
			get: (): MultipartStorage => ({
				...real,
				complete: async (key) => {
					await real.abort(key, uploadId);
					throw new MultipartUploadNotFoundError(uploadId);
				}
			})
		});
		expect((await Uploads.finish(ticket.file.id)).error).toBeInstanceOf(UploadMissingError);
		expect((await Uploads.finish(ticket.file.id)).error).toBeInstanceOf(UploadRejectedError);
	});

	it('answers parts, aborts and finishes of uploads that are not in progress', async () => {
		await boot();
		const ticket = await open(5 * MiB + 1);
		for (const call of [
			Uploads.listParts(ticket.file.id, { user: 'bob' }),
			Uploads.signParts(ticket.file.id, [1], { user: 'bob' }),
			Uploads.abort(ticket.file.id, { user: 'bob' })
		]) {
			expect((await call).error).toBeInstanceOf(NotFoundError);
		}
		expect((await Uploads.listParts('nope')).error).toBeInstanceOf(NotFoundError);
		const single = (
			await Uploads.open({
				purpose: 'single-movie',
				contentType: 'video/mp4',
				size: 10,
				owner: alice
			})
		).orThrow();
		expect(single.mode).toBe('single');
		expect((await Uploads.listParts(single.file.id)).error).toBeInstanceOf(NotFoundError);
		Clock.travel(601_000);
		expect((await Uploads.listParts(ticket.file.id)).error).toBeInstanceOf(UploadExpiredError);
	});

	it('refuses a purpose in parts on a public disk or with parts too small', async () => {
		await boot();
		const request = {
			contentType: 'video/mp4',
			size: MiB,
			owner: alice,
			declared: { seconds: 1 }
		};
		await expect(Uploads.open({ ...request, purpose: 'public-movie' })).rejects.toBeInstanceOf(
			MultipartOnPublicDiskError
		);
		await expect(Uploads.open({ ...request, purpose: 'tiny-parts' })).rejects.toBeInstanceOf(
			UploadPartSizeError
		);
	});

	it('counts parts and their sizes', () => {
		expect(partCountOf(1, MIN_PART_BYTES)).toBe(1);
		expect(partCountOf(MIN_PART_BYTES, MIN_PART_BYTES)).toBe(1);
		expect(partCountOf(MIN_PART_BYTES + 1, MIN_PART_BYTES)).toBe(2);
		expect(partSizeOf(MIN_PART_BYTES + 1, MIN_PART_BYTES, 1)).toBe(MIN_PART_BYTES);
		expect(partSizeOf(MIN_PART_BYTES + 1, MIN_PART_BYTES, 2)).toBe(1);
	});
});
