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

import type { Result } from '../result';
import type { DiskSource, SignedUrlOptions } from './storage';

import { Clock } from '../clock';
import { Lifecycle } from '../lifecycle';
import { getLogger } from '../logger';
import { Port } from '../port';
import { Result as R } from '../result';
import { Service } from '../service';
import { FileNotReadyError, FilesUnavailableError } from './errors';
import { PITHOS_DISKS, Storage } from './storage';

/**
 * Who a file belongs to: a kind of owner, such as `user`, and its id.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FileOwner = { readonly type: string; readonly id: string };

/**
 * Where a file is in its life: `pending` while it is uploaded, `finishing` while `finish()` checks
 * it, then `ready`, or `rejected` when the uploaded file was not what was declared, `expired` when
 * it was never finished, and `deleted` once its object is gone.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FileStatus = 'pending' | 'finishing' | 'ready' | 'rejected' | 'expired' | 'deleted';

/**
 * A file: an object of a disk, with what is known of it. One record follows a file from its
 * upload to its deletion.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
/**
 * What a purpose tells about a file beyond its bytes, such as the length of a video: a JSON
 * object, empty unless a purpose's `metadata()` or `Files.describe()` filled it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FileMetadata = Readonly<Record<string, unknown>>;

export type FileRecord = {
	readonly id: string;
	/** The upload purpose it was uploaded for. */
	readonly purpose: string;
	/** The name of its disk. */
	readonly disk: string;
	/** Its key on the disk, once ready. */
	readonly key: string;
	readonly contentType: string;
	/** Its size, in bytes. */
	readonly size: number;
	readonly owner: FileOwner;
	/** The id of who uploaded it, when known. */
	readonly createdBy: string | null;
	readonly status: FileStatus;
	readonly createdAt: Date;
	readonly readyAt: Date | null;
	/** When a feature claimed it; `null` while nothing keeps it. */
	readonly claimedAt: Date | null;
	readonly releasedAt: Date | null;
	/**
	 * When the file is pruned: the end of the upload while `pending` or `finishing`, and the
	 * deletion of a `ready` file nothing claims. `null` while claimed.
	 */
	readonly expiresAt: Date | null;
	readonly deletedAt: Date | null;
	/** Why the uploaded file was refused, on `rejected`. */
	readonly rejection: string | null;
	/** What its purpose tells about it, such as the length of a video. */
	readonly metadata: FileMetadata;
};

/**
 * The fields a transition may change.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FilePatch = Partial<
	Pick<
		FileRecord,
		| 'status'
		| 'readyAt'
		| 'claimedAt'
		| 'releasedAt'
		| 'expiresAt'
		| 'deletedAt'
		| 'rejection'
		| 'metadata'
	>
>;

/**
 * When a transition applies: the file has one of the statuses and, with `due`, an `expiresAt`
 * at or before it, or, with `live`, no `expiresAt` or one after it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FileCondition = {
	readonly status: readonly FileStatus[];
	readonly due?: Date;
	readonly live?: Date;
};

/**
 * Keeps the file records. Every change is a transition, which applies only when the record still
 * meets its condition, so two requests racing on a file cannot both win.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface FileStoreDriver {
	/** Adds a record. */
	insert(record: FileRecord): Promise<void>;
	/** A record by id, or `null`. */
	find(id: string): Promise<FileRecord | null>;
	/** Changes a record that meets the condition, and answers it changed, or `null`. */
	transition(id: string, when: FileCondition, patch: FilePatch): Promise<FileRecord | null>;
	/** How many uploads of someone are `pending` and not expired at `now`. */
	countPending(createdBy: string, now: Date): Promise<number>;
	/** Up to `limit` `pending`, `finishing` or `ready` records whose `expiresAt` is at or before `now`. */
	due(now: Date, limit: number): Promise<FileRecord[]>;
}

declare module '../port' {
	interface Ports {
		'file-store': FileStoreDriver;
	}

	interface PortDrivers {
		'file-store:memory': typeof MemoryFileStore;
	}
}

/**
 * The file store port. `memory` is built in, and is the default of `PithosModule`;
 * `@elysiumjs/drizzle` adds `drizzle`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class FileStore extends Port('file-store') {}

/** The statuses of the records `due()` answers. */
export const PRUNABLE: readonly FileStatus[] = ['pending', 'finishing', 'ready'];

