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
import type { FileEvent, FileOwner, FileRecord } from '../../src/pithos/index';

import { afterEach, describe, expect, it } from 'bun:test';

import { Application, Clock, Lifecycle, Module, Service } from '../../src/index';
import { FilesPruner } from '../../src/pithos/heracles';
import {
	DuplicateUploadPurposeError,
	FileNotReadyError,
	Files,
	FileStore,
	MemoryDisk,
	MemoryFileStore,
	PITHOS_FILE_DELETED,
	PITHOS_FILE_READY,
	PITHOS_FILE_REJECTED,
	PithosModule,
	stagingKey,
	Storage,
	Upload,
	UploadExpiredError,
	UploadMissingError,
	UploadNotPendingError,
	UploadPurposeUnknownError,
	UploadRejectedError,
	Uploads,
	UploadTooLargeError,
	UploadTooManyPendingError,
	UploadTypeNotAllowedError
} from '../../src/pithos/index';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../src/problem';

/** A 1x1 PNG. */
const PNG = Uint8Array.from(
	atob(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
	),
	(char) => char.charCodeAt(0)
);

const alice: FileOwner = { type: 'user', id: 'alice' };

@Service.register()
class Limits {
	public readonly avatarBytes = 1024;
}

@Upload.purpose('avatar')
@Service.register()
class AvatarUpload extends Upload {
	constructor(@Service.inject() private readonly limits: Limits) {
		super();
	}

	public override get disk() {
		return 'uploads';
	}

	public get types() {
		return ['image/png'];
	}

	public get maxBytes() {
		return this.limits.avatarBytes;
	}

	public override get owners() {
		return ['user'];
	}

	public override authorize(owner: FileOwner, user: string | undefined) {
		return owner.id === user;
	}
}

@Module.register({ services: [Limits, AvatarUpload] })
class MediaModule extends Module {}

@Upload.purpose('note')
class NoteUpload extends Upload {
	public override get disk() {
		return 'uploads';
	}

	public get types() {
		return ['text/plain'];
	}

	public get maxBytes() {
		return 100;
	}

	public override get sniff() {
		return false;
	}
}

