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

// A Worker entry for the WorkersBuilder tests: a validated route, compiled ahead of time.
import { Elysia, t } from 'elysia';

export const app = new Elysia().post(
	'/echo/:id',
	{
		params: t.Object({ id: t.String({ minLength: 2 }) }),
		body: t.Object({ note: t.String() })
	},
	({ params, body }) => ({ ...params, ...body })
);

export default { fetch: (request: Request) => app.fetch(request) };
