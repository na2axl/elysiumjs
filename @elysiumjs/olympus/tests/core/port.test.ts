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

import { describe, expect, expectTypeOf, it } from 'bun:test';

import {
	DuplicatePortDriverError,
	Lock,
	LockDriver,
	MemoryLock,
	Port,
	UnknownPortDriverError
} from '../../src/index';

// A port declared outside the framework, the way a package would.
interface SearchDriver {
	query(index: string, text: string): Promise<string[]>;
}

declare module '../../src/port' {
	interface Ports {
		search: SearchDriver;
	}

	interface PortDrivers {
		'search:list': typeof ListSearch;
	}
}

class Search extends Port('search') {}

@Search.driver('list')
class ListSearch implements SearchDriver {
	constructor(public readonly options: { items: string[] }) {}

	public async query(_index: string, text: string): Promise<string[]> {
		return this.options.items.filter((item) => item.includes(text));
	}
}

describe('Port', () => {
	it('builds a registered driver with its options', async () => {
		const search = Search.for('list', { items: ['apple', 'banana', 'pineapple'] });
		expect(search).toBeInstanceOf(ListSearch);
		expect(await search.query('fruits', 'apple')).toEqual(['apple', 'pineapple']);
	});

	it('types the driver names, the options and the driver', () => {
		expectTypeOf(Search.for('list', { items: [] })).toEqualTypeOf<ListSearch & SearchDriver>();
		expectTypeOf<Parameters<typeof Search.for<'list'>>[1]>().toEqualTypeOf<
			{ items: string[] } | undefined
		>();
		// @ts-expect-error not a driver of the port
		expect(() => Search.for('elastic')).toThrow(UnknownPortDriverError);
	});

	it('names the known drivers when one is missing', () => {
		expect(() => (Search.for as (name: string) => unknown)('elastic')).toThrow(
			'The port "search" has no driver named "elastic". Known drivers: list.'
		);
	});

	it('lists its drivers and its name', () => {
		expect(Search.port).toBe('search');
		expect(Search.drivers()).toEqual(['list']);
		expect(Search.has('list')).toBe(true);
		expect(Search.has('elastic')).toBe(false);
	});

	it('refuses a second class under the same name, and accepts the same class again', () => {
		expect(() => Search.driver('list')(ListSearch)).not.toThrow();
		class OtherSearch implements SearchDriver {
			public async query(): Promise<string[]> {
				return [];
			}
		}
		expect(() => Search.driver('list')(OtherSearch)).toThrow(DuplicatePortDriverError);
	});

	it('keeps each port apart', () => {
		expect(Lock.drivers()).toContain('memory');
		expect(Lock.drivers()).not.toContain('list');
		expect(Lock.for('memory')).toBeInstanceOf(MemoryLock);
		expectTypeOf(Lock.for('memory')).toExtend<LockDriver>();
	});
});
