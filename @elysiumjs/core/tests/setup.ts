// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import { mock } from 'bun:test';

// Mock dependencies

const { AsyncLocalStorage: RealAsyncLocalStorage } = process.getBuiltinModule('node:async_hooks');

mock.module('node:async_hooks', () => ({
	AsyncLocalStorage: class<T> extends RealAsyncLocalStorage<T> {
		public run = mock((store: T, callback: () => unknown) =>
			RealAsyncLocalStorage.prototype.run.call(this, store, callback)
		);
		public disable = mock();
	}
}));
