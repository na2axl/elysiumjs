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

/** JSON with object keys sorted at every depth, and bigints as decimal strings. */
const canonical = (value: unknown): unknown => {
	if (typeof value === 'bigint') return value.toString();
	if (Array.isArray(value)) return value.map(canonical);
	if (value instanceof Date) return value.toISOString();
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonical((value as Record<string, unknown>)[key])])
		);
	}
	return value;
};

/**
 * The fingerprint of a command input: the hex SHA-256 of its canonical JSON, so that the same input
 * gives the same hash whatever the order of its keys.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param input The validated input.
 */
export const requestHash = async (input: unknown): Promise<string> => {
	const bytes = new TextEncoder().encode(JSON.stringify(canonical(input)) ?? 'null');
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
