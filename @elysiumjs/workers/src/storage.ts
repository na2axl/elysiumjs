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

import type { Secret } from '@elysiumjs/olympus/harpocrates';
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

import {
	assertKey,
	DEFAULT_LIST_LIMIT,
	DiskCannotSignError,
	DiskNotPublicError,
	joinUrl,
	ObjectNotFoundError,
	signServedUrl,
	Storage,
	StorageDriver,
	toBytes
} from '@elysiumjs/olympus/pithos';

import { presignS3Url } from './sigv4';
import { Workers } from './workers';

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'storage:r2': typeof R2Disk;
	}
}

/**
 * An object as an R2 bucket binding describes it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type R2ObjectLike = {
	readonly key: string;
	readonly size: number;
	readonly httpEtag: string;
	readonly uploaded: Date;
	readonly httpMetadata?: { contentType?: string };
	readonly customMetadata?: Record<string, string>;
};

/**
 * An object read from an R2 bucket binding, with its content.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type R2ObjectBodyLike = R2ObjectLike & {
	readonly body: ReadableStream<Uint8Array>;
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
};

/**
 * The slice of an R2 bucket binding that {@link R2Disk} uses.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface R2BucketLike {
	put(
		key: string,
		value: string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream | null,
		options?: {
			httpMetadata?: { contentType?: string };
			customMetadata?: Record<string, string>;
		}
	): Promise<R2ObjectLike | null>;
	get(key: string): Promise<R2ObjectBodyLike | null>;
	head(key: string): Promise<R2ObjectLike | null>;
	delete(keys: string | string[]): Promise<void>;
	list(options?: {
		prefix?: string;
		cursor?: string;
		limit?: number;
		include?: ('httpMetadata' | 'customMetadata')[];
	}): Promise<{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string }>;
}

/**
 * The options of an {@link R2Disk}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type R2DiskOptions = {
	/**
	 * The R2 bucket binding: its name in the wrangler config, read from the current invocation on
	 * every call, the binding itself, or a function that returns it.
	 */
	readonly binding: string | R2BucketLike | (() => R2BucketLike);
	/**
	 * The base URL of public objects, such as the custom domain of the bucket; without it, the
	 * disk is not public.
	 */
	readonly url?: string;
	/**
	 * Credentials of the S3 API of R2, with which the disk presigns URLs that go straight to the
	 * bucket, so uploads and downloads do not pass through the Worker.
	 */
	readonly s3?: R2S3Options;
	/**
	 * How it signs URLs that `PithosModule` serves, used when `s3` is not given; without either, it
	 * cannot sign URLs.
	 */
	readonly signing?: ServedSigning;
};

/**
 * The S3 API credentials of an {@link R2Disk}: an R2 API token with access to the bucket.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type R2S3Options = {
	/** The Cloudflare account id, in the endpoint `https://<accountId>.r2.cloudflarestorage.com`. */
	readonly accountId: string;
	/** The name of the bucket, which the binding does not tell. */
	readonly bucket: string;
	readonly accessKeyId: Secret;
	readonly secretAccessKey: Secret;
	/** Another endpoint, such as one of a jurisdiction (`https://<accountId>.eu.r2.cloudflarestorage.com`). */
	readonly endpoint?: string;
};

const read = async (secret: Secret): Promise<string> =>
	typeof secret === 'function' ? await secret() : secret;

/** What a disk knows about an object, from what R2 answers. */
const infoOf = (object: R2ObjectLike): ObjectInfo => ({
	key: object.key,
	size: object.size,
	contentType: object.httpMetadata?.contentType,
	etag: object.httpEtag,
	lastModified: object.uploaded,
	metadata: { ...object.customMetadata }
});

/**
 * Keeps objects in a Cloudflare R2 bucket, through its binding. Signed URLs are presigned on the
 * S3 API of R2 when the disk has `s3` credentials, so clients reach the bucket directly; with
 * `signing` instead, `PithosModule` serves them, through the Worker. Objects
 * are read as streams; a stream written to the disk is read in full first, since R2 needs the
 * length of what it stores. Registered as the `r2` driver of the `Storage` port when
 * `@elysiumjs/workers` is imported.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * // wrangler.jsonc
 * // "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "media" }]
 *
 * PithosModule.with({
 * 	disks: {
 * 		media: () =>
 * 			Storage.for('r2', {
 * 				binding: 'MEDIA',
 * 				url: 'https://media.example.com',
 * 				s3: {
 * 					accountId: '<account id>',
 * 					bucket: 'media',
 * 					accessKeyId: () => Workers.env<Env>().R2_ACCESS_KEY_ID,
 * 					secretAccessKey: () => Workers.env<Env>().R2_SECRET_ACCESS_KEY
 * 				}
 * 			})
 * 	}
 * });
 * ```
 */
