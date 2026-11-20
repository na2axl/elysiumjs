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

import type { DomainError } from '../problem.js';
import type { Result } from '../result.js';
import type { FileMetadata, FileOwner, FileRecord } from './files.js';
import type { StorageDriver, UploadedPart } from './storage.js';

import { Clock } from '../clock.js';
import { Metadata } from '../metadata.js';
import { ModuleContext } from '../module-context.js';
import { uuidv7 } from '../moirai/ids.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../problem.js';
import { Result as R } from '../result.js';
import { Service } from '../service.js';
import { Symbols } from '../utils.js';
import {
	DuplicateUploadPurposeError,
	MissingUploadPurposeServiceError,
	MultipartOnPublicDiskError,
	UploadExpiredError,
	UploadMissingError,
	UploadNotPendingError,
	UploadPartInvalidError,
	UploadPartSizeError,
	UploadPurposeUnknownError,
	UploadRejectedError,
	UploadTooLargeError,
	UploadTooManyPendingError,
	UploadTypeNotAllowedError
} from './errors.js';
import {
	abortQuietly,
	deleteQuietly,
	emitFileEvent,
	Files,
	filesSource,
	meets,
	partCountOf,
	partSizeOf,
	PITHOS_FILE_EXPIRED,
	PITHOS_FILE_READY,
	PITHOS_FILE_REJECTED,
	STAGING_PREFIX,
	stagingDisk,
	stagingKey
} from './files.js';
import {
	assertKey,
	DiskCannotMultipartError,
	DiskNotPublicError,
	headOf,
	MAX_PARTS,
	MIN_PART_BYTES,
	MultipartPartsMismatchError,
	MultipartUploadNotFoundError,
	Storage
} from './storage.js';

/** How long a part URL works, in seconds; the client asks again past it. */
const PART_URL_TTL = 3600;

/** The most part URLs one `signParts()` call answers. */
const MAX_SIGNED_PARTS = 100;

/** The kebab-case name of a purpose, which prefixes the keys of its files by default. */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A class of upload purpose, whatever its constructor injects. */
type UploadClass = new (...args: any[]) => Upload<any>;

const purposes = new Map<string, UploadClass>();
const names = new WeakMap<UploadClass, string>();
const instances = new WeakMap<UploadClass, Upload>();

/**
 * An upload purpose: what files of a use may be, and who may upload them. A purpose is a class
 * decorated with `@Upload.purpose(name)`. When it is listed in the services of a module, it is
 * built by the container, in that module, and can inject what it needs.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Upload.purpose('avatar')
 * export class AvatarUpload extends Upload {
 * 	get disk() { return 'public'; }
 * 	get types() { return ['image/png', 'image/jpeg', 'image/webp']; }
 * 	get maxBytes() { return 5 * 1024 * 1024; }
 * 	get owners() { return ['user']; }
 * 	authorize(owner: FileOwner, user: string | undefined) {
 * 		return owner.id === user;
 * 	}
 * }
 * ```
 */
export abstract class Upload<TMetadata extends FileMetadata = FileMetadata> {
	/**
	 * Registers a class as an upload purpose.
	 * @param name The kebab-case name of the purpose.
	 * @throws {DuplicateUploadPurposeError} When another class has the name.
	 */
	public static purpose(name: string) {
		if (!NAME.test(name)) throw new TypeError(`"${name}" is not a kebab-case purpose name.`);
		if (`${name}/` === STAGING_PREFIX) throw new TypeError('"staging" is kept for staged uploads.');
		return <C extends UploadClass>(target: C): C => {
			const existing = purposes.get(name);
			if (existing && existing !== target) throw new DuplicateUploadPurposeError(name);
			purposes.set(name, target);
			names.set(target, name);
			return target;
		};
	}

	/** The purpose class registered under a name, if any. */
	public static find(name: string): UploadClass | undefined {
		return purposes.get(name);
	}

	/** The content types the purpose takes, such as `image/png`. */
	public abstract get types(): readonly string[];

	/** The largest file the purpose takes, in bytes. */
	public abstract get maxBytes(): number;

	/** The name of the disk the files go to; the default disk without one. */
	public get disk(): string | undefined {
		return undefined;
	}

	/** The kinds of owners files may belong to, such as `['user']`; any without one. */
	public get owners(): readonly string[] | undefined {
		return undefined;
	}

