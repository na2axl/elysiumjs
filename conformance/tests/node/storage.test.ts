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

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalDisk } from '@elysiumjs/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { contractUrls, diskContract } from '../../../@elysiumjs/olympus/tests/pithos/disk-contract';

// The local disk of @elysiumjs/node, under Node.js itself.
let root = '';

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'pithos-node-'));
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

diskContract(
	{ describe, it, expect },
	'local',
	'local',
	() => new LocalDisk({ root: join(root, crypto.randomUUID()), ...contractUrls('local') })
);