@Storage.driver('r2')
export class R2Disk extends StorageDriver {
	constructor(private readonly options: R2DiskOptions) {
		super();
	}

	public async put(key: string, body: StorageBody, options: PutOptions = {}): Promise<ObjectInfo> {
		const object = await this.#bucket().put(
			assertKey(key),
			body instanceof ReadableStream ? await toBytes(body) : body,
			{
				httpMetadata: options.contentType ? { contentType: options.contentType } : {},
				customMetadata: { ...options.metadata }
			}
		);
		return infoOf(object!);
	}

	public async get(key: string): Promise<StoredObject | null> {
		const object = await this.#bucket().get(assertKey(key));
		if (!object) return null;
		return {
			...infoOf(object),
			body: object.body,
			bytes: async () => new Uint8Array(await object.arrayBuffer()),
			text: () => object.text()
		};
	}

	public async head(key: string): Promise<ObjectInfo | null> {
		const object = await this.#bucket().head(assertKey(key));
		return object ? infoOf(object) : null;
	}

	public async delete(key: string): Promise<boolean> {
		const bucket = this.#bucket();
		if (!(await bucket.head(assertKey(key)))) return false;
		await bucket.delete(key);
		return true;
	}

	public async list(options: ListOptions = {}): Promise<ListPage> {
		const page = await this.#bucket().list({
			prefix: options.prefix,
			cursor: options.cursor,
			limit: options.limit ?? DEFAULT_LIST_LIMIT,
			include: ['httpMetadata', 'customMetadata']
		});
		return {
			items: page.objects.map(infoOf),
			nextCursor: page.truncated ? (page.cursor ?? null) : null
		};
	}

	/** Copies through the Worker, since R2 bindings have no copy: the object is read and written. */
	public async copy(from: string, to: string): Promise<void> {
		const bucket = this.#bucket();
		const object = await bucket.get(assertKey(from));
		if (!object) throw new ObjectNotFoundError(from);
		await bucket.put(assertKey(to), await object.arrayBuffer(), {
			httpMetadata: { ...object.httpMetadata },
			customMetadata: { ...object.customMetadata }
		});
	}

	public url(key: string): string {
		if (!this.options.url) throw new DiskNotPublicError('r2');
		return joinUrl(this.options.url, assertKey(key));
	}

	/** How the disk signs URLs that `PithosModule` serves, when it does. */
	public get served(): ServedSigning | undefined {
		return this.options.s3 ? undefined : this.options.signing;
	}

	/**
	 * A presigned URL of the bucket with `s3`, which signs the content type and length of an upload,
	 * so the request must send them as given; otherwise a URL that `PithosModule` serves.
	 */
	public async signedUrl(key: string, options: SignedUrlOptions): Promise<string> {
		const { s3, signing } = this.options;
		if (s3) {
			const endpoint = s3.endpoint ?? `https://${s3.accountId}.r2.cloudflarestorage.com`;
			const headers: Record<string, string> = {};
			if (options.method === 'PUT' && options.contentType) {
				headers['content-type'] = options.contentType;
			}
			if (options.method === 'PUT' && options.contentLength !== undefined) {
				headers['content-length'] = String(options.contentLength);
			}
			return presignS3Url({
				method: options.method,
				url: joinUrl(`${endpoint}/${encodeURIComponent(s3.bucket)}`, assertKey(key)),
				accessKeyId: await read(s3.accessKeyId),
				secretAccessKey: await read(s3.secretAccessKey),
				region: 'auto',
				expiresIn: options.expiresIn,
				headers
			});
		}
		if (!signing) throw new DiskCannotSignError('r2');
		return signServedUrl(signing, assertKey(key), options);
	}

	#bucket(): R2BucketLike {
		const { binding } = this.options;
		if (typeof binding === 'string') return Workers.binding<R2BucketLike>(binding);
		return typeof binding === 'function' ? binding() : binding;
	}
}