	/**
	 * Whether the first bytes of a file must show its declared type (with `file-type`). Turn it off
	 * for types that have no signature, such as `text/plain` or `image/svg+xml`. Defaults to `true`.
	 */
	public get sniff(): boolean {
		return true;
	}

	/**
	 * The `Cache-Control` header a ready file is served with. None by default. With the default
	 * `key()`, a key never holds other content, so `public, max-age=31536000, immutable` is safe
	 * for a public disk.
	 */
	public get cacheControl(): string | undefined {
		return undefined;
	}

	/**
	 * Uploads files in parts of `partBytes` bytes, for large files: the client sends each part to
	 * its own signed URL, and can resume an upload by listing the parts already sent. The disk must
	 * be private and support multipart uploads, and `partBytes` at least 5 MiB. `undefined` by
	 * default: a file is uploaded in one request.
	 */
	public get multipart(): { readonly partBytes: number } | undefined {
		return undefined;
	}

	/**
	 * How long an upload may take, in seconds; the `uploadTtl` of `PithosModule` without one. For
	 * an upload in parts, each `Uploads.signParts()` call moves the deadline this far ahead again,
	 * up to `uploadTtlMax` from the start.
	 */
	public get uploadTtl(): number | undefined {
		return undefined;
	}

	/** The longest an upload in parts may take, in seconds, however it is extended; `uploadTtl` without one. */
	public get uploadTtlMax(): number | undefined {
		return undefined;
	}

	/**
	 * How many first bytes of a file uploaded in parts are read to check its type and given to
	 * `metadata()`. Defaults to 4,100, what `file-type` needs.
	 */
	public get sniffBytes(): number {
		return 4100;
	}

	/**
	 * Admits or refuses an upload once its type, size and owner are checked, such as against a
	 * quota, with the request's `declared` values. A refusal is answered as it is. What it answers
	 * is kept in the metadata of the pending file, under what `metadata()` adds when it is ready.
	 * Admits everything by default.
	 * @param request The upload request.
	 */
	public admit(
		_request: UploadRequest
	): Result<FileMetadata | void, DomainError> | Promise<Result<FileMetadata | void, DomainError>> {
		return R.pass(undefined);
	}

	/**
	 * What to keep about a file once it has passed its checks, such as the length of a video,
	 * read from its bytes. Kept in the file's `metadata` when it is made ready. Throwing refuses
	 * the file (`UPLOAD_REJECTED`, with the error's message). Nothing by default. For a purpose
	 * that uploads in parts, `bytes` are only the first `sniffBytes` of the file.
	 * @param file The file being finished.
	 * @param bytes The checked bytes of the file.
	 */
	public metadata(_file: FileRecord, _bytes: Uint8Array): TMetadata | Promise<TMetadata> {
		return {} as TMetadata;
	}

	/** Whether someone may upload a file for an owner. Everyone may by default. */
	public authorize(_owner: FileOwner, _user: string | undefined): boolean | Promise<boolean> {
		return true;
	}

	/**
	 * The key a ready file is served from. Defaults to `<purpose>/<id>`: a new file is a new key,
	 * so a served file can be cached for good. A key must hold the id of the file, so that two
	 * files never share an object, and must not start with `staging/`.
	 */
	public key(file: Pick<FileRecord, 'id' | 'purpose' | 'owner' | 'contentType'>): string {
		return `${file.purpose}/${file.id}`;
	}
}

/** Runs work with the instance of a purpose, built in its module when it is a service. */
const withPurpose = async <R>(cls: UploadClass, work: (purpose: Upload<any>) => R): Promise<R> => {
	const [owner] = Service.ownersOf(cls);
	if (owner) {
		return ModuleContext.run(owner, async () => work((await Service.resolve(cls)) as Upload));
	}
	if (Service.exists(cls)) return work((await Service.resolve(cls)) as Upload);
	if (Metadata.get(Symbols.serviceOptions, cls)) {
		throw new MissingUploadPurposeServiceError(cls.name);
	}
	let instance = instances.get(cls);
	if (!instance) {
		instance = new cls();
		instances.set(cls, instance);
	}
	return work(instance);
};