describe('Files and uploads', () => {
	let testing: TestingHttpApp | undefined;
	let store: MemoryFileStore;
	let uploads: MemoryDisk;
	const events: { event: string; file: FileRecord }[] = [];

	let staged: MemoryDisk;

	const boot = async (files: { maxPending?: number; staging?: string } = {}) => {
		store = new MemoryFileStore();
		uploads = new MemoryDisk({
			url: 'https://cdn.example.com',
			signing: { url: 'http://localhost/storage/uploads', secret: 'x'.repeat(32) }
		});
		staged = new MemoryDisk({
			signing: { url: 'http://localhost/storage/staged', secret: 'y'.repeat(32) }
		});
		@Application.register({
			modules: [
				PithosModule.with({
					disks: { uploads, staged },
					files: { store, uploadTtl: 600, unclaimedTtl: 3600, ...files }
				}),
				MediaModule
			]
		})
		class App extends Application {}
		testing = await Application.testing({ app: App, boot: 'eager' });
		await testing.http.get('/health').send();
		for (const event of [PITHOS_FILE_READY, PITHOS_FILE_REJECTED, PITHOS_FILE_DELETED]) {
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

	/** Uploads bytes through the signed URL of a ticket. */
	const put = async (url: string, body: Uint8Array | string, contentType: string) => {
		const parsed = new URL(url);
		return testing!.http
			.put(parsed.pathname + parsed.search)
			.header('content-type', contentType)
			.body(body)
			.send();
	};

	const openAvatar = async (size = PNG.byteLength) => {
		const ticket = await Uploads.open({
			purpose: 'avatar',
			contentType: 'image/png',
			size,
			owner: alice,
			user: 'alice'
		});
		return ticket.orThrow();
	};

	it('opens, uploads and finishes a file', async () => {
		await boot();
		const ticket = await openAvatar();
		expect(ticket.file).toMatchObject({
			purpose: 'avatar',
			disk: 'uploads',
			status: 'pending',
			size: PNG.byteLength,
			createdBy: 'alice'
		});
		expect(ticket.file.key).toBe(`avatar/${ticket.file.id}`);
		expect(ticket.headers).toEqual({
			'content-type': 'image/png',
			'content-length': String(PNG.byteLength)
		});

		expect((await put(ticket.url, PNG, 'image/png')).status).toBe(204);
		const finished = await Uploads.finish(ticket.file.id, { user: 'alice' });
		const file = finished.orThrow();
		expect(file.status).toBe('ready');
		expect(file.expiresAt!.getTime() - file.readyAt!.getTime()).toBe(3600_000);
		expect([...((await (await uploads.get(file.key))?.bytes()) ?? [])]).toEqual([...PNG]);
		expect(await uploads.exists(stagingKey(file.id))).toBe(false);
		expect(events).toEqual([{ event: PITHOS_FILE_READY, file }]);

		const again = await Uploads.finish(file.id);
		expect(again.error).toBeInstanceOf(UploadNotPendingError);
	});

	it('checks the request against its purpose', async () => {
		await boot({ maxPending: 1 });
		const open = (patch: Record<string, unknown>) =>
			Uploads.open({
				purpose: 'avatar',
				contentType: 'image/png',
				size: 10,
				owner: alice,
				user: 'alice',
				...patch
			});
		expect((await open({ purpose: 'banner' })).error).toBeInstanceOf(UploadPurposeUnknownError);
		expect((await open({ owner: { type: 'team', id: 't' } })).error).toBeInstanceOf(
			UploadPurposeUnknownError
		);
		const type = (await open({ contentType: 'image/gif' })).error;
		expect(type).toBeInstanceOf(UploadTypeNotAllowedError);
		expect(type?.extension()).toMatchObject({ types: ['image/png'] });
		const large = (await open({ size: 2048 })).error;
		expect(large).toBeInstanceOf(UploadTooLargeError);
		expect(large?.extension()).toMatchObject({ maxBytes: 1024 });
		expect((await open({ user: 'bob' })).error).toBeInstanceOf(ForbiddenError);
		expect((await open({ size: 0 })).error).toBeInstanceOf(BadRequestError);
		expect((await open({})).check()).toBe(true);
		expect((await open({})).error).toBeInstanceOf(UploadTooManyPendingError);
	});

	it('answers missing, expired and foreign uploads', async () => {
		await boot();
		const ticket = await openAvatar();
		expect((await Uploads.finish(ticket.file.id)).error).toBeInstanceOf(UploadMissingError);
		expect((await Uploads.finish(ticket.file.id, { user: 'bob' })).error).toBeInstanceOf(
			NotFoundError
		);
		expect((await Uploads.finish('nope')).error).toBeInstanceOf(NotFoundError);
		Clock.travel(601_000);
		expect((await Uploads.finish(ticket.file.id)).error).toBeInstanceOf(UploadExpiredError);
	});

	it('lets one finish of an upload through at a time', async () => {
		await boot();
		const ticket = await openAvatar();
		await put(ticket.url, PNG, 'image/png');
		const [first, second] = await Promise.all([
			Uploads.finish(ticket.file.id),
			Uploads.finish(ticket.file.id)
		]);
		expect([first.check(), second.check()].sort()).toEqual([false, true]);
		expect(first.error ?? second.error).toBeInstanceOf(UploadNotPendingError);
		expect(events.map((event) => event.event)).toEqual([PITHOS_FILE_READY]);
	});

	it('stages uploads on the staging disk when one is set', async () => {
		await boot({ staging: 'staged' });
		const ticket = await openAvatar();
		expect(new URL(ticket.url).pathname).toStartWith('/storage/staged/');
		expect((await put(ticket.url, PNG, 'image/png')).status).toBe(204);
		expect(await staged.exists(stagingKey(ticket.file.id))).toBe(true);
		const file = (await Uploads.finish(ticket.file.id)).orThrow();
		expect(await uploads.exists(file.key)).toBe(true);
		expect(await staged.exists(stagingKey(file.id))).toBe(false);
	});

	it('sweeps staged objects sent again after their upload finished', async () => {
		await boot();
		const ticket = await openAvatar();
		await put(ticket.url, PNG, 'image/png');
		(await Uploads.finish(ticket.file.id)).orThrow();
		// The URL still works until it expires, and nothing would delete what it writes.
		expect((await put(ticket.url, PNG, 'image/png')).status).toBe(204);
		expect(await uploads.exists(stagingKey(ticket.file.id))).toBe(true);
		Clock.travel(300_000);
		await Files.prune();
		expect(await uploads.exists(stagingKey(ticket.file.id))).toBe(true);
		Clock.travel(301_000);
		await Files.prune();
		expect(await uploads.exists(stagingKey(ticket.file.id))).toBe(false);
	});

	it('refuses a key that leaves out the id of the file', async () => {
		@Upload.purpose('shared-key')
		class SharedKeyUpload extends NoteUpload {
			public override key() {
				return 'notes/latest';
			}
		}
		void SharedKeyUpload;
		await boot();
		await expect(
			Uploads.open({ purpose: 'shared-key', contentType: 'text/plain', size: 5, owner: alice })
		).rejects.toThrow(TypeError);
	});

	it('refuses a file whose content is not its declared type', async () => {
		await boot();
		const ticket = await openAvatar(5);
		expect((await put(ticket.url, 'hello', 'image/png')).status).toBe(204);
		const refused = await Uploads.finish(ticket.file.id);
		expect(refused.error).toBeInstanceOf(UploadRejectedError);
		const file = await Files.find(ticket.file.id);
		expect(file).toMatchObject({ status: 'rejected', expiresAt: null });
		expect(file?.rejection).toContain('declared type');
		expect(await uploads.exists(stagingKey(ticket.file.id))).toBe(false);
		expect(events.map((event) => event.event)).toEqual([PITHOS_FILE_REJECTED]);
	});

	it('refuses a staged file of another type or size', async () => {
		await boot();
		const typed = await openAvatar();
		await uploads.put(stagingKey(typed.file.id), PNG, { contentType: 'image/webp' });
		expect((await Uploads.finish(typed.file.id)).error).toBeInstanceOf(UploadRejectedError);
		const sized = await openAvatar();
		await uploads.put(stagingKey(sized.file.id), PNG.slice(1), { contentType: 'image/png' });
		const refused = await Uploads.finish(sized.file.id);
		expect((refused.error as UploadRejectedError).reason).toContain('size');
	});

	it('skips the content check of a purpose that does not sniff', async () => {
		await boot();
		const ticket = (
			await Uploads.open({ purpose: 'note', contentType: 'text/plain', size: 5, owner: alice })
		).orThrow();
		expect(ticket.file.createdBy).toBeNull();
		await put(ticket.url, 'hello', 'text/plain');
		expect((await Uploads.finish(ticket.file.id)).orThrow().status).toBe('ready');
	});

	it('claims, checks, releases and deletes files', async () => {
		await boot();
		const ticket = await openAvatar();
		await put(ticket.url, PNG, 'image/png');
		const { id } = (await Uploads.finish(ticket.file.id)).orThrow();

		expect((await Files.ready(id, { purpose: 'avatar', owner: alice })).check()).toBe(true);
		expect((await Files.ready(id, { purpose: 'cover' })).error).toBeInstanceOf(FileNotReadyError);
		expect((await Files.claim(id, { owner: { type: 'user', id: 'bob' } })).error).toBeInstanceOf(
			FileNotReadyError
		);
		const claimed = (await Files.claim(id, { purpose: 'avatar', owner: alice })).orThrow();
		expect(claimed).toMatchObject({ expiresAt: null, releasedAt: null });
		expect(claimed.claimedAt).not.toBeNull();
		expect((await Files.claim(id)).check()).toBe(true);

		// A claimed file outlives its unclaimed time.
		Clock.travel(7200_000);
		expect(await Files.prune()).toBe(0);

		expect(await Files.release(id, { purpose: 'cover', grace: 60 })).toBeNull();
		const released = await Files.release(id, { purpose: 'avatar', grace: 60 });
		expect(released).toMatchObject({ claimedAt: null });
		expect(released!.expiresAt!.getTime() - Clock.epochMs()).toBe(60_000);
		expect(Files.url(released!)).toBe(`https://cdn.example.com/avatar/${id}`);
		expect(new URL(await Files.signedUrl(released!, 60)).searchParams.get('method')).toBe('GET');

		expect(await Files.remove(id, { owner: { type: 'user', id: 'bob' } })).toBe(false);
		expect(await Files.remove(id, { owner: alice })).toBe(true);
		expect(await Files.remove(id)).toBe(false);
		expect(await uploads.exists(`avatar/${id}`)).toBe(false);
		expect((await Files.claim(id)).error).toBeInstanceOf(FileNotReadyError);
		expect(events.at(-1)).toMatchObject({ event: PITHOS_FILE_DELETED });
	});

	it('prunes unfinished uploads and unclaimed files', async () => {
		await boot();
		const unfinished = await openAvatar();
		await put(unfinished.url, PNG, 'image/png');
		const kept = await openAvatar();
		await put(kept.url, PNG, 'image/png');
		const unclaimed = await openAvatar();
		await put(unclaimed.url, PNG, 'image/png');
		const keptFile = (await Uploads.finish(kept.file.id)).orThrow();
		const unclaimedFile = (await Uploads.finish(unclaimed.file.id)).orThrow();
		await Files.claim(keptFile.id);

		Clock.travel(601_000);
		expect(await Files.prune()).toBe(1);
		expect(await Files.find(unfinished.file.id)).toMatchObject({ status: 'expired' });
		expect(await uploads.exists(stagingKey(unfinished.file.id))).toBe(false);
		// The unclaimed file is past its time, so it cannot be claimed any more.
		Clock.travel(3600_000);
		expect((await Files.claim(unclaimedFile.id)).error).toBeInstanceOf(FileNotReadyError);

		class PruneFiles extends FilesPruner {
			protected override get chunkSize() {
				return 1;
			}

			public prune() {
				return this.execute();
			}
		}
		const job = new PruneFiles();
		await job.prune();
		expect(job.pruned).toBe(1);
		expect(await Files.find(unclaimedFile.id)).toMatchObject({ status: 'deleted' });
		expect(await uploads.exists(unclaimedFile.key)).toBe(false);
		expect(await Files.find(keptFile.id)).toMatchObject({ status: 'ready' });
	});

	it('uses the memory store by default', async () => {
		@Application.register({
			modules: [PithosModule.with({ disks: { uploads: new MemoryDisk() } })]
		})
		class App extends Application {}
		testing = await Application.testing({ app: App });
		await testing.http.get('/health').send();
		expect(await Files.find('nope')).toBeNull();
		expect(FileStore.for('memory')).toBeInstanceOf(MemoryFileStore);
	});

	it('refuses a purpose name that another class has', () => {
		expect(() => Upload.purpose('avatar')(class extends NoteUpload {})).toThrow(
			DuplicateUploadPurposeError
		);
		expect(() => Upload.purpose('Not Kebab')).toThrow(TypeError);
		expect(() => Upload.purpose('staging')).toThrow(TypeError);
		expect(Storage.defaultDisk()).toBe('default');
	});
});
