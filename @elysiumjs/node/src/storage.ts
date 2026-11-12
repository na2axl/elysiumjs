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

import type {
	ListOptions,
	ListPage,
	ObjectInfo,
	PutOptions,
	ServedSigning,
	SignedUrlOptions,
	StorageBody,
	StoredObject
} from '@elysiumjs/olympus/pithos';

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
	assertKey,
	DEFAULT_LIST_LIMIT,
	DiskCannotSignError,
	DiskNotPublicError,
	joinUrl,
	ObjectNotFoundError,
	objectOf,
	signServedUrl,
	Storage,
	StorageDriver,
	toBytes
} from '@elysiumjs/olympus/pithos';

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'storage:local': typeof LocalDisk;
	}
}

/**
 * The options of a {@link LocalDisk}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type LocalDiskOptions = {
	/** The folder that holds the objects. */
	readonly root: string;
	/** The base URL of public objects; without it, the disk is not public. */
	readonly url?: string;
	/** How it signs URLs that `PithosModule` serves; without it, it cannot sign URLs. */
	readonly signing?: ServedSigning;
};

/** The folder, under the root, that keeps the content type and metadata of each object. */
const META = '.pithos';

type Meta = { contentType?: string; metadata: Record<string, string> };

/**
 * Keeps objects as files in a folder, through `node:fs`. The content type and metadata of each
 * object are kept next to them, in a `.pithos` folder. Registered as the `local` driver of the
 * `Storage` port when `@elysiumjs/node` is imported.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * import '@elysiumjs/node';
 * import { PithosModule, Storage } from '@elysiumjs/olympus/pithos';
 *
 * PithosModule.with({
 * 	disks: { public: () => Storage.for('local', { root: './storage/public', url: '/files' }) }
 * });
 * ```
 */
@Storage.driver('local')
export class LocalDisk extends StorageDriver {
	readonly #root: string;

	constructor(private readonly options: LocalDiskOptions) {
		super();
		this.#root = resolve(options.root);
	}

	public async put(key: string, body: StorageBody, options: PutOptions = {}): Promise<ObjectInfo> {
		const path = this.#path(key);
		const bytes = await toBytes(body);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, bytes);
		const meta: Meta = { contentType: options.contentType, metadata: { ...options.metadata } };
		await this.#writeMeta(key, meta);
		return (await this.head(key))!;
	}

	public async get(key: string): Promise<StoredObject | null> {
		const info = await this.head(key);
		if (!info) return null;
		return objectOf(info, new Uint8Array(await readFile(this.#path(key))));
	}

	public async head(key: string): Promise<ObjectInfo | null> {
		const path = this.#path(key);
		const stats = await stat(path).catch(() => null);
		if (!stats?.isFile()) return null;
		const meta = await this.#readMeta(key);
		return {
			key,
			size: stats.size,
			contentType: meta.contentType,
			etag: `${stats.mtimeMs}:${stats.size}`,
			lastModified: stats.mtime,
			metadata: meta.metadata
		};
	}

	public async delete(key: string): Promise<boolean> {
		const existed = (await this.head(key)) !== null;
		await rm(this.#path(key), { force: true });
		await rm(this.#metaPath(key), { force: true });
		return existed;
	}

	public async list(options: ListOptions = {}): Promise<ListPage> {
		const limit = options.limit ?? DEFAULT_LIST_LIMIT;
		const keys = (await this.#walk(this.#root))
			.filter((key) => !options.prefix || key.startsWith(options.prefix))
			.filter((key) => options.cursor === undefined || key > options.cursor)
			.sort();
		const items: ObjectInfo[] = [];
		for (const key of keys.slice(0, limit)) {
			const info = await this.head(key);
			if (info) items.push(info);
		}
		return { items, nextCursor: keys.length > limit ? keys[limit - 1]! : null };
	}

	public async copy(from: string, to: string): Promise<void> {
		if (!(await this.head(from))) throw new ObjectNotFoundError(from);
		const target = this.#path(to);
		await mkdir(dirname(target), { recursive: true });
		await copyFile(this.#path(from), target);
		await this.#writeMeta(to, await this.#readMeta(from));
	}

	public url(key: string): string {
		if (!this.options.url) throw new DiskNotPublicError('local');
		return joinUrl(this.options.url, assertKey(key));
	}

	/** How the disk signs URLs that `PithosModule` serves, when it does. */
	public get served(): ServedSigning | undefined {
		return this.options.signing;
	}

	public async signedUrl(key: string, options: SignedUrlOptions): Promise<string> {
		if (!this.options.signing) throw new DiskCannotSignError('local');
		return signServedUrl(this.options.signing, assertKey(key), options);
	}

	/** The file of a key, checked to stay under the root. */
	#path(key: string): string {
		assertKey(key);
		if (key === META || key.startsWith(`${META}/`)) throw new ObjectNotFoundError(key);
		return join(this.#root, ...key.split('/'));
	}

	#metaPath(key: string): string {
		return `${join(this.#root, META, ...key.split('/'))}.json`;
	}

	async #readMeta(key: string): Promise<Meta> {
		const text = await readFile(this.#metaPath(key), 'utf8').catch(() => null);
		return text ? (JSON.parse(text) as Meta) : { metadata: {} };
	}

	async #writeMeta(key: string, meta: Meta): Promise<void> {
		const path = this.#metaPath(key);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(meta));
	}

	/** The keys of every file under a folder, the `.pithos` folder left out. */
	async #walk(folder: string): Promise<string[]> {
		const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
		const keys: string[] = [];
		for (const entry of entries) {
			const path = join(folder, entry.name);
			if (entry.isDirectory()) {
				if (folder === this.#root && entry.name === META) continue;
				keys.push(...(await this.#walk(path)));
			} else if (entry.isFile()) {
				keys.push(relative(this.#root, path).split(sep).join('/'));
			}
		}
		return keys;
	}
}