/**
 * What starting an upload takes.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type UploadRequest = {
	/** The name of the purpose. */
	readonly purpose: string;
	/** The content type of the file, which the upload must send. */
	readonly contentType: string;
	/** The size of the file, in bytes, which the upload must have. */
	readonly size: number;
	/** Who the file belongs to. */
	readonly owner: FileOwner;
	/** The id of who uploads it: the purpose authorizes them, and their uploads in progress are capped. */
	readonly user?: string;
	/** What the client declares about the file, such as the length of a video, for `admit()`. */
	readonly declared?: FileMetadata;
};

/**
 * Where and how to upload a file: a `PUT` of its bytes to `url`, with `headers`, before
 * `expiresAt`. A browser sets `content-length` itself from the body, and refuses to set it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type UploadTicket = {
	readonly mode: 'single';
	readonly file: FileRecord;
	readonly url: string;
	readonly method: 'PUT';
	readonly headers: Readonly<Record<string, string>>;
	readonly expiresAt: Date;
};

/**
 * How to upload a file in parts: `partCount` parts of `partBytes` bytes, the last one holding the
 * rest, each sent to a URL from `Uploads.signParts()`, before `expiresAt`. Then
 * `Uploads.finish()` joins them.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MultipartTicket = {
	readonly mode: 'multipart';
	readonly file: FileRecord;
	readonly partBytes: number;
	readonly partCount: number;
	readonly expiresAt: Date;
};

/**
 * A URL that uploads one part: a `PUT` of exactly the part's bytes, with `headers`, before
 * `expiresAt`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SignedPart = {
	readonly number: number;
	readonly url: string;
	readonly method: 'PUT';
	readonly headers: Readonly<Record<string, string>>;
	readonly expiresAt: Date;
};

/**
 * The part URLs `Uploads.signParts()` answers, and the deadline of the upload they extended.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SignedParts = { readonly parts: readonly SignedPart[]; readonly expiresAt: Date };

/**
 * Where an upload in parts is: the parts the disk holds, by number.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type UploadProgress = {
	readonly file: FileRecord;
	readonly partBytes: number;
	readonly partCount: number;
	readonly parts: readonly UploadedPart[];
	/**
	 * Whether the disk no longer holds the upload: most often a finish joined the parts and stopped
	 * before the file was ready. `parts` is then empty, and the client finishes again instead of
	 * sending parts; an upload dropped from the disk is then refused.
	 */
	readonly joined: boolean;
	readonly expiresAt: Date;
};

/**
 * What `Uploads.signParts()` and `Uploads.listParts()` may answer.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type UploadPartsErrors =
	| BadRequestError
	| NotFoundError
	| UploadNotPendingError
	| UploadExpiredError
	| UploadPartInvalidError;

/** The errors of `Uploads.signParts()` and `Uploads.listParts()`, for the `errors` of a route. */
export const UPLOAD_PARTS_ERRORS = [
	BadRequestError,
	NotFoundError,
	UploadNotPendingError,
	UploadExpiredError,
	UploadPartInvalidError
] as const;

/**
 * What `Uploads.abort()` may answer.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type AbortUploadErrors = NotFoundError | UploadNotPendingError;

/** The errors of `Uploads.abort()`, for the `errors` of a route. */
export const ABORT_UPLOAD_ERRORS = [NotFoundError, UploadNotPendingError] as const;

/**
 * What `Uploads.open()` may answer.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type OpenUploadErrors =
	| BadRequestError
	| UploadPurposeUnknownError
	| UploadTypeNotAllowedError
	| UploadTooLargeError
	| ForbiddenError
	| UploadTooManyPendingError;

/**
 * What `Uploads.finish()` may answer.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FinishUploadErrors =
	| NotFoundError
	| UploadNotPendingError
	| UploadExpiredError
	| UploadMissingError
	| UploadRejectedError;

/** The errors of `Uploads.open()`, for the `errors` of a route. */
export const OPEN_UPLOAD_ERRORS = [
	BadRequestError,
	UploadPurposeUnknownError,
	UploadTypeNotAllowedError,
	UploadTooLargeError,
	ForbiddenError,
	UploadTooManyPendingError
] as const;

/** The errors of `Uploads.finish()`, for the `errors` of a route. */
export const FINISH_UPLOAD_ERRORS = [
	NotFoundError,
	UploadNotPendingError,
	UploadExpiredError,
	UploadMissingError,
	UploadRejectedError
] as const;

