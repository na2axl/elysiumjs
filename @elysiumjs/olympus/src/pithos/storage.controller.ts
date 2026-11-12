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

import type { Context } from 'elysia';
import type { ServedSigning } from './signing';
import type { StorageDriver } from './storage';

import { SignedUrl } from '../harpocrates/signed-url';
import { Http } from '../http';
import { Storage } from './storage';

/** The disk of a request, and its signing options, or `null` when it does not serve URLs. */
const servedDisk = (name: string): { disk: StorageDriver; signing: ServedSigning } | null => {
	try {
		const disk = Storage.disk(name);
		const signing = (disk as { readonly served?: ServedSigning }).served;
		return signing ? { disk, signing } : null;
	} catch {
		return null;
	}
};

/** Checks the signature, the expiry and the method of a request; answers its error status. */
const check = async (
	ctx: Context,
	method: 'GET' | 'PUT'
): Promise<{ disk: StorageDriver; key: string; url: URL } | number> => {
	const params = ctx.params as Record<string, string>;
	const served = servedDisk(params.disk ?? '');
	if (!served) return 404;
	const url = new URL(ctx.request.url);
	if (!(await SignedUrl.verify(url, { secret: served.signing.secret }))) return 403;
	if (url.searchParams.get('method') !== method) return 403;
	// The signed path is the path of the disk's route and the key: both must match the request.
	const base = new URL(served.signing.url).pathname.replace(/\/+$/, '');
	if (!url.pathname.startsWith(`${base}/`)) return 403;
	const key = url.pathname
		.slice(base.length + 1)
		.split('/')
		.map(decodeURIComponent)
		.join('/');
	return { disk: served.disk, key, url };
};

/**
 * Serves the signed URLs of disks that cannot serve them themselves, such as `memory` and
 * `local`: `GET` downloads the object, and `PUT` uploads it. Give such a disk
 * `signing: { url, secret }`, where `url` is this route followed by the name of the disk, such as
 * `https://api.example.com/storage/uploads`. `PithosModule` lists this controller.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Http.controller('/storage')
export class StorageController {
	@Http.get('/:disk/*', { description: 'Downloads an object through a signed URL.' })
	public async download(@Http.context() ctx: Context): Promise<Response> {
		const checked = await check(ctx, 'GET');
		if (typeof checked === 'number') return new Response(null, { status: checked });
		const object = await checked.disk.get(checked.key).catch(() => null);
		if (!object) return new Response(null, { status: 404 });
		return new Response(object.body, {
			headers: {
				'content-type': object.contentType ?? 'application/octet-stream',
				'content-length': String(object.size)
			}
		});
	}

	@Http.put('/:disk/*', { parse: 'none', description: 'Uploads an object through a signed URL.' })
	public async upload(@Http.context() ctx: Context): Promise<Response> {
		const checked = await check(ctx, 'PUT');
		if (typeof checked === 'number') return new Response(null, { status: checked });
		const declared = ctx.request.headers.get('content-type') ?? undefined;
		const expected = checked.url.searchParams.get('contentType');
		if (expected !== null && declared !== expected) return new Response(null, { status: 403 });
		const length = checked.url.searchParams.get('contentLength');
		// A declared length that differs is refused before the body is read.
		const sent = ctx.request.headers.get('content-length');
		if (length !== null && sent !== null && sent !== length) {
			return new Response(null, { status: 403 });
		}
		const body = await ctx.request.arrayBuffer();
		if (length !== null && body.byteLength !== Number(length)) {
			return new Response(null, { status: 403 });
		}
		await checked.disk.put(checked.key, body, { contentType: declared });
		return new Response(null, { status: 204 });
	}
}
