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

import type { BackgroundScope, BackgroundWork } from '../../src/background';
import type { ModuleNode } from '../../src/module-graph';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { Background } from '../../src/background';
import { Container } from '../../src/container';
import { ElysiumError } from '../../src/errors';
import { ModuleContext } from '../../src/module-context';
import { Service } from '../../src/service';
import { resetContainer } from '../../src/testing';

const A: ModuleNode = { id: 'A' } as ModuleNode;

beforeEach(() => {
	resetContainer();
	Container.setVisibility({ visibleOwners: () => [], exportsOf: () => [], nodes: [A] });
});

afterEach(() => resetContainer());

describe('Background', () => {
	it('runs the work as it is without scopes', async () => {
		expect(await Background.run({ kind: 'job', name: 'digest' }, async () => 42)).toBe(42);
	});

	it('nests the scopes in registration order', async () => {
		const trace: string[] = [];

		@Background.scope()
		class Outer implements BackgroundScope {
			public async run<T>(work: BackgroundWork, next: () => Promise<T>): Promise<T> {
				trace.push(`outer:${work.kind}:${work.name}`);
				const result = await next();
				trace.push('outer:end');
				return result;
			}
		}

		@Background.scope()
		class Inner implements BackgroundScope {
			public run<T>(_work: BackgroundWork, next: () => Promise<T>): Promise<T> {
				trace.push('inner');
				return next();
			}
		}

		Container.register(A, Outer, undefined);
		Container.register(A, Inner, undefined);

		const result = await Background.run({ kind: 'event', name: 'billing.receipt' }, async () => {
			trace.push('work');
			return 'done';
		});

		expect(result).toBe('done');
		expect(trace).toEqual(['outer:event:billing.receipt', 'inner', 'work', 'outer:end']);
	});
});

describe('Service.invoke', () => {
	class Mailer {
		public send() {
			return 'sent';
		}
	}

	it('gives services to the injected parameters and args to the others', async () => {
		class Digest {
			public execute(first: string, @Service.inject(Mailer) mailer: Mailer, second: string) {
				return `${first}:${mailer.send()}:${second}`;
			}
		}

		Container.register(A, Mailer, undefined);
		expect(
			await ModuleContext.run(A, () => Service.invoke(new Digest(), 'execute', ['a', 'b']))
		).toBe('a:sent:b');
	});

	it('refuses a name that is not a method', async () => {
		expect(Service.invoke({}, 'missing')).rejects.toBeInstanceOf(ElysiumError);
	});
});