/**
 * Deferred uploads: the client uploads a file straight to the disk through signed URLs, then the
 * server checks it. `open()` makes a `pending` file and answers how to upload it:
 *
 * - in one request, to a staging key; `finish()` reads the staged object once, checks its size,
 *   its stored type and its first bytes, writes those bytes to the file's key and makes the file
 *   `ready`;
 * - in parts, for a purpose with `multipart`, straight to the file's key: `signParts()` answers
 *   the part URLs, `listParts()` what was sent, and `finish()` joins the parts, checks the size
 *   and the first bytes, and makes the file `ready` without reading the rest.
 *
 * A file that fails a check is `rejected`; one given up with `abort()` or never uploaded expires,
 * and pruning removes it.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * const ticket = await Uploads.open({
 * 	purpose: 'avatar',
 * 	contentType: 'image/png',
 * 	size: 52_133,
 * 	owner: { type: 'user', id: userId },
 * 	user: userId
 * });
 * if (!ticket.check()) return ticket.error;
 * if (ticket.result.mode === 'single') {
 * 	// The client sends PUT ticket.result.url with ticket.result.headers, then:
 * 	const file = await Uploads.finish(ticket.result.file.id, { user: userId });
 * }
 * ```
 */
export namespace Uploads {
	/**
	 * Starts an upload: checks the request against its purpose, and answers where to upload. The
	 * file record is written through the file store, which joins a transaction open around the
	 * call, such as the one of an action: if it rolls back, the upload is gone with it.
	 */
	export const open = async (
		request: UploadRequest
	): Promise<Result<UploadTicket | MultipartTicket, OpenUploadErrors | DomainError>> => {
		if (!Number.isInteger(request.size) || request.size < 1) {
			return R.fail(
				new BadRequestError('The size of the file must be a positive number of bytes.')
			);
		}
		const cls = Upload.find(request.purpose);
		if (!cls) return R.fail(new UploadPurposeUnknownError(request.purpose));
		return withPurpose(cls, async (purpose) => {
			const owners = purpose.owners;
			if (owners && !owners.includes(request.owner.type)) {
				return R.fail(new UploadPurposeUnknownError(request.purpose));
			}
			if (!purpose.types.includes(request.contentType)) {
				return R.fail(new UploadTypeNotAllowedError(purpose.types));
			}
			const maxBytes = purpose.maxBytes;
			if (request.size > maxBytes) {
				return R.fail(new UploadTooLargeError(maxBytes));
			}
			if (!(await purpose.authorize(request.owner, request.user))) {
				return R.fail(new ForbiddenError('You cannot upload files for this owner.'));
			}

			const { store, options } = filesSource();
			const now = Clock.now();
			const user = request.user ?? null;
			if (user !== null && (await store.countPending(user, now)) >= options.maxPending) {
				return R.fail(new UploadTooManyPendingError());
			}

			const diskName = purpose.disk ?? Storage.defaultDisk();
			const disk = Storage.disk(diskName);
			const multipart = purpose.multipart;
			if (multipart) checkMultipart(request.purpose, purpose, diskName);

			const admitted = await purpose.admit(request);
			if (!admitted.check()) return R.fail(admitted.error);

			const id = uuidv7(now.getTime());
			const ttl = purpose.uploadTtl ?? options.uploadTtl;
			const expiresAt = after(now, ttl);
			const base = {
				id,
				purpose: request.purpose,
				owner: { type: request.owner.type, id: request.owner.id },
				contentType: request.contentType
			};
			const key = purpose.key(base);
			if (!key.includes(id) || key.startsWith(STAGING_PREFIX)) {
				throw new TypeError(
					`The key "${key}" of the purpose "${request.purpose}" must hold the id of the file and not start with "${STAGING_PREFIX}".`
				);
			}
			assertKey(key);
			const pending: FileRecord = {
				...base,
				disk: diskName,
				key,
				size: request.size,
				createdBy: user,
				status: 'pending',
				createdAt: now,
				readyAt: null,
				claimedAt: null,
				releasedAt: null,
				expiresAt,
				deletedAt: null,
				rejection: null,
				metadata: { ...(admitted.result ?? {}) }
			};

			if (multipart) {
				const uploadId = await disk.multipart!.create(key, {
					contentType: request.contentType,
					cacheControl: purpose.cacheControl
				});
				const file: FileRecord = {
					...pending,
					multipart: { uploadId, partBytes: multipart.partBytes }
				};
				try {
					await store.insert(file);
				} catch (error) {
					await abortQuietly(diskName, key, uploadId);
					throw error;
				}
				return R.pass({
					mode: 'multipart' as const,
					file: withoutUpload(file),
					partBytes: multipart.partBytes,
					partCount: partCountOf(request.size, multipart.partBytes),
					expiresAt
				});
			}

			const url = await Storage.disk(stagingDisk(diskName)).signedUrl(stagingKey(id), {
				method: 'PUT',
				expiresIn: ttl,
				contentType: request.contentType,
				contentLength: request.size
			});
			await store.insert(pending);
			return R.pass({
				mode: 'single' as const,
				file: pending,
				url,
				method: 'PUT' as const,
				headers: { 'content-type': request.contentType, 'content-length': String(request.size) },
				expiresAt
			});
		});
	};

