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

import type { FilesOptions, FilesSource, FileStoreDriver } from './files';
import type { DiskSource, StorageDriver } from './storage';

import { Module } from '../module';
import { FILES_DEFAULTS, FileStore, PITHOS_FILES } from './files';
import { PITHOS_DISKS, Storage } from './storage';
import { StorageController } from './storage.controller';

import './files';
import './memory';

type Option<T> = T | (() => T);

/**
 * The configuration of {@link PithosModule}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type PithosModuleConfig = {
	/** The disks, by name: each an instance or a function that builds it once, when first used. */
	disks?: Record<string, Option<StorageDriver>>;
	/** The disk `Storage.disk()` answers without a name. Defaults to the first disk. */
	default?: string;
	/** Where file records are kept and how files live. The store defaults to `memory`. */
	files?: FilesOptions & { store?: Option<FileStoreDriver> };
};

/**
 * Provides the disks of the application, which `Storage.disk(name)` answers, and serves the
 * signed URLs of the disks that cannot serve them themselves (see `StorageController`).
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * PithosModule.with({
 * 	disks: {
 * 		public: () => Storage.for('local', { root: './storage/public', url: 'https://cdn.example.com' }),
 * 		uploads: () => Storage.for('memory')
 * 	},
 * 	default: 'public'
 * });
 * ```
 */
@Module.register<PithosModuleConfig>({
	controllers: [StorageController],
	services: (config) => [
		{
			name: PITHOS_DISKS,
			global: true,
			factory: (): DiskSource => {
				const options = config.disks ?? {};
				const built = new Map<string, StorageDriver>();
				return {
					defaultDisk: config.default ?? Object.keys(options)[0] ?? 'default',
					names: () => Object.keys(options),
					get: (name) => {
						const cached = built.get(name);
						if (cached) return cached;
						const option = options[name];
						if (option === undefined) return undefined;
						const disk = typeof option === 'function' ? option() : option;
						built.set(name, disk);
						return disk;
					}
				};
			}
		},
		{
			name: PITHOS_FILES,
			global: true,
			factory: (): FilesSource => {
				const { store, ...options } = config.files ?? {};
				const option = store ?? (() => FileStore.for('memory'));
				return {
					store: typeof option === 'function' ? option() : option,
					options: { ...FILES_DEFAULTS, ...options }
				};
			}
		}
	]
})
export class PithosModule extends Module.configurable<PithosModuleConfig>() {
	/** Puts faked disks back when the application stops. */
	public override onDestroy(): void {
		Storage.restore();
	}
}
