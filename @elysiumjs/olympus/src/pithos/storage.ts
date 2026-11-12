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

import type { ServedSigning } from './signing';

import { ElysiumError } from '../errors';
import { Port } from '../port';
import { Service } from '../service';

/**
 * What a disk stores: bytes, text, a blob or a stream.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StorageBody = Uint8Array | ArrayBuffer | string | Blob | ReadableStream<Uint8Array>;

/**
 * What a disk knows about an object.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ObjectInfo = {
	readonly key: string;
	/** The size, in bytes. */
	readonly size: number;
	readonly contentType?: string;
	/** A tag that changes with the content, when the disk gives one. */
	readonly etag?: string;
	readonly lastModified: Date;
	/** The metadata given to `put()`. */
	readonly metadata: Readonly<Record<string, string>>;
};

/**
 * An object read from a disk: what the disk knows about it, and its content.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StoredObject = ObjectInfo & {
	/** The content, as a stream: read it once. */
	readonly body: ReadableStream<Uint8Array>;
	/** Reads the content as bytes. */
	bytes(): Promise<Uint8Array>;
	/** Reads the content as UTF-8 text. */
	text(): Promise<string>;
};

/**
 * How an object is written.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type PutOptions = {
	readonly contentType?: string;
	readonly metadata?: Readonly<Record<string, string>>;
};

/**
 * What a listing is asked with.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ListOptions = {
	/** Only the keys that start with it. */
	readonly prefix?: string;
	/** The `nextCursor` of the previous page. */
	readonly cursor?: string;
	/** The size of a page. Defaults to 1000. */
	readonly limit?: number;
};

/**
 * A page of a listing, in key order.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ListPage = {
	readonly items: ObjectInfo[];
	/** The cursor of the next page, or `null` on the last one. */
	readonly nextCursor: string | null;
};

/**
 * What a signed URL allows.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SignedUrlOptions = {
	/** `GET` to download the object, `PUT` to upload it. */
	readonly method: 'GET' | 'PUT';
	/** How long the URL works, in seconds. */
	readonly expiresIn: number;
	/** For `PUT`: the content type the upload must declare. */
	readonly contentType?: string;
	/** For `PUT`: the size, in bytes, the upload must have. */
	readonly contentLength?: number;
};

/** The default size of a listing page. */
export const DEFAULT_LIST_LIMIT = 1000;

/** The size of a listing page: the limit asked, at least 1, else {@link DEFAULT_LIST_LIMIT}. */
export const listLimit = (options: ListOptions): number =>
	Math.max(1, Math.floor(options.limit ?? DEFAULT_LIST_LIMIT));

/**
 * Thrown by `url()` on a disk that is not public.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DiskNotPublicError extends ElysiumError {
	constructor(disk: string) {
		super(`The ${disk} disk has no public URL: give it a url, or use signedUrl().`);
	}
}

/**
 * Thrown by `signedUrl()` on a disk that cannot sign URLs.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DiskCannotSignError extends ElysiumError {
	constructor(disk: string) {
		super(
			`The ${disk} disk cannot sign URLs: give it signing options, and serve them with PithosModule.`
		);
	}
}

/**
 * Thrown by `copy()` and `move()` when the source object does not exist.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class ObjectNotFoundError extends ElysiumError {
	constructor(public readonly key: string) {
		super(`No object is stored under "${key}".`);
	}
}

/**
 * Thrown for a key that is empty, absolute, or climbs out of the disk with `..`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class InvalidObjectKeyError extends ElysiumError {
	constructor(public readonly key: string) {
		super(`"${key}" is not a valid object key: use a relative path without "..".`);
	}
}

/**
 * Checks a key: relative, not empty, without `..` or empty segments.
 * @throws {InvalidObjectKeyError}
 */
export const assertKey = (key: string): string => {
	const segments = key.split('/');
	if (
		key === '' ||
		key.startsWith('/') ||
		key.includes('\\') ||
		key.includes('\0') ||
		segments.some((segment) => segment === '' || segment === '.' || segment === '..')
	) {
		throw new InvalidObjectKeyError(key);
	}
	return key;
};

/** Reads a body into bytes. */
export const toBytes = async (body: StorageBody): Promise<Uint8Array> => {
	if (typeof body === 'string') return new TextEncoder().encode(body);
	if (body instanceof Uint8Array) return body;
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
	return new Uint8Array(await new Response(body).arrayBuffer());
};

/** A stream of bytes. */
export const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
	new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		}
	});

/** An object read from bytes already in memory. */
export const objectOf = (info: ObjectInfo, bytes: Uint8Array): StoredObject => ({
	...info,
	body: streamOf(bytes),
	bytes: async () => bytes,
	text: async () => new TextDecoder().decode(bytes)
});