	/**
	 * The URLs that upload parts of an upload in parts, at most 100 a call, each working for an
	 * hour and signed with the exact size of its part: `partBytes`, or the rest for the last part.
	 * Each call moves the deadline of the upload `uploadTtl` ahead again, up to `uploadTtlMax` from
	 * its start. `user`, when given, must be who started the upload.
	 */
	export const signParts = async (
		id: string,
		numbers: readonly number[],
		call: { readonly user?: string } = {}
	): Promise<Result<SignedParts, UploadPartsErrors>> => {
		const found = await pendingUpload(id, call);
		if (!found.check()) return found;
		const { file, multipart } = found.result;
		const partCount = partCountOf(file.size, multipart.partBytes);
		const wanted = [...new Set(numbers)];
		if (wanted.length > MAX_SIGNED_PARTS) {
			return R.fail(new BadRequestError(`Ask for at most ${MAX_SIGNED_PARTS} parts at once.`));
		}
		if (wanted.some((n) => !Number.isInteger(n) || n < 1 || n > partCount)) {
			return R.fail(new UploadPartInvalidError(partCount));
		}

		const now = Clock.now();
		const { ttl, ttlMax } = await ttlsOf(file);
		const deadline = new Date(
			Math.min(after(now, ttl).getTime(), after(file.createdAt, ttlMax).getTime())
		);
		const extended =
			file.expiresAt !== null && deadline > file.expiresAt
				? await filesSource().store.transition(
						file.id,
						{ status: ['pending'], live: now },
						{ expiresAt: deadline }
					)
				: file;
		if (!extended) return R.fail(new UploadNotPendingError());
		const expiresAt = extended.expiresAt ?? deadline;

		const disk = Storage.disk(file.disk);
		const urlExpiresAt = new Date(
			Math.min(after(now, PART_URL_TTL).getTime(), expiresAt.getTime())
		);
		const expiresIn = Math.max(1, Math.ceil((urlExpiresAt.getTime() - now.getTime()) / 1000));
		const parts = await Promise.all(
			wanted.map(async (number) => {
				const contentLength = partSizeOf(file.size, multipart.partBytes, number);
				const url = await disk.multipart!.signPart(file.key, multipart.uploadId, number, {
					contentLength,
					expiresIn
				});
				return {
					number,
					url,
					method: 'PUT' as const,
					headers: { 'content-length': String(contentLength) },
					expiresAt: urlExpiresAt
				};
			})
		);
		return R.pass({ parts, expiresAt });
	};

	/**
	 * Where an upload in parts is: the parts the disk holds, so that a client resumes an upload
	 * after a crash or from another device. `user`, when given, must be who started the upload.
	 */
	export const listParts = async (
		id: string,
		call: { readonly user?: string } = {}
	): Promise<Result<UploadProgress, UploadPartsErrors>> => {
		const found = await pendingUpload(id, call);
		if (!found.check()) return found;
		const { file, multipart } = found.result;
		const listed = await Storage.disk(file.disk).multipart!.listParts(file.key, multipart.uploadId);
		return R.pass({
			file: withoutUpload(file),
			partBytes: multipart.partBytes,
			partCount: partCountOf(file.size, multipart.partBytes),
			parts: listed ?? [],
			joined: listed === null,
			expiresAt: file.expiresAt!
		});
	};

