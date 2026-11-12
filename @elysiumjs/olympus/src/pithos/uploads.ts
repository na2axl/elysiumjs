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
import type { FileOwner, FileRecord } from './files';

import { Clock } from '../clock';
import { Metadata } from '../metadata';
import { ModuleContext } from '../module-context';
import { uuidv7 } from '../moirai/ids';
import { BadRequestError, ForbiddenError, NotFoundError } from '../problem';
import { Result as R } from '../result';
import { Service } from '../service';
import { Symbols } from '../utils';
import {
	DuplicateUploadPurposeError,
	MissingUploadPurposeServiceError,
	UploadExpiredError,
	UploadMissingError,
	UploadNotPendingError,
	UploadPurposeUnknownError,
	UploadRejectedError,
	UploadTooLargeError,
	UploadTooManyPendingError,
	UploadTypeNotAllowedError
} from './errors';
import {
	deleteQuietly,
	emitFileEvent,
	Files,
	filesSource,
	meets,
	PITHOS_FILE_READY,
	PITHOS_FILE_REJECTED,
	STAGING_PREFIX,
	stagingDisk,
	stagingKey
} from './files';
import { assertKey, Storage } from './storage';

/** The kebab-case name of a purpose, which prefixes the keys of its files by default. */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type UploadClass = new () => Upload;

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
export abstract class Upload {
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
const withPurpose = async <R>(cls: UploadClass, work: (purpose: Upload) => R): Promise<R> => {
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
};

/**
 * Where and how to upload a file: a `PUT` of its bytes to `url`, with `headers`, before
 * `expiresAt`. A browser sets `content-length` itself from the body, and refuses to set it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type UploadTicket = {
	readonly file: FileRecord;
	readonly url: string;
	readonly method: 'PUT';
	readonly headers: Readonly<Record<string, string>>;
	readonly expiresAt: Date;
};

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
 * Deferred uploads: the client uploads a file straight to the disk through a signed URL, then the
 * server checks it. `open()` makes a `pending` file and the URL of a staging key; `finish()` reads
 * the staged object once, checks its size, its stored type and its first bytes, writes those
 * bytes to the file's key and makes the file `ready`. A file that fails a check is `rejected`;
 * one never uploaded expires, and pruning removes it.
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
 * // The client sends PUT ticket.result.url with ticket.result.headers, then:
 * const file = await Uploads.finish(ticket.result.file.id, { user: userId });
 * ```
 */
export namespace Uploads {
	/** Starts an upload: checks the request against its purpose, and answers where to upload. */
	export const open = async (
		request: UploadRequest
	): Promise<Result<UploadTicket, OpenUploadErrors>> => {
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
			Storage.disk(diskName);
			const id = uuidv7(now.getTime());
			const expiresAt = Files.uploadDeadline(now);
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
			const file: FileRecord = {
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
				rejection: null
			};
			const url = await Storage.disk(stagingDisk(diskName)).signedUrl(stagingKey(id), {
				method: 'PUT',
				expiresIn: options.uploadTtl,
				contentType: request.contentType,
				contentLength: request.size
			});
			await store.insert(file);
			return R.pass({
				file,
				url,
				method: 'PUT' as const,
				headers: { 'content-type': request.contentType, 'content-length': String(request.size) },
				expiresAt
			});
		});
	};

	/**
	 * Finishes an upload: the staged object must be exactly what was declared. The file is
	 * `finishing` while it is checked, so a second call answers `UPLOAD_NOT_PENDING` instead of
	 * racing it. `user`, when given, must be who started the upload. The file is held in memory
	 * while it is checked.
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

		const staging = { disk: stagingDisk(file.disk), key: stagingKey(file.id) };
		const back = () => store.transition(file.id, { status: ['finishing'] }, { status: 'pending' });
		const refuse = async (reason: string) => {
			const rejected = await store.transition(
				file.id,
				{ status: ['finishing'] },
				{ status: 'rejected', rejection: reason, expiresAt: null }
			);
			await deleteQuietly(staging.disk, staging.key);
			if (!rejected) return R.fail(new UploadNotPendingError());
			emitFileEvent(PITHOS_FILE_REJECTED, rejected);
			return R.fail(new UploadRejectedError(reason));
		};

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
			const sniff = cls ? await withPurpose(cls, (purpose) => purpose.sniff) : true;
			if (sniff && (await detectType(bytes)) !== file.contentType) {
				return refuse('the content of the file is not of the declared type');
			}

			await Storage.disk(file.disk).put(file.key, bytes, { contentType: file.contentType });
		} catch (error) {
			// The client may finish again; pruning removes what a stop half way leaves.
			await back();
			throw error;
		}
		const ready = await store.transition(
			file.id,
			{ status: ['finishing'] },
			{ status: 'ready', readyAt: now, expiresAt: Files.unclaimedDeadline(now) }
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
}

/** The type of a file from its first bytes, with `file-type`, loaded when first needed. */
const detectType = async (bytes: Uint8Array): Promise<string | undefined> => {
	const { fileTypeFromBuffer } = await import('file-type');
	return (await fileTypeFromBuffer(bytes))?.mime;
};
