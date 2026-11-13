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
	LocalDiskDriver,
	LocalDiskOptions,
	ObjectInfo,
	PutOptions,
	ServedSigning,
	SignedUrlOptions,
	StorageBody,
	StoredObject
} from '@elysiumjs/olympus/pithos';

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

import {
	assertKey,
	DiskCannotSignError,
	DiskNotPublicError,
	InvalidObjectKeyError,
	joinUrl,
	listLimit,
	ObjectNotFoundError,
	signServedUrl,
	Storage,
	StorageDriver,
	toBytes
} from '@elysiumjs/olympus/pithos';

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'storage:local': LocalDiskDriver;
	}
}

/**
 * The folder, under the root, that keeps the content type and metadata of each object (in
 * `meta`, one file per key named by its hash) and the files being written (in `tmp`).
 */
const META = '.pithos';

type Meta = { contentType?: string; cacheControl?: string; metadata: Record<string, string> };

/**
 * Keeps objects as files in a folder, through `node:fs`. Each file is written aside then renamed
 * into place, so a reader never sees half of it, and is read as a stream. The content type and
 * metadata of each object are kept in a `.pithos` folder, whose keys are refused. As on any file
 * system, a key cannot also be a folder of other keys: `a` and `a/b` cannot both exist. Registered as the `local` driver of the
 * `Storage` port when `@elysiumjs/node` is imported; `@elysiumjs/bun` registers its own, so import one of them.
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
		const meta: Meta = {
			contentType: options.contentType,
			cacheControl: options.cacheControl,
			metadata: { ...options.metadata }
		};
		await this.#replace(path, await toBytes(body));
		await this.#writeMeta(key, meta);
		return (await this.head(key))!;
	}

	public async get(key: string): Promise<StoredObject | null> {
		const info = await this.head(key);
		if (!info) return null;
		const path = this.#path(key);
		return {
			...info,
			body: Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>,
			bytes: async () => new Uint8Array(await readFile(path)),
			text: () => readFile(path, 'utf8')
		};
	}

	public async head(key: string): Promise<ObjectInfo | null> {
		if (this.#reserved(key)) return null;
		const stats = await stat(this.#path(key)).catch(() => null);
		if (!stats?.isFile()) return null;
		const meta = await this.#readMeta(key);
		return {
			key,
			size: stats.size,
			contentType: meta.contentType,
			cacheControl: meta.cacheControl,
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
		const limit = listLimit(options);
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
		const temporary = await this.#temporary();
		await copyFile(this.#path(from), temporary);
		await this.#moveInto(temporary, target);
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

	/** Whether a key is under the `.pithos` folder. */
	#reserved(key: string): boolean {
		return key === META || key.startsWith(`${META}/`);
	}

	/** The file of a key, checked to stay under the root and out of the `.pithos` folder. */
	#path(key: string): string {
		assertKey(key);
		if (this.#reserved(key)) throw new InvalidObjectKeyError(key);
		return join(this.#root, ...key.split('/'));
	}

	/** The metadata file of a key: one flat file per key, named by its hash, so keys never collide. */
	#metaPath(key: string): string {
		return join(this.#root, META, 'meta', `${createHash('sha256').update(key).digest('hex')}.json`);
	}

	/** A new path to write aside, under the root so that renaming it stays on one file system. */
	async #temporary(): Promise<string> {
		const folder = join(this.#root, META, 'tmp');
		await mkdir(folder, { recursive: true });
		return join(folder, randomUUID());
	}

	/** Moves a written file into place, and removes it should that fail. */
	async #moveInto(temporary: string, path: string): Promise<void> {
		try {
			await mkdir(dirname(path), { recursive: true });
			await rename(temporary, path);
		} catch (error) {
			await rm(temporary, { force: true });
			throw error;
		}
	}

	/** Writes a file aside, then renames it into place. */
	async #replace(path: string, data: Uint8Array | string): Promise<void> {
		const temporary = await this.#temporary();
		await writeFile(temporary, data);
		await this.#moveInto(temporary, path);
	}

	async #readMeta(key: string): Promise<Meta> {
		const text = await readFile(this.#metaPath(key), 'utf8').catch(() => null);
		return text ? (JSON.parse(text) as Meta) : { metadata: {} };
	}

	async #writeMeta(key: string, meta: Meta): Promise<void> {
		await mkdir(dirname(this.#metaPath(key)), { recursive: true });
		await this.#replace(this.#metaPath(key), JSON.stringify(meta));
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