	/**
	 * Gives up an upload that is `pending`: the file expires, and the parts sent are dropped, along
	 * with an object they were already joined into.
	 * `user`, when given, must be who started the upload.
	 */
	export const abort = async (
		id: string,
		call: { readonly user?: string } = {}
	): Promise<Result<FileRecord, AbortUploadErrors>> => {
		const { store } = filesSource();
		const file = await store.find(id);
		if (!file || (call.user !== undefined && file.createdBy !== call.user)) {
			return R.fail(new NotFoundError('No such upload.'));
		}
		const expired = await store.transition(
			file.id,
			{ status: ['pending'] },
			{ status: 'expired', expiresAt: null }
		);
		if (!expired) return R.fail(new UploadNotPendingError());
		if (file.multipart) {
			await abortQuietly(file.disk, file.key, file.multipart.uploadId);
			// Parts joined by a finish that did not take (it stopped half way) sit at the key.
			await deleteQuietly(file.disk, file.key);
		} else {
			await deleteQuietly(stagingDisk(file.disk), stagingKey(file.id));
		}
		emitFileEvent(PITHOS_FILE_EXPIRED, expired);
		return R.pass(expired);
	};

	/**
	 * Finishes an upload: what was uploaded must be exactly what was declared. The file is
	 * `finishing` while it is checked, so a second call answers `UPLOAD_NOT_PENDING` instead of
	 * racing it. `user`, when given, must be who started the upload. A file uploaded in one
	 * request is held in memory while it is checked; one uploaded in parts never is: only its first
	 * `sniffBytes` are read. A missing part answers `UPLOAD_MISSING`: send it, then finish again.
	 */
	export const finish = async (
		id: string,
		call: { readonly user?: string } = {}
	): Promise<Result<FileRecord, FinishUploadErrors>> => {
		const { store } = filesSource();
		const file = await store.find(id);
		if (!file || (call.user !== undefined && file.createdBy !== call.user)) {
			return R.fail(new NotFoundError('No such upload.'));
		}
		if (file.status !== 'pending') return R.fail(new UploadNotPendingError());
		const now = Clock.now();
		if (!meets(file, { status: ['pending'], live: now })) return R.fail(new UploadExpiredError());
		const finishing = await store.transition(
			file.id,
			{ status: ['pending'], live: now },
			{ status: 'finishing' }
		);
		if (!finishing) return R.fail(new UploadNotPendingError());
		return finishing.multipart ? finishParts(finishing, now) : finishSingle(finishing, now);
	};

	/** Finishes an upload sent in one request, to its staging key. */
	const finishSingle = async (
		finishing: FileRecord,
		now: Date
	): Promise<Result<FileRecord, FinishUploadErrors>> => {
		const { store } = filesSource();
		const file = finishing;
		const staging = { disk: stagingDisk(file.disk), key: stagingKey(file.id) };
		const back = () => store.transition(file.id, { status: ['finishing'] }, { status: 'pending' });
		const refuse = (reason: string) =>
			refuseFile(file, reason, () => deleteQuietly(staging.disk, staging.key));

		let metadata: FileMetadata = file.metadata;
		try {
			// One read: the checks and the write use the same bytes, so an upload sent again
			// through the still valid URL cannot swap them in between.
			const staged = await Storage.disk(staging.disk).get(staging.key);
			if (!staged) {
				await back();
				return R.fail(new UploadMissingError());
			}
			if (staged.size !== file.size) {
				await staged.body.cancel().catch(() => undefined);
				return refuse('the file does not have the declared size');
			}
			if (staged.contentType !== file.contentType) {
				await staged.body.cancel().catch(() => undefined);
				return refuse('the file does not have the declared type');
			}
			const bytes = await staged.bytes();
			if (bytes.byteLength !== file.size) return refuse('the file does not have the declared size');
			const cls = Upload.find(file.purpose);
			const { sniff, cacheControl } = cls
				? await withPurpose(cls, (purpose) => ({
						sniff: purpose.sniff,
						cacheControl: purpose.cacheControl
					}))
				: { sniff: true, cacheControl: undefined };
			if (sniff && (await detectType(bytes)) !== file.contentType) {
				return refuse('the content of the file is not of the declared type');
			}
			if (cls) {
				try {
					const read = await withPurpose(cls, (purpose) => purpose.metadata(finishing, bytes));
					metadata = { ...metadata, ...read };
				} catch (error) {
					// A file the purpose cannot read, such as a broken video, is refused for good.
					return refuse(error instanceof Error ? error.message : 'the file could not be read');
				}
			}

			await Storage.disk(file.disk).put(file.key, bytes, {
				contentType: file.contentType,
				cacheControl
			});
		} catch (error) {
			// The client may finish again; pruning removes what a stop half way leaves.
			await back();
			throw error;
		}
		const ready = await store.transition(
			file.id,
			{ status: ['finishing'] },
			{ status: 'ready', readyAt: now, expiresAt: Files.unclaimedDeadline(now), metadata }
		);
		if (!ready) {
			// Pruning expired the file while it was checked: its object belongs to no file.
			await deleteQuietly(file.disk, file.key);
			return R.fail(new UploadNotPendingError());
		}
		await deleteQuietly(staging.disk, staging.key);
		emitFileEvent(PITHOS_FILE_READY, ready);
		return R.pass(ready);
	};

