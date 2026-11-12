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

import { describe, expect, it } from 'bun:test';

import { bunTarget, detectCurrentPlatform, getOutputName } from '../src/platform/targets';

describe('bunTarget', () => {
	it('should map linux-x64', () => {
		expect(bunTarget('linux-x64')).toBe('bun-linux-x64');
	});

	it('should map linux-x64-baseline', () => {
		expect(bunTarget('linux-x64-baseline')).toBe('bun-linux-x64-baseline');
	});

	it('should map linux-arm64', () => {
		expect(bunTarget('linux-arm64')).toBe('bun-linux-arm64');
	});

	it('should map darwin-x64', () => {
		expect(bunTarget('darwin-x64')).toBe('bun-darwin-x64');
	});

	it('should map darwin-arm64', () => {
		expect(bunTarget('darwin-arm64')).toBe('bun-darwin-arm64');
	});

	it('should map windows-x64', () => {
		expect(bunTarget('windows-x64')).toBe('bun-windows-x64');
	});
});

describe('detectCurrentPlatform', () => {
	it('should return a valid platform target', () => {
		const platform = detectCurrentPlatform();
		const validTargets = [
			'linux-x64',
			'linux-x64-baseline',
			'linux-arm64',
			'darwin-x64',
			'darwin-arm64',
			'windows-x64'
		];
		expect(validTargets).toContain(platform);
	});

	it('should detect darwin-arm64 on Apple Silicon', () => {
		if (process.platform === 'darwin' && process.arch === 'arm64') {
			expect(detectCurrentPlatform()).toBe('darwin-arm64');
		}
	});
});

describe('getOutputName', () => {
	it('should return the base name for non-windows platforms', () => {
		expect(getOutputName('myapp', 'linux-x64')).toBe('myapp');
		expect(getOutputName('myapp', 'linux-arm64')).toBe('myapp');
		expect(getOutputName('myapp', 'darwin-x64')).toBe('myapp');
		expect(getOutputName('myapp', 'darwin-arm64')).toBe('myapp');
	});

	it('should append .exe for windows', () => {
		expect(getOutputName('myapp', 'windows-x64')).toBe('myapp.exe');
	});
});
