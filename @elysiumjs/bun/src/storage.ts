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

import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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
	StorageDriver
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

type Meta = { contentType?: string; metadata: Record<string, string> };

/**
 * Keeps objects as files in a folder, through `Bun.file()` and `Bun.write()`: the disk reads and
 * writes streams, so it does not hold large objects in memory itself. Each file is written aside
 * then renamed into place, so a reader never sees half of it. The content type and metadata of
 * each object are kept in a `.pithos` folder, whose keys are refused. As on any file system, a key
 * cannot also be a folder of other keys: `a` and `a/b` cannot both exist. Registered as the `local` driver of the `Storage` port
 * when `@elysiumjs/bun` is imported; `@elysiumjs/node` registers its own, so import one of them.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * import '@elysiumjs/bun';
 * import { PithosModule, Storage } from '@elysiumjs/olympus/pithos';
 *
 * PithosModule.with({
 * 	disks: { public: () => Storage.for('local', { root: './storage/public', url: '/files' }) }
 * });
 * ```
 */
@Storage.driver('local')
export class BunDisk extends StorageDriver {
	readonly #root: string;

	constructor(private readonly options: LocalDiskOptions) {
		super();
		this.#root = resolve(options.root);
	}

	public async put(key: string, body: StorageBody, options: PutOptions = {}): Promise<ObjectInfo> {
		const path = this.#path(key);
		// Bun.write creates the missing folders, and streams a Response to the file.
		const temporary = this.#temporary();
		if (body instanceof ReadableStream) await Bun.write(temporary, new Response(body));
		else await Bun.write(temporary, body);
		await this.#moveInto(temporary, path);
		await this.#writeMeta(key, {
			contentType: options.contentType,
			metadata: { ...options.metadata }
		});
		return (await this.head(key))!;
	}

	public async get(key: string): Promise<StoredObject | null> {
		const info = await this.head(key);
		if (!info) return null;
		const file = Bun.file(this.#path(key));
		return { ...info, body: file.stream(), bytes: () => file.bytes(), text: () => file.text() };
	}

	public async head(key: string): Promise<ObjectInfo | null> {
		if (this.#reserved(key)) return null;
		const stats = await Bun.file(this.#path(key))
			.stat()
			.catch(() => null);
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
		const file = Bun.file(this.#path(key));
		const existed = await file.exists();
		if (existed) await file.delete();
		const meta = Bun.file(this.#metaPath(key));
		if (await meta.exists()) await meta.delete();
		return existed;
	}

	public async list(options: ListOptions = {}): Promise<ListPage> {
		const limit = listLimit(options);
		const keys: string[] = [];
		const scan = new Bun.Glob('**').scan({ cwd: this.#root, onlyFiles: true, dot: true });
		try {
			for await (const path of scan) {
				const key = path.replaceAll('\\', '/');
				if (key.startsWith(`${META}/`)) continue;
				if (options.prefix && !key.startsWith(options.prefix)) continue;
				if (options.cursor !== undefined && key <= options.cursor) continue;
				keys.push(key);
			}
		} catch (error) {
			// A disk that was never written to has no folder yet.
			if ((error as { code?: string }).code !== 'ENOENT') throw error;
		}
		keys.sort();
		const items: ObjectInfo[] = [];
		for (const key of keys.slice(0, limit)) {
			const info = await this.head(key);
			if (info) items.push(info);
		}
		return { items, nextCursor: keys.length > limit ? keys[limit - 1]! : null };
	}

	public async copy(from: string, to: string): Promise<void> {
		if (!(await this.head(from))) throw new ObjectNotFoundError(from);
		const temporary = this.#temporary();
		await Bun.write(temporary, Bun.file(this.#path(from)));
		await this.#moveInto(temporary, this.#path(to));
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

	/** The file of a key, which stays under the root since the key is checked. */
	#path(key: string): string {
		assertKey(key);
		if (this.#reserved(key)) throw new InvalidObjectKeyError(key);
		return `${this.#root}/${key}`;
	}

	/** The metadata file of a key: one flat file per key, named by its hash, so keys never collide. */
	#metaPath(key: string): string {
		const hash = new Bun.CryptoHasher('sha256').update(key).digest('hex');
		return `${this.#root}/${META}/meta/${hash}.json`;
	}

	/** A new path to write aside, under the root so that renaming it stays on one file system. */
	#temporary(): string {
		return `${this.#root}/${META}/tmp/${crypto.randomUUID()}`;
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

	async #readMeta(key: string): Promise<Meta> {
		const file = Bun.file(this.#metaPath(key));
		return (await file.exists()) ? ((await file.json()) as Meta) : { metadata: {} };
	}

	async #writeMeta(key: string, meta: Meta): Promise<void> {
		const temporary = this.#temporary();
		await Bun.write(temporary, JSON.stringify(meta));
		await this.#moveInto(temporary, this.#metaPath(key));
	}
}
