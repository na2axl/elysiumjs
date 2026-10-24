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

import { Application, Service } from '@elysiumjs/core';
import { describe, expect, it } from 'bun:test';

import { HephaestusModule } from '../src';
import {
	HephaestusBuildCommand,
	HephaestusDockerCommand,
	HephaestusEmbedCommand
} from '../src/commands';

describe('HephaestusModule', () => {
	it('registers nothing on import', () => {
		expect(Service.keys('*')).toEqual([]);
	});

	it('contributes the three commands to the graph', async () => {
		const app = await Application.testing({ modules: [HephaestusModule] });
		try {
			const commands = app.kernel.graph.collect('commands').map((c: any) => c.item ?? c);
			expect(commands).toHaveLength(3);
			expect(commands).toEqual(
				expect.arrayContaining([
					HephaestusBuildCommand,
					HephaestusDockerCommand,
					HephaestusEmbedCommand
				])
			);
		} finally {
			await app.shutdown();
		}
	});
});