	/**
	 * Finishes an upload sent in parts, to the file's own key. When the disk no longer knows the
	 * upload but holds an object of the declared size at the key, a previous finish completed it
	 * and stopped before the file was ready: the checks carry on from there.
	 */
	const finishParts = async (
		file: FileRecord,
		now: Date
	): Promise<Result<FileRecord, FinishUploadErrors>> => {
		const { store } = filesSource();
		const multipart = file.multipart!;
		const disk = Storage.disk(file.disk);
		const back = () => store.transition(file.id, { status: ['finishing'] }, { status: 'pending' });
		// Before the parts are joined, the upload is aborted; after, the joined object is deleted.
		let joined = false;
		const refuse = (reason: string) =>
			refuseFile(file, reason, () =>
				joined
					? deleteQuietly(file.disk, file.key)
					: abortQuietly(file.disk, file.key, multipart.uploadId)
			);

		let metadata: FileMetadata = file.metadata;
		let contentType = file.contentType;
		try {
			const listed = await disk.multipart!.listParts(file.key, multipart.uploadId);
			if (listed === null) {
				joined = true;
				const object = await disk.head(file.key);
				if (!object) return refuse('the upload is no longer on the disk');
			} else {
				const partCount = partCountOf(file.size, multipart.partBytes);
				const parts = new Map(listed.map((part) => [part.number, part]));
				const ordered: UploadedPart[] = [];
				for (let number = 1; number <= partCount; number += 1) {
					const part = parts.get(number);
					if (!part) {
						await back();
						return R.fail(new UploadMissingError());
					}
					if (part.size !== partSizeOf(file.size, multipart.partBytes, number)) {
						return refuse(`part ${number} does not have the expected size`);
					}
					ordered.push(part);
				}
				try {
					await disk.multipart!.complete(file.key, multipart.uploadId, ordered);
					joined = true;
				} catch (error) {
					// A part sent again between the listing and now: list and finish again.
					if (
						error instanceof MultipartPartsMismatchError ||
						error instanceof MultipartUploadNotFoundError
					) {
						await back();
						return R.fail(new UploadMissingError());
					}
					throw error;
				}
			}

			const object = await disk.head(file.key);
			if (!object || object.size !== file.size) {
				return refuse('the file does not have the declared size');
			}
			const cls = Upload.find(file.purpose);
			const settings = cls
				? await withPurpose(cls, (purpose) => ({
						sniff: purpose.sniff,
						sniffBytes: purpose.sniffBytes,
						types: purpose.types
					}))
				: { sniff: true, sniffBytes: 4100, types: [file.contentType] };
			const read = await disk.get(file.key, {
				range: { offset: 0, length: Math.min(settings.sniffBytes, file.size) }
			});
			if (!read) return refuse('the file is no longer on the disk');
			const head = await headOf(read.body, Math.min(settings.sniffBytes, file.size));
			if (settings.sniff) {
				// A large file is not refused for a declared type that is close but not its own,
				// such as a QuickTime video declared as MP4: its real type is kept instead.
				const detected = await detectType(head);
				if (detected === undefined || !settings.types.includes(detected)) {
					return refuse('the content of the file is not of an accepted type');
				}
				contentType = detected;
			}
			if (cls) {
				try {
					const described = await withPurpose(cls, (purpose) =>
						purpose.metadata({ ...file, contentType }, head)
					);
					metadata = { ...metadata, ...described };
				} catch (error) {
					return refuse(error instanceof Error ? error.message : 'the file could not be read');
				}
			}
		} catch (error) {
			// The client may finish again; pruning removes what a stop half way leaves.
			await back();
			throw error;
		}
		const ready = await store.transition(
			file.id,
			{ status: ['finishing'] },
			{
				status: 'ready',
				readyAt: now,
				expiresAt: Files.unclaimedDeadline(now),
				metadata,
				contentType,
				multipart: null
			}
		);
		if (!ready) {
			await deleteQuietly(file.disk, file.key);
			return R.fail(new UploadNotPendingError());
		}
		emitFileEvent(PITHOS_FILE_READY, ready);
		return R.pass(ready);
	};

