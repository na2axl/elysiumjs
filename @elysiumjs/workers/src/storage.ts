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
	GetOptions,
	ListOptions,
	ListPage,
	MultipartStorage,
	ObjectInfo,
	PutOptions,
	ServedSigning,
	SignedUrlOptions,
	SignPartOptions,
	StorageBody,
	StoredObject,
	UploadedPart
} from '@elysiumjs/olympus/pithos';

import {
	assertKey,
	DiskCannotMultipartError,
	DiskCannotSignError,
	DiskNotPublicError,
	joinUrl,
	listLimit,
	MultipartPartsMismatchError,
	MultipartUploadNotFoundError,
	ObjectNotFoundError,
	signServedPartUrl,
	signServedUrl,
	Storage,
	StorageDriver,
	toBytes
} from '@elysiumjs/olympus/pithos';

import { presignS3Url } from './sigv4.js';
import { Workers } from './workers.js';

/** The longest an S3 presigned URL may last: seven days. */
const MAX_PRESIGN_SECONDS = 604_800;

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
	readonly httpMetadata?: { contentType?: string; cacheControl?: string };
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
 * A multipart upload of an R2 bucket binding.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type R2MultipartUploadLike = {
	readonly key: string;
	readonly uploadId: string;
	uploadPart(
		partNumber: number,
		value: ArrayBuffer | ArrayBufferView | string | Blob | ReadableStream
	): Promise<{ partNumber: number; etag: string }>;
	abort(): Promise<void>;
	complete(parts: { partNumber: number; etag: string }[]): Promise<R2ObjectLike>;
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
			httpMetadata?: { contentType?: string; cacheControl?: string };
			customMetadata?: Record<string, string>;
		}
	): Promise<R2ObjectLike | null>;
	get(
		key: string,
		options?: { range?: { offset: number; length: number } }
	): Promise<R2ObjectBodyLike | null>;
	head(key: string): Promise<R2ObjectLike | null>;
	delete(keys: string | string[]): Promise<void>;
	list(options?: {
		prefix?: string;
		cursor?: string;
		limit?: number;
		include?: ('httpMetadata' | 'customMetadata')[];
	}): Promise<{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string }>;
	/** Starts a multipart upload; needed for uploads in parts. */
	createMultipartUpload?(
		key: string,
		options?: {
			httpMetadata?: { contentType?: string; cacheControl?: string };
			customMetadata?: Record<string, string>;
		}
	): Promise<R2MultipartUploadLike>;
	/** Resumes a multipart upload by id; needed for uploads in parts. */
	resumeMultipartUpload?(key: string, uploadId: string): R2MultipartUploadLike;
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

/**
 * Where a disk whose part URLs `PithosModule` serves keeps a receipt of each part, since an R2
 * binding cannot list the parts of an upload.
 */
const RECEIPTS = '.multipart/';

const receiptsOf = (uploadId: string): string => `${RECEIPTS}${encodeURIComponent(uploadId)}/`;

/** The name of a part receipt, padded so that receipts list in part order. */
const receiptKey = (uploadId: string, part: number): string =>
	`${receiptsOf(uploadId)}${String(part).padStart(5, '0')}`;

/** The receipt that tells an upload is in progress, even before any part. */
const anchorKey = (uploadId: string): string => `${receiptsOf(uploadId)}upload`;

