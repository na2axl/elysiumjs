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

import { Application } from '@elysiumjs/core';
import { describe, expect, it } from 'bun:test';

import { getCurrentTenant, withTenant } from '../src/tenancy';

describe('getCurrentTenant', () => {
	it('returns null outside a tenant context', () => {
		expect(getCurrentTenant()).toBeNull();
	});

	it('reads the tenant set by withTenant when no application instance exists', () => {
		expect(Application.instance).toBeNull();
		expect(withTenant('acme', () => getCurrentTenant())).toBe('acme');
	});

	it('does not change the outer store', () => {
		const store = new Map<any, unknown>([['tenant', 'outer']]);

		const inner = Application.context.run(store, () => withTenant('inner', getCurrentTenant));

		expect(inner).toBe('inner');
		expect(store.get('tenant')).toBe('outer');
	});
});
