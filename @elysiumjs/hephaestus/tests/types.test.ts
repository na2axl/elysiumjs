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

import { HephaestusConfigSchema, PlatformTargetSchema } from '../src/types';

describe('PlatformTargetSchema', () => {
	it('should accept all valid platform targets', () => {
		const targets = [
			'linux-x64',
			'linux-x64-baseline',
			'linux-arm64',
			'darwin-x64',
			'darwin-arm64',
			'windows-x64'
		];

		for (const target of targets) {
			expect(() => PlatformTargetSchema.parse(target)).not.toThrow();
		}
	});

	it('should reject invalid platform targets', () => {
		expect(() => PlatformTargetSchema.parse('invalid')).toThrow();
		expect(() => PlatformTargetSchema.parse('linux-arm32')).toThrow();
	});
});

describe('HephaestusConfigSchema', () => {
	it('should validate a minimal config', () => {
		const config = HephaestusConfigSchema.parse({
			output: { name: 'myapp' }
		});

		expect(config.entry).toBe('./src/index.ts');
		expect(config.output.name).toBe('myapp');
		expect(config.output.dir).toBe('./dist');
		expect(config.platforms).toEqual([]);
	});

	it('should apply build defaults', () => {
		const config = HephaestusConfigSchema.parse({
			output: { name: 'myapp' }
		});

		expect(config.build.minify).toBe(true);
		expect(config.build.sourcemap).toBe(true);
		expect(config.build.bytecode).toBe(true);
		expect(config.build.split).toBe(false);
	});

	it('should apply asset defaults', () => {
		const config = HephaestusConfigSchema.parse({
			output: { name: 'myapp' }
		});

		expect(config.assets.embed).toEqual([]);
		expect(config.assets.exclude).toEqual([]);
	});

	it('should apply env defaults', () => {
		const config = HephaestusConfigSchema.parse({
			output: { name: 'myapp' }
		});

		expect(config.env.generateExample).toBe(true);
	});

	it('should accept a full config', () => {
		const config = HephaestusConfigSchema.parse({
			entry: './src/main.ts',
			output: { name: 'myapp', dir: './build' },
			platforms: ['linux-x64', 'darwin-arm64'],
			build: { minify: false, sourcemap: false, bytecode: false, split: true },
			assets: { embed: ['assets/**/*'], exclude: ['*.tmp'] },
			env: { generateExample: false },
			docker: {
				enabled: true,
				buildImage: 'oven/bun:latest',
				runtimeImage: 'debian:bookworm-slim',
				expose: [3000, 8080],
				healthcheck: { path: '/healthz', interval: '10s' }
			},
			release: { include: ['README.md'], compress: 'zip' }
		});

		expect(config.entry).toBe('./src/main.ts');
		expect(config.output.dir).toBe('./build');
		expect(config.platforms).toHaveLength(2);
		expect(config.build.split).toBe(true);
		expect(config.docker?.enabled).toBe(true);
		expect(config.docker?.expose).toEqual([3000, 8080]);
		expect(config.release?.compress).toBe('zip');
	});

	it('should apply docker defaults', () => {
		const config = HephaestusConfigSchema.parse({
			output: { name: 'myapp' },
			docker: { enabled: true }
		});

		expect(config.docker?.buildImage).toBe('oven/bun:1-alpine');
		expect(config.docker?.runtimeImage).toBe('alpine:3.19');
		expect(config.docker?.expose).toEqual([]);
	});

	it('should apply release defaults', () => {
		const config = HephaestusConfigSchema.parse({
			output: { name: 'myapp' },
			release: {}
		});

		expect(config.release?.include).toEqual([]);
		expect(config.release?.compress).toBe('tar.gz');
	});

	it('should reject config without output.name', () => {
		expect(() => HephaestusConfigSchema.parse({ output: {} })).toThrow();
	});
});