	/** Refuses a file that is `finishing`, dropping what was uploaded. */
	const refuseFile = async (
		file: FileRecord,
		reason: string,
		drop: () => Promise<void>
	): Promise<Result<FileRecord, FinishUploadErrors>> => {
		const rejected = await filesSource().store.transition(
			file.id,
			{ status: ['finishing'] },
			{ status: 'rejected', rejection: reason, expiresAt: null }
		);
		await drop();
		if (!rejected) return R.fail(new UploadNotPendingError());
		emitFileEvent(PITHOS_FILE_REJECTED, rejected);
		return R.fail(new UploadRejectedError(reason));
	};

	/** A live `pending` upload in parts, of `user` when given. */
	const pendingUpload = async (
		id: string,
		call: { readonly user?: string }
	): Promise<
		Result<
			{ file: FileRecord; multipart: NonNullable<FileRecord['multipart']> },
			NotFoundError | UploadNotPendingError | UploadExpiredError
		>
	> => {
		const file = await filesSource().store.find(id);
		if (!file || (call.user !== undefined && file.createdBy !== call.user)) {
			return R.fail(new NotFoundError('No such upload.'));
		}
		if (file.status !== 'pending') return R.fail(new UploadNotPendingError());
		if (!file.multipart) return R.fail(new NotFoundError('No such upload in parts.'));
		if (!meets(file, { status: ['pending'], live: Clock.now() })) {
			return R.fail(new UploadExpiredError());
		}
		return R.pass({ file, multipart: file.multipart });
	};

	/** How long an upload lasts, and how far it may be extended, from its purpose. */
	const ttlsOf = async (file: FileRecord): Promise<{ ttl: number; ttlMax: number }> => {
		const fallback = filesSource().options.uploadTtl;
		const cls = Upload.find(file.purpose);
		const ttl = cls ? ((await withPurpose(cls, (p) => p.uploadTtl)) ?? fallback) : fallback;
		const ttlMax = cls ? ((await withPurpose(cls, (p) => p.uploadTtlMax)) ?? ttl) : ttl;
		return { ttl, ttlMax: Math.max(ttl, ttlMax) };
	};
}

/** Checks that a purpose can upload in parts to its disk; throws on a wrong configuration. */
const checkMultipart = (name: string, purpose: Upload<any>, diskName: string): void => {
	const { partBytes } = purpose.multipart!;
	if (!Number.isInteger(partBytes) || partBytes < MIN_PART_BYTES) {
		throw new UploadPartSizeError(name, `parts must be at least ${MIN_PART_BYTES} bytes`);
	}
	if (partCountOf(purpose.maxBytes, partBytes) > MAX_PARTS) {
		throw new UploadPartSizeError(
			name,
			`a file of ${purpose.maxBytes} bytes would have more than ${MAX_PARTS} parts`
		);
	}
	const disk = Storage.disk(diskName);
	if (!disk.multipart) throw new DiskCannotMultipartError(diskName);
	if (isPublic(disk)) throw new MultipartOnPublicDiskError(name, diskName);
};

/** Whether a disk serves its objects at public URLs: `url()` answers instead of throwing. */
const isPublic = (disk: StorageDriver): boolean => {
	try {
		disk.url('public-check');
		return true;
	} catch (error) {
		if (error instanceof DiskNotPublicError) return false;
		throw error;
	}
};

/**
 * A file without the disk's multipart upload id, which stays on the server: what tickets and
 * progress carry.
 */
const withoutUpload = ({ multipart: _multipart, ...file }: FileRecord): FileRecord => file;

const after = (from: Date, seconds: number): Date => new Date(from.getTime() + seconds * 1000);

/** The type of a file from its first bytes, with `file-type`, loaded when first needed. */
const detectType = async (bytes: Uint8Array): Promise<string | undefined> => {
	const { fileTypeFromBuffer } = await import('file-type');
	return (await fileTypeFromBuffer(bytes))?.mime;
};
