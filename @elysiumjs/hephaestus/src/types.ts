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

import { z } from 'zod';

/**
 * Supported compilation target platforms.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const PlatformTargetSchema = z.enum([
	'linux-x64',
	'linux-x64-baseline',
	'linux-arm64',
	'darwin-x64',
	'darwin-arm64',
	'windows-x64'
]);

/**
 * A supported compilation target platform.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type PlatformTarget = z.infer<typeof PlatformTargetSchema>;

/**
 * Hephaestus build configuration schema.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const HephaestusConfigSchema = z.object({
	entry: z.string().default('./src/index.ts'),
	output: z.object({
		name: z.string(),
		dir: z.string().default('./dist')
	}),
	platforms: z.array(PlatformTargetSchema).default([]),
	build: z
		.object({
			minify: z.boolean().default(true),
			sourcemap: z.boolean().default(true),
			bytecode: z.boolean().default(true),
			split: z.boolean().default(false)
		})
		.prefault({}),
	assets: z
		.object({
			embed: z.array(z.string()).default([]),
			exclude: z.array(z.string()).default([])
		})
		.prefault({}),
	env: z
		.object({
			generateExample: z.boolean().default(true)
		})
		.prefault({}),
	docker: z
		.object({
			enabled: z.boolean().default(false),
			buildImage: z.string().default('oven/bun:1-alpine'),
			runtimeImage: z.string().default('alpine:3.19'),
			expose: z.array(z.number()).default([]),
			healthcheck: z
				.object({
					path: z.string().default('/health'),
					interval: z.string().default('30s')
				})
				.optional()
		})
		.optional(),
	release: z
		.object({
			include: z.array(z.string()).default([]),
			compress: z.enum(['zip', 'tar.gz']).default('tar.gz')
		})
		.optional()
});

/**
 * Hephaestus build configuration.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HephaestusConfig = z.infer<typeof HephaestusConfigSchema>;
