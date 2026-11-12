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

import { ElysiumError } from '@elysiumjs/core';

/**
 * Raised when a Redis connection cannot run a command, such as pub/sub over HTTP.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class RedisFeatureNotSupportedError extends ElysiumError {
	constructor(adapter: string, feature: string) {
		super(`The ${adapter} Redis connection does not support ${feature}.`);
	}
}
