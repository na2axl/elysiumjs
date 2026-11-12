// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import { Application } from './app';

/**
 * The id of a user as guards leave it in `currentUser`: the user itself when it is a string or a
 * number, else its `id`, else its `sub` (JWT claims).
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param user The user.
 */
export const userIdOf = (user: unknown): string | undefined => {
	if (typeof user === 'string' || typeof user === 'number') return String(user);
	if (typeof user !== 'object' || user === null) return undefined;
	const { id, sub } = user as { id?: unknown; sub?: unknown };
	const value = id ?? sub;
	return value === undefined || value === null ? undefined : String(value);
};

/**
 * The id of the user of the current request, read from `currentUser` in its context, which
 * authentication middlewares set. `undefined` outside a request or without a user.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const currentUserId = (): string | undefined => {
	const http = Application.context.getStore()?.get('http:context') as
		{ currentUser?: unknown } | undefined;
	return userIdOf(http?.currentUser);
};
