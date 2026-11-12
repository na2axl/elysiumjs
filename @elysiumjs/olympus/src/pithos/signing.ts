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

import type { Secret } from '../harpocrates/secret';
import type { SignedUrlOptions } from './storage';

import { SignedUrl } from '../harpocrates/signed-url';

/**
 * How a disk that cannot sign URLs itself, such as `memory` or `local`, makes signed URLs that
 * `PithosModule` serves.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ServedSigning = {
	/**
	 * The absolute URL of the disk's route in `PithosModule`, such as
	 * `https://api.example.com/storage/private`.
	 */
	readonly url: string;
	/** The secret that signs the URLs; `PithosModule` checks them with the same one. */
	readonly secret: Secret;
};

/** Joins a base URL and a key, each segment of the key escaped. */
export const joinUrl = (base: string, key: string): string =>
	`${base.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;

/** Signs a URL of the disk's route in `PithosModule`. */
export const signServedUrl = (
	signing: ServedSigning,
	key: string,
	options: SignedUrlOptions
): Promise<string> => {
	const url = new URL(joinUrl(signing.url, key));
	url.searchParams.set('method', options.method);
	if (options.contentType) url.searchParams.set('contentType', options.contentType);
	if (options.contentLength !== undefined) {
		url.searchParams.set('contentLength', String(options.contentLength));
	}
	return SignedUrl.sign(url, { secret: signing.secret, expiresIn: options.expiresIn });
};