const unquote = (etag: string): string => etag.replace(/&quot;|"/g, '');

/** The text of the first `<name>` element of an XML fragment. */
const tag = (xml: string, name: string): string | undefined =>
	new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

/** A failure of the binding about a part or an upload, as an error of pithos. */
const multipartError = (error: unknown, uploadId: string): unknown => {
	const message = error instanceof Error ? error.message : String(error);
	if (/NoSuchUpload|10024|does not exist/i.test(message)) {
		return new MultipartUploadNotFoundError(uploadId);
	}
	if (/InvalidPart|10025|EntityTooSmall|10011|etag/i.test(message)) {
		return new MultipartPartsMismatchError(uploadId);
	}
	return error;
};

/** What a disk knows about an object, from what R2 answers. */
const infoOf = (object: R2ObjectLike): ObjectInfo => ({
	key: object.key,
	size: object.size,
	contentType: object.httpMetadata?.contentType,
	cacheControl: object.httpMetadata?.cacheControl,
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
				httpMetadata: {
					...(options.contentType ? { contentType: options.contentType } : {}),
					...(options.cacheControl ? { cacheControl: options.cacheControl } : {})
				},
				customMetadata: { ...options.metadata }
			}
		);
		return infoOf(object!);
	}

	public async get(key: string, options: GetOptions = {}): Promise<StoredObject | null> {
		const object = await this.#bucket().get(
			assertKey(key),
			options.range ? { range: options.range } : undefined
		);
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
			// R2 answers at most 1000 objects a page.
			limit: Math.min(listLimit(options), 1000),
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
			const headers: Record<string, string> = {};
			if (options.method === 'PUT' && options.contentType) {
				headers['content-type'] = options.contentType;
			}
			if (options.method === 'PUT' && options.contentLength !== undefined) {
				headers['content-length'] = String(options.contentLength);
			}
			return this.#presign(s3, options.method, this.#s3Url(s3, key), options.expiresIn, headers);
		}
		if (!signing) throw new DiskCannotSignError('r2');
		return signServedUrl(signing, assertKey(key), options);
	}

	/**
	 * Uploads in parts, through the binding: part URLs are presigned on the S3 API with `s3`, so
	 * parts go straight to the bucket, or served by `PithosModule` with `signing`, through the
	 * Worker. With `signing`, a receipt of each part is kept under `.multipart/` until the upload
	 * ends, since the binding cannot list parts; deployed, give the disk `s3`.
	 */
	public override get multipart(): MultipartStorage | undefined {
		const { s3, signing } = this.options;
		if (!s3 && !signing) return undefined;
		const upload = (key: string, uploadId: string): R2MultipartUploadLike => {
			const bucket = this.#bucket();
			if (!bucket.resumeMultipartUpload) throw new DiskCannotMultipartError('r2');
			return bucket.resumeMultipartUpload(assertKey(key), uploadId);
		};
		const dropReceipts = async (uploadId: string) => {
			if (s3) return;
			const bucket = this.#bucket();
			let cursor: string | undefined;
			do {
				const page = await bucket.list({ prefix: receiptsOf(uploadId), cursor });
				if (page.objects.length > 0) await bucket.delete(page.objects.map((o) => o.key));
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);
		};
		return {
			create: async (key: string, options: PutOptions = {}) => {
				const bucket = this.#bucket();
				if (!bucket.createMultipartUpload) throw new DiskCannotMultipartError('r2');
				const created = await bucket.createMultipartUpload(assertKey(key), {
					httpMetadata: {
						...(options.contentType ? { contentType: options.contentType } : {}),
						...(options.cacheControl ? { cacheControl: options.cacheControl } : {})
					},
					customMetadata: { ...options.metadata }
				});
				if (!s3) await bucket.put(anchorKey(created.uploadId), key);
				return created.uploadId;
			},
			signPart: async (key: string, uploadId: string, part: number, options: SignPartOptions) => {
				if (s3) {
					const url = new URL(this.#s3Url(s3, key));
					url.searchParams.set('partNumber', String(part));
					url.searchParams.set('uploadId', uploadId);
					return this.#presign(s3, 'PUT', url.toString(), options.expiresIn, {
						'content-length': String(options.contentLength)
					});
				}
				return signServedPartUrl(signing!, assertKey(key), uploadId, part, options);
			},
			putPart: async (key: string, uploadId: string, part: number, body: Uint8Array) => {
				const bucket = this.#bucket();
				if (!s3 && !(await bucket.head(anchorKey(uploadId)))) {
					throw new MultipartUploadNotFoundError(uploadId);
				}
				let uploaded: { partNumber: number; etag: string };
				try {
					uploaded = await upload(key, uploadId).uploadPart(part, body);
				} catch (error) {
					throw multipartError(error, uploadId);
				}
				const etag = unquote(uploaded.etag);
				if (!s3) {
					await bucket.put(receiptKey(uploadId, part), '', {
						customMetadata: { etag, size: String(body.byteLength) }
					});
				}
				return { number: part, size: body.byteLength, etag };
			},
			listParts: async (key: string, uploadId: string) =>
				s3 ? this.#listS3Parts(s3, key, uploadId) : this.#listReceipts(uploadId),
			complete: async (key: string, uploadId: string, parts: readonly UploadedPart[]) => {
				let object: R2ObjectLike;
				try {
					object = await upload(key, uploadId).complete(
						parts.map((part) => ({ partNumber: part.number, etag: part.etag }))
					);
				} catch (error) {
					throw multipartError(error, uploadId);
				}
				await dropReceipts(uploadId);
				return infoOf(object);
			},
			abort: async (key: string, uploadId: string) => {
				try {
					await upload(key, uploadId).abort();
				} catch (error) {
					if (!(multipartError(error, uploadId) instanceof MultipartUploadNotFoundError)) {
						throw error;
					}
				}
				await dropReceipts(uploadId);
			}
		};
	}

	/** The parts of an upload, read with S3 `ListParts`, or `null` when it is not in progress. */
	async #listS3Parts(
		s3: R2S3Options,
		key: string,
		uploadId: string
	): Promise<UploadedPart[] | null> {
		const parts: UploadedPart[] = [];
		let marker: string | undefined;
		do {
			const url = new URL(this.#s3Url(s3, key));
			url.searchParams.set('uploadId', uploadId);
			url.searchParams.set('max-parts', '1000');
			if (marker) url.searchParams.set('part-number-marker', marker);
			const response = await fetch(await this.#presign(s3, 'GET', url.toString(), 60, {}));
			if (response.status === 404) {
				await response.body?.cancel();
				return null;
			}
			const xml = await response.text();
			if (!response.ok) {
				throw new Error(`R2 ListParts failed with ${response.status}: ${tag(xml, 'Code') ?? xml}`);
			}
			for (const [, part] of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
				parts.push({
					number: Number(tag(part!, 'PartNumber')),
					size: Number(tag(part!, 'Size')),
					etag: unquote(tag(part!, 'ETag') ?? '')
				});
			}
			marker = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextPartNumberMarker') : undefined;
		} while (marker);
		return parts.sort((a, b) => a.number - b.number);
	}

	/** The parts of an upload from their receipts, or `null` when it is not in progress. */
	async #listReceipts(uploadId: string): Promise<UploadedPart[] | null> {
		const bucket = this.#bucket();
		if (!(await bucket.head(anchorKey(uploadId)))) return null;
		const parts: UploadedPart[] = [];
		let cursor: string | undefined;
		do {
			const page = await bucket.list({
				prefix: receiptsOf(uploadId),
				cursor,
				include: ['customMetadata']
			});
			for (const object of page.objects) {
				const number = Number(object.key.slice(receiptsOf(uploadId).length));
				if (!Number.isInteger(number) || number < 1) continue;
				parts.push({
					number,
					size: Number(object.customMetadata?.size),
					etag: object.customMetadata?.etag ?? ''
				});
			}
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
		return parts.sort((a, b) => a.number - b.number);
	}

	#s3Url(s3: R2S3Options, key: string): string {
		const endpoint = s3.endpoint ?? `https://${s3.accountId}.r2.cloudflarestorage.com`;
		return joinUrl(`${endpoint}/${encodeURIComponent(s3.bucket)}`, assertKey(key));
	}

	async #presign(
		s3: R2S3Options,
		method: 'GET' | 'PUT',
		url: string,
		expiresIn: number,
		headers: Record<string, string>
	): Promise<string> {
		if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_PRESIGN_SECONDS) {
			throw new RangeError(
				`An R2 presigned URL lasts from 1 to ${MAX_PRESIGN_SECONDS} whole seconds, not ${expiresIn}.`
			);
		}
		return presignS3Url({
			method,
			url,
			accessKeyId: await read(s3.accessKeyId),
			secretAccessKey: await read(s3.secretAccessKey),
			region: 'auto',
			expiresIn,
			headers
		});
	}

	#bucket(): R2BucketLike {
		const { binding } = this.options;
		if (typeof binding === 'string') return Workers.binding<R2BucketLike>(binding);
		return typeof binding === 'function' ? binding() : binding;
	}
}
