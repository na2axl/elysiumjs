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

import type { PlatformTarget } from '../types';

/**
 * Maps Hephaestus platform targets to Bun's `--target` flag values.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
const BUN_TARGET_MAP: Record<PlatformTarget, string> = {
	'linux-x64': 'bun-linux-x64',
	'linux-x64-baseline': 'bun-linux-x64-baseline',
	'linux-arm64': 'bun-linux-arm64',
	'darwin-x64': 'bun-darwin-x64',
	'darwin-arm64': 'bun-darwin-arm64',
	'windows-x64': 'bun-windows-x64'
};

/**
 * Converts a Hephaestus platform target to a Bun target string.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param platform The Hephaestus platform target.
 * @returns The Bun `--target` value.
 */
export function bunTarget(platform: PlatformTarget): string {
	return BUN_TARGET_MAP[platform];
}

/**
 * Detects the current platform and returns the corresponding target.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @returns The detected platform target.
 */
export function detectCurrentPlatform(): PlatformTarget {
	const platform = process.platform;
	const arch = process.arch;

	if (platform === 'linux' && arch === 'x64') return 'linux-x64';
	if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
	if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
	if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
	if (platform === 'win32' && arch === 'x64') return 'windows-x64';

	return 'linux-x64';
}

/**
 * Returns the output file name for a given platform.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param baseName The base binary name.
 * @param platform The target platform.
 * @returns The platform-specific output file name.
 */
export function getOutputName(baseName: string, platform: PlatformTarget): string {
	return platform.startsWith('windows') ? `${baseName}.exe` : baseName;
}
