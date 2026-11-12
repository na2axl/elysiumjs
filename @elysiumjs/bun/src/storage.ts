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

import { resolve } from 'node:path';

import {
	assertKey,
	DEFAULT_LIST_LIMIT,
	DiskCannotSignError,
	DiskNotPublicError,
	joinUrl,
	ObjectNotFoundError,
	signServedUrl,
	Storage,
	StorageDriver
} from '@elysiumjs/olympus/pithos';

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'storage:bun': typeof BunDisk;
	}
}

/**
 * The options of a {@link BunDisk}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type BunDiskOptions = {
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
 * Keeps objects as files in a folder, through `Bun.file()` and `Bun.write()`: reads and writes
 * stream, so large objects are not held in memory. The content type and metadata of each object are
 * kept next to them, in a `.pithos` folder. Registered as the `bun` driver of the `Storage` port
 * when `@elysiumjs/bun` is imported.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * import '@elysiumjs/bun';
 * import { PithosModule, Storage } from '@elysiumjs/olympus/pithos';
 *
 * PithosModule.with({
 * 	disks: { public: () => Storage.for('bun', { root: './storage/public', url: '/files' }) }
 * });
 * ```
 */
@Storage.driver('bun')
export class BunDisk extends StorageDriver {
	readonly #root: string;

	constructor(private readonly options: BunDiskOptions) {
		super();
		this.#root = resolve(options.root);
	}

	public async put(key: string, body: StorageBody, options: PutOptions = {}): Promise<ObjectInfo> {
		const path = this.#path(key);
		// Bun.write creates the missing folders, and streams a Response to the file.
		if (body instanceof ReadableStream) await Bun.write(path, new Response(body));
		else await Bun.write(path, body);
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
		const limit = options.limit ?? DEFAULT_LIST_LIMIT;
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
		await Bun.write(this.#path(to), Bun.file(this.#path(from)));
		await this.#writeMeta(to, await this.#readMeta(from));
	}

	public url(key: string): string {
		if (!this.options.url) throw new DiskNotPublicError('bun');
		return joinUrl(this.options.url, assertKey(key));
	}

	/** How the disk signs URLs that `PithosModule` serves, when it does. */
	public get served(): ServedSigning | undefined {
		return this.options.signing;
	}

	public async signedUrl(key: string, options: SignedUrlOptions): Promise<string> {
		if (!this.options.signing) throw new DiskCannotSignError('bun');
		return signServedUrl(this.options.signing, assertKey(key), options);
	}

	/** The file of a key, which stays under the root since the key is checked. */
	#path(key: string): string {
		assertKey(key);
		if (key === META || key.startsWith(`${META}/`)) throw new ObjectNotFoundError(key);
		return `${this.#root}/${key}`;
	}

	#metaPath(key: string): string {
		return `${this.#root}/${META}/${key}.json`;
	}

	async #readMeta(key: string): Promise<Meta> {
		const file = Bun.file(this.#metaPath(key));
		return (await file.exists()) ? ((await file.json()) as Meta) : { metadata: {} };
	}

	async #writeMeta(key: string, meta: Meta): Promise<void> {
		await Bun.write(this.#metaPath(key), JSON.stringify(meta));
	}
}
