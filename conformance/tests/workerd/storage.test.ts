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

import type { R2BucketLike, R2ObjectLike } from '@elysiumjs/workers';

import { InvalidObjectKeyError, ObjectNotFoundError } from '@elysiumjs/olympus/pithos';
import { R2Disk } from '@elysiumjs/workers';
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { contractUrls, diskContract } from '../../../@elysiumjs/olympus/tests/pithos/disk-contract';

const bucket = (env as unknown as { MEDIA: R2BucketLike }).MEDIA;

type Described = Omit<R2ObjectLike, 'key'> & { key: string };

/** The fields of an R2 object (getters of a workerd class) as a plain object, out of the prefix. */
const plain = (prefix: string, object: Described): R2ObjectLike => ({
	key: object.key.slice(prefix.length),
	size: object.size,
	httpEtag: object.httpEtag,
	uploaded: object.uploaded,
	httpMetadata: object.httpMetadata,
	customMetadata: object.customMetadata
});

// Each disk of the contract gets a bucket of its own: a view of MEDIA under a fresh prefix.
const scoped = (prefix: string): R2BucketLike => ({
	put: async (key, value, options) => {
		const object = await bucket.put(`${prefix}${key}`, value, options);
		return object && plain(prefix, object);
	},
	get: async (key) => {
		const object = await bucket.get(`${prefix}${key}`);
		if (!object) return null;
		return {
			...plain(prefix, object),
			body: object.body,
			arrayBuffer: () => object.arrayBuffer(),
			text: () => object.text()
		};
	},
	head: async (key) => {
		const object = await bucket.head(`${prefix}${key}`);
		return object && plain(prefix, object);
	},
	delete: (keys) => bucket.delete([keys].flat().map((key) => `${prefix}${key}`)),
	list: async (options = {}) => {
		const page = await bucket.list({ ...options, prefix: `${prefix}${options.prefix ?? ''}` });
		return { ...page, objects: page.objects.map((object) => plain(prefix, object)) };
	}
});

diskContract(
	{ describe, it, expect },
	'r2 (workerd)',
	'r2',
	() => new R2Disk({ binding: scoped(`${crypto.randomUUID()}/`), ...contractUrls('r2') }),
	{ InvalidObjectKeyError, ObjectNotFoundError }
);
