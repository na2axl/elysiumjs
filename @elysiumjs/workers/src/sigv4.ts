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

/**
 * What {@link presignS3Url} signs.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type S3PresignInput = {
	readonly method: 'GET' | 'PUT';
	/** The object URL, such as `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`. */
	readonly url: string;
	readonly accessKeyId: string;
	readonly secretAccessKey: string;
	/** `auto` for R2. */
	readonly region: string;
	/** How long the URL works, in seconds (at most 7 days). */
	readonly expiresIn: number;
	/** Headers the request must send as they are, such as `content-type` and `content-length`. */
	readonly headers?: Readonly<Record<string, string>>;
	/** The signing time; now by default. */
	readonly now?: Date;
};

const encoder = new TextEncoder();

const hex = (bytes: ArrayBuffer): string =>
	[...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256 = async (text: string): Promise<string> =>
	hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

const hmac = async (key: ArrayBuffer | Uint8Array, text: string): Promise<ArrayBuffer> => {
	const imported = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return crypto.subtle.sign('HMAC', imported, encoder.encode(text));
};

/** RFC 3986 escaping, as SigV4 wants it: `encodeURIComponent` leaves `!'()*` alone. */
const escape = (value: string): string =>
	encodeURIComponent(value).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
	);

/**
 * A presigned URL of the S3 API (AWS Signature Version 4, signed in the query), made with Web
 * Crypto. The payload is not signed; the given headers are, so a request that sends other values
 * for them is refused.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const presignS3Url = async (input: S3PresignInput): Promise<string> => {
	const url = new URL(input.url);
	const stamp = (input.now ?? new Date()).toISOString().replace(/[-:]|\.\d{3}/g, '');
	const day = stamp.slice(0, 8);
	const scope = `${day}/${input.region}/s3/aws4_request`;
	const headers: Record<string, string> = { host: url.host };
	for (const [name, value] of Object.entries(input.headers ?? {})) {
		headers[name.toLowerCase()] = value.trim();
	}
	const names = Object.keys(headers).sort();
	const signedHeaders = names.join(';');

	url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
	url.searchParams.set('X-Amz-Credential', `${input.accessKeyId}/${scope}`);
	url.searchParams.set('X-Amz-Date', stamp);
	url.searchParams.set('X-Amz-Expires', String(input.expiresIn));
	url.searchParams.set('X-Amz-SignedHeaders', signedHeaders);
	const query = [...url.searchParams]
		.map(([name, value]) => [escape(name), escape(value)] as const)
		.sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
		.map(([name, value]) => `${name}=${value}`)
		.join('&');
	const path = url.pathname
		.split('/')
		.map((segment) => escape(decodeURIComponent(segment)))
		.join('/');

	const canonical = [
		input.method,
		path,
		query,
		names.map((name) => `${name}:${headers[name]}\n`).join(''),
		signedHeaders,
		'UNSIGNED-PAYLOAD'
	].join('\n');
	const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256(canonical)].join('\n');

	let key = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), day);
	for (const part of [input.region, 's3', 'aws4_request']) key = await hmac(key, part);
	const signature = hex(await hmac(key, toSign));

	return `${url.origin}${path}?${query}&X-Amz-Signature=${signature}`;
};