/**
 * A disk: where objects are stored, under keys such as `avatars/42.webp`. `memory` is built in;
 * runtime packages add others: `local` from `@elysiumjs/node`, `bun` from `@elysiumjs/bun` and
 * `r2` from `@elysiumjs/workers`.
 * Subclasses implement the storage calls; `exists()` and `move()` have defaults built on them.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export abstract class StorageDriver {
	/** Writes an object, and answers what the disk knows about it. */
	public abstract put(key: string, body: StorageBody, options?: PutOptions): Promise<ObjectInfo>;

	/** Reads an object, or `null` when there is none. */
	public abstract get(key: string): Promise<StoredObject | null>;

	/** What the disk knows about an object, or `null` when there is none. */
	public abstract head(key: string): Promise<ObjectInfo | null>;

	/** Deletes an object, and answers whether there was one. */
	public abstract delete(key: string): Promise<boolean>;

	/** A page of the objects, in key order. */
	public abstract list(options?: ListOptions): Promise<ListPage>;

	/**
	 * Copies an object to another key.
	 * @throws {ObjectNotFoundError} When there is no object under `from`.
	 */
	public abstract copy(from: string, to: string): Promise<void>;

	/**
	 * The public URL of an object.
	 * @throws {DiskNotPublicError} When the disk is not public.
	 */
	public abstract url(key: string): string;

	/**
	 * A URL that downloads or uploads an object without credentials, until it expires.
	 * @throws {DiskCannotSignError} When the disk cannot sign URLs.
	 */
	public abstract signedUrl(key: string, options: SignedUrlOptions): Promise<string>;

	/** Whether an object exists. */
	public async exists(key: string): Promise<boolean> {
		return (await this.head(key)) !== null;
	}

	/**
	 * Moves an object to another key.
	 * @throws {ObjectNotFoundError} When there is no object under `from`.
	 */
	public async move(from: string, to: string): Promise<void> {
		if (from === to) return;
		await this.copy(from, to);
		await this.delete(from);
	}
}

declare module '../port' {
	interface Ports {
		storage: StorageDriver;
	}
}

/**
 * The storage port. Build a disk with `Storage.for(name, options)`, and give the disks of the
 * application to `PithosModule`, which serves them by name with `Storage.disk(name)`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * PithosModule.with({
 * 	disks: {
 * 		public: () => Storage.for('local', { root: './storage/public', url: '/files' }),
 * 		private: () => Storage.for('memory')
 * 	}
 * });
 * ```
 */
export class Storage extends Port('storage') {
	/**
	 * A disk of the application, by name, as `PithosModule` configures it; the default disk
	 * without a name.
	 * @param name The name of the disk.
	 * @throws {UnknownDiskError} When no disk has the name.
	 */
	public static disk(name?: string): StorageDriver {
		const disks = Service.get<DiskSource>(PITHOS_DISKS);
		const wanted = name ?? disks?.defaultDisk ?? 'default';
		const fake = fakes.get(wanted);
		if (fake) return fake;
		const disk = disks?.get(wanted);
		if (!disk) throw new UnknownDiskError(wanted);
		return disk;
	}

	/** The name of the default disk of the application. */
	public static defaultDisk(): string {
		return Service.get<DiskSource>(PITHOS_DISKS)?.defaultDisk ?? 'default';
	}

	/**
	 * Replaces a disk with an empty memory disk until `restore()`, for tests.
	 * @param name The name of the disk; the default disk without one.
	 * @param options The options of the memory disk, such as its URL and its signing.
	 */
	public static fake(name?: string, options: MemoryDiskLike = {}): StorageDriver {
		const wanted = name ?? Storage.defaultDisk();
		const disk = Storage.for('memory' as never, options as never) as StorageDriver;
		fakes.set(wanted, disk);
		return disk;
	}

	/** Puts the disks replaced by `fake()` back. */
	public static restore(): void {
		fakes.clear();
	}
}

/** The options a faked memory disk takes. */
type MemoryDiskLike = { readonly url?: string; readonly signing?: ServedSigning };

/** The service holding the disks of the application. */
export const PITHOS_DISKS = 'pithos.disks';

/**
 * The disks of the application, as `PithosModule` provides them.
 * @internal
 */
export type DiskSource = {
	readonly defaultDisk: string;
	get(name: string): StorageDriver | undefined;
	names(): string[];
};

const fakes = new Map<string, StorageDriver>();

/**
 * Thrown by `Storage.disk()` for a name no disk has.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnknownDiskError extends ElysiumError {
	constructor(public readonly disk: string) {
		super(`No disk is named "${disk}": configure it in PithosModule.with({ disks }).`);
	}
}
