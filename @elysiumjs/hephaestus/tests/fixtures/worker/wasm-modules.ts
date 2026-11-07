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
// A Worker entry that imports WebAssembly modules, two of them with the same file name.
import { Elysia } from 'elysia';

import first from './wasm/a/codec.wasm';
import again from './wasm/a/codec.wasm';
import second from './wasm/b/codec.wasm';

export const app = new Elysia().get('/', () => String([first, second, again].length));

export default { fetch: (request: Request) => app.fetch(request) };