/** Whether a record meets a condition. */
export const meets = (record: FileRecord, when: FileCondition): boolean =>
	when.status.includes(record.status) &&
	(when.due === undefined || (record.expiresAt !== null && record.expiresAt <= when.due)) &&
	(when.live === undefined || record.expiresAt === null || record.expiresAt > when.live);

/**
 * Keeps file records in memory, for tests and development: they are lost when the process ends.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@FileStore.driver('memory')
export class MemoryFileStore implements FileStoreDriver {
	readonly #records = new Map<string, FileRecord>();

	public async insert(record: FileRecord): Promise<void> {
		this.#records.set(record.id, { ...record });
	}

	public async find(id: string): Promise<FileRecord | null> {
		const record = this.#records.get(id);
		return record ? { ...record } : null;
	}

	public async transition(
		id: string,
		when: FileCondition,
		patch: FilePatch
	): Promise<FileRecord | null> {
		const record = this.#records.get(id);
		if (!record || !meets(record, when)) return null;
		const next = { ...record, ...patch };
		this.#records.set(id, next);
		return { ...next };
	}

	public async countPending(createdBy: string, now: Date): Promise<number> {
		let count = 0;
		for (const record of this.#records.values()) {
			if (record.createdBy === createdBy && meets(record, { status: ['pending'], live: now })) {
				count += 1;
			}
		}
		return count;
	}

	public async due(now: Date, limit: number): Promise<FileRecord[]> {
		return [...this.#records.values()]
			.filter((record) => meets(record, { status: PRUNABLE, due: now }))
			.sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())
			.slice(0, limit)
			.map((record) => ({ ...record }));
	}
}

/**
 * A value of {@link FilesOptions}, or a function read each time the value is used, such as one
 * that reads the application's configuration.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FilesSetting<T> = T | (() => T);

/**
 * How files live, as `PithosModule.with({ files })` sets it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FilesOptions = {
	/** How long an upload URL works, in seconds. Defaults to 900 (15 minutes). */
	readonly uploadTtl?: FilesSetting<number>;
	/** How long a ready file nothing claims is kept, in seconds. Defaults to 86,400 (a day). */
	readonly unclaimedTtl?: FilesSetting<number>;
	/** The uploads one person may have in progress at once. Defaults to 10. */
	readonly maxPending?: FilesSetting<number>;
	/**
	 * The disk uploads are staged on before `finish()` checks them; the disk of the purpose
	 * without one. Give a private disk when files go to a public one, so that unchecked bytes are
	 * never served.
	 */
	readonly staging?: string;
};

/** The service holding the file store and options of the application. */
export const PITHOS_FILES = 'pithos.files';

/**
 * The file store and options of the application, as `PithosModule` provides them.
 * @internal
 */
export type FilesSource = {
	readonly store: FileStoreDriver;
	/** The options, each read when used: a function given for one is called on every read. */
	readonly options: {
		readonly uploadTtl: number;
		readonly unclaimedTtl: number;
		readonly maxPending: number;
		readonly staging?: string;
	};
};

/** The defaults of {@link FilesOptions}. */
export const FILES_DEFAULTS = {
	uploadTtl: 900,
	unclaimedTtl: 86_400,
	maxPending: 10
} as const satisfies FilesOptions;

/**
 * The options of `PithosModule.with({ files })` over their defaults, each read when used.
 * @internal
 */
export const filesOptions = (options: FilesOptions): FilesSource['options'] => {
	const read = <T>(setting: FilesSetting<T>): T =>
		typeof setting === 'function' ? (setting as () => T)() : setting;
	const { uploadTtl, unclaimedTtl, maxPending } = { ...FILES_DEFAULTS, ...options };
	return {
		get uploadTtl() {
			return read(uploadTtl);
		},
		get unclaimedTtl() {
			return read(unclaimedTtl);
		},
		get maxPending() {
			return read(maxPending);
		},
		staging: options.staging
	};
};

/** The file store and options; throws without `PithosModule`. */
export const filesSource = (): FilesSource => {
	const source = Service.get<FilesSource>(PITHOS_FILES);
	if (!source) throw new FilesUnavailableError();
	return source;
};

/** Emitted once an uploaded file is checked and ready. */
export const PITHOS_FILE_READY = 'elysium:pithos:ready';

/** Emitted when an uploaded file is refused. */
export const PITHOS_FILE_REJECTED = 'elysium:pithos:rejected';

