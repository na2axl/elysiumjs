// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import { randomToken, safeEqual, sha256 } from './crypto';

export namespace ApiKeys {
	/**
	 * Generates an API key: a prefix, then 32 random bytes. Show the key once and store only its
	 * hash.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param options The prefix, which tells the keys apart in logs and secret scanners.
	 * @returns The key, and its hash to store.
	 */
	export const generate = async (
		options: { prefix?: string } = {}
	): Promise<{ key: string; hash: string }> => {
		const key = `${options.prefix ?? 'key'}_${randomToken(32)}`;
		return { key, hash: await hash(key) };
	};

	/**
	 * The hash of a key, to look the key up: the hex SHA-256. Keys carry enough entropy for an
	 * unsalted hash.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const hash = (key: string): Promise<string> => sha256(key);

	/**
	 * Whether a presented key matches a stored hash, compared in constant time.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const verify = async (key: string, storedHash: string): Promise<boolean> =>
		safeEqual(await hash(key), storedHash);
}
