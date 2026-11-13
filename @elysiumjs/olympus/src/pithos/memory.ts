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
import type {
	ListOptions,
	ListPage,
	ObjectInfo,
	PutOptions,
	SignedUrlOptions,
	StorageBody,
	StoredObject
} from './storage';

import { Clock } from '../clock';
import { joinUrl, signServedUrl } from './signing';
import {
	assertKey,
	DiskCannotSignError,
	DiskNotPublicError,
	listLimit,
	ObjectNotFoundError,
	objectOf,
	Storage,
	StorageDriver,
	toBytes
} from './storage';

declare module '../port' {
	interface PortDrivers {
		'storage:memory': typeof MemoryDisk;
	}
}

/**
 * The options of a {@link MemoryDisk}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MemoryDiskOptions = {
	/** The base URL of public objects; without it, the disk is not public. */
	readonly url?: string;
	/** How it signs URLs that `PithosModule` serves; without it, it cannot sign URLs. */
	readonly signing?: ServedSigning;
};

/**
 * Keeps objects in memory, for tests and development: they are lost when the process ends.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Storage.driver('memory')
export class MemoryDisk extends StorageDriver {
	readonly #objects = new Map<string, { info: ObjectInfo; bytes: Uint8Array }>();

	constructor(private readonly options: MemoryDiskOptions = {}) {
		super();
	}

	public async put(key: string, body: StorageBody, options: PutOptions = {}): Promise<ObjectInfo> {
		const bytes = await toBytes(body);
		const info: ObjectInfo = {
			key: assertKey(key),
			size: bytes.byteLength,
			contentType: options.contentType,
			cacheControl: options.cacheControl,
			etag: String(Clock.epochMs()) + ':' + bytes.byteLength,
			lastModified: Clock.now(),
			metadata: { ...options.metadata }
		};
		this.#objects.set(key, { info, bytes: bytes.slice() });
		return info;
	}

	public async get(key: string): Promise<StoredObject | null> {
		const entry = this.#objects.get(assertKey(key));
		return entry ? objectOf(entry.info, entry.bytes.slice()) : null;
	}

	public async head(key: string): Promise<ObjectInfo | null> {
		return this.#objects.get(assertKey(key))?.info ?? null;
	}

	public async delete(key: string): Promise<boolean> {
		return this.#objects.delete(assertKey(key));
	}

	public async list(options: ListOptions = {}): Promise<ListPage> {
		const limit = listLimit(options);
		const keys = [...this.#objects.keys()]
			.filter((key) => !options.prefix || key.startsWith(options.prefix))
			.filter((key) => options.cursor === undefined || key > options.cursor)
			.sort();
		const items = keys.slice(0, limit).map((key) => this.#objects.get(key)!.info);
		return { items, nextCursor: keys.length > limit ? items[items.length - 1]!.key : null };
	}

	public async copy(from: string, to: string): Promise<void> {
		const entry = this.#objects.get(assertKey(from));
		if (!entry) throw new ObjectNotFoundError(from);
		this.#objects.set(assertKey(to), {
			info: { ...entry.info, key: to, lastModified: Clock.now() },
			bytes: entry.bytes.slice()
		});
	}

	public url(key: string): string {
		if (!this.options.url) throw new DiskNotPublicError('memory');
		return joinUrl(this.options.url, assertKey(key));
	}

	/** How the disk signs URLs that `PithosModule` serves, when it does. */
	public get served(): ServedSigning | undefined {
		return this.options.signing;
	}

	public async signedUrl(key: string, options: SignedUrlOptions): Promise<string> {
		if (!this.options.signing) throw new DiskCannotSignError('memory');
		return signServedUrl(this.options.signing, assertKey(key), options);
	}
}