/** Emitted once a file is deleted, by `Files.remove()` or by pruning. */
export const PITHOS_FILE_DELETED = 'elysium:pithos:deleted';

/**
 * The data of the `elysium:pithos:*` lifecycle events.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FileEvent = { readonly file: FileRecord };

/** Emits an event; a listener that throws is logged. */
export const emitFileEvent = (event: string, file: FileRecord): void => {
	try {
		Lifecycle.emit<FileEvent>(event, { file });
	} catch (error) {
		getLogger().error('A file event listener failed', {
			event,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};

/** Deletes an object, logging a failure instead of failing the request or the job. */
export const deleteQuietly = async (disk: string, key: string): Promise<void> => {
	try {
		await Storage.disk(disk).delete(key);
	} catch (error) {
		getLogger().error('A file object could not be deleted', {
			disk,
			key,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};

/** The prefix of staged uploads, which no purpose may use. */
export const STAGING_PREFIX = 'staging/';

/** The key an upload writes to, never the key the file is served from. */
export const stagingKey = (id: string): string => `${STAGING_PREFIX}${id}`;

/** The disk a file of a disk is staged on. */
export const stagingDisk = (disk: string): string => filesSource().options.staging ?? disk;

const after = (from: Date, seconds: number): Date => new Date(from.getTime() + seconds * 1000);

/**
 * What a file must be for a use: of this purpose, of this owner.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FileExpectation = { readonly purpose?: string; readonly owner?: FileOwner };

const fits = (file: FileRecord, expect: FileExpectation): boolean =>
	(expect.purpose === undefined || file.purpose === expect.purpose) &&
	(expect.owner === undefined ||
		(file.owner.type === expect.owner.type && file.owner.id === expect.owner.id));

/**
 * The files of the application: find, check, claim, release and delete them. A ready file that
 * nothing claims is deleted once `unclaimedTtl` has passed; claiming it keeps it, and releasing
 * it lets it go. `Uploads` makes files.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * // When a profile keeps an uploaded picture.
 * const claimed = await Files.claim(input.avatarId, { purpose: 'avatar', owner: { type: 'user', id: userId } });
 * if (!claimed.check()) return claimed.error; // FILE_NOT_READY
 * // When it changes picture.
 * await Files.release(previousAvatarId);
 * ```
 */
export namespace Files {
	/** A file by id, or `null`. */
	export const find = (id: string): Promise<FileRecord | null> => filesSource().store.find(id);

	/**
	 * Checks that a file is ready for a use without claiming it: ready, not expired and, when
	 * given, of the purpose and the owner.
	 */
	export const ready = async (
		id: string,
		expect: FileExpectation = {}
	): Promise<Result<FileRecord, FileNotReadyError>> => {
		const file = await find(id);
		if (!file || !meets(file, { status: ['ready'], live: Clock.now() }) || !fits(file, expect)) {
			return R.fail(new FileNotReadyError());
		}
		return R.pass(file);
	};

	/**
	 * Keeps a ready file, for good or until it is released. Claiming a claimed file again keeps it
	 * claimed.
	 */
	export const claim = async (
		id: string,
		expect: FileExpectation = {}
	): Promise<Result<FileRecord, FileNotReadyError>> => {
		const checked = await ready(id, expect);
		if (!checked.check()) return checked;
		const now = Clock.now();
		const claimed = await filesSource().store.transition(
			id,
			{ status: ['ready'], live: now },
			{ claimedAt: now, releasedAt: null, expiresAt: null }
		);
		return claimed ? R.pass(claimed) : R.fail(new FileNotReadyError());
	};

	/**
	 * Adds to what is known about a ready file, such as the length a video service reports once
	 * it has processed the file: the keys given replace those of the file's metadata, the others
	 * stay. Two calls racing on one file may each keep only their own keys.
	 */
	export const describe = async (
		id: string,
		metadata: FileMetadata,
		expect: FileExpectation = {}
	): Promise<Result<FileRecord, FileNotReadyError>> => {
		const checked = await ready(id, expect);
		if (!checked.check()) return checked;
		const described = await filesSource().store.transition(
			id,
			{ status: ['ready'], live: Clock.now() },
			{ metadata: { ...checked.result.metadata, ...metadata } }
		);
		return described ? R.pass(described) : R.fail(new FileNotReadyError());
	};

	/**
	 * Lets a ready file go: it is deleted once `grace` seconds have passed (0 by default), unless it
	 * is claimed again before. A file has one keeper: a feature that shares a file with another
	 * keeps track of it itself. Answers the file, or `null` when it is not ready or does not meet
	 * `expect`.
	 */
	export const release = async (
		id: string,
		options: FileExpectation & { readonly grace?: number } = {}
	): Promise<FileRecord | null> => {
		const file = await find(id);
		if (!file || !fits(file, options)) return null;
		const now = Clock.now();
		return filesSource().store.transition(
			id,
			{ status: ['ready'] },
			{ claimedAt: null, releasedAt: now, expiresAt: after(now, options.grace ?? 0) }
		);
	};

	/**
	 * Deletes a ready file and its object now. Answers whether there was one that meets `expect`.
	 * Inside a unit of work, call it once the work has committed, since the object cannot be put
	 * back.
	 */
	export const remove = async (id: string, expect: FileExpectation = {}): Promise<boolean> => {
		const found = await find(id);
		if (!found || !fits(found, expect)) return false;
		const now = Clock.now();
		const file = await filesSource().store.transition(
			id,
			{ status: ['ready'] },
			{ status: 'deleted', deletedAt: now, expiresAt: null }
		);
		if (!file) return false;
		await deleteQuietly(file.disk, file.key);
		emitFileEvent(PITHOS_FILE_DELETED, file);
		return true;
	};

	/**
	 * Deletes up to `limit` files whose time is over: uploads never finished (their staged object,
	 * and their object should a finish have stopped half way) and ready files nothing claims (their
	 * object). A file claimed in the meantime is kept. Then deletes the staged objects whose upload
	 * URL has expired, such as one sent again through the URL after the upload finished. Answers how
	 * many files were pruned.
	 */
	export const prune = async (limit = 100): Promise<number> => {
		const { store, options } = filesSource();
		const now = Clock.now();
		let pruned = 0;
		for (const file of await store.due(now, limit)) {
			const expired = file.status !== 'ready';
			const done = await store.transition(
				file.id,
				{ status: [file.status], due: now },
				expired
					? { status: 'expired', expiresAt: null }
					: { status: 'deleted', deletedAt: now, expiresAt: null }
			);
			if (!done) continue;
			pruned += 1;
			if (expired) await deleteQuietly(stagingDisk(file.disk), stagingKey(file.id));
			await deleteQuietly(file.disk, file.key);
			if (!expired) emitFileEvent(PITHOS_FILE_DELETED, done);
		}
		if (pruned < limit) await sweepStaging(after(now, -options.uploadTtl), limit);
		return pruned;
	};

	/**
	 * Deletes staged objects written before `before`. An upload URL works for `uploadTtl` from its
	 * file's creation, and its object is written after that, so an object older than `uploadTtl`
	 * belongs to an upload whose URL has expired.
	 */
	const sweepStaging = async (before: Date, limit: number): Promise<void> => {
		const disks = Service.get<DiskSource>(PITHOS_DISKS);
		const names = new Set((disks?.names() ?? []).map((name) => stagingDisk(name)));
		for (const name of names) {
			const disk = Storage.disk(name);
			let cursor: string | undefined;
			do {
				const page = await disk.list({ prefix: STAGING_PREFIX, cursor, limit });
				for (const object of page.items) {
					if (object.lastModified <= before) await deleteQuietly(name, object.key);
				}
				cursor = page.nextCursor ?? undefined;
			} while (cursor);
		}
	};

	/** The public URL of a file, on a public disk. */
	export const url = (file: Pick<FileRecord, 'disk' | 'key'>): string =>
		Storage.disk(file.disk).url(file.key);

	/** A signed URL that downloads a file until it expires. */
	export const signedUrl = (
		file: Pick<FileRecord, 'disk' | 'key'>,
		expiresIn: number
	): Promise<string> =>
		Storage.disk(file.disk).signedUrl(file.key, {
			method: 'GET',
			expiresIn
		} satisfies SignedUrlOptions);

	/** The time a pending upload ends, from the options. */
	export const uploadDeadline = (from: Date): Date => after(from, filesSource().options.uploadTtl);

	/** The time a ready file nothing claims is deleted, from the options. */
	export const unclaimedDeadline = (from: Date): Date =>
		after(from, filesSource().options.unclaimedTtl);
}
