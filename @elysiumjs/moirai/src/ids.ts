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
 * A UUID version 7: a millisecond timestamp followed by random bits, so that ids sort by creation
 * time.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param now The time of the id. Defaults to now.
 */
export const uuidv7 = (now: number = Date.now()): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	let time = now;
	for (let i = 5; i >= 0; i--) {
		bytes[i] = time % 256;
		time = Math.floor(time / 256);
	}
	bytes[6] = (bytes[6]! & 0x0f) | 0x70;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
