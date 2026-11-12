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
import { assertStrongSecret } from './errors';

/**
 * A secret: its value, or a function that reads it when it is needed, such as from a secrets
 * store bound to the request. The function runs on every use, so that a rotated secret is picked
 * up; it caches the value itself when reading it is costly.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type Secret = string | (() => string | Promise<string>);

/**
 * The value of a secret, checked to be at least 32 bytes long.
 * @param secret The secret, or the function that reads it.
 * @param what What the secret is for, in the error message.
 * @throws {WeakSecretError} When the secret is too short.
 */
export const resolveSecret = async (secret: Secret, what: string): Promise<string> => {
	const value = typeof secret === 'function' ? await secret() : secret;
	assertStrongSecret(value, what);
	return value;
};
