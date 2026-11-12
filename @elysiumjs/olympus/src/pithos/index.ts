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

export type { LocalDiskOptions } from './local';
export type { MemoryDiskOptions } from './memory';
export type { PithosModuleConfig } from './pithos.module';
export type { ServedSigning } from './signing';
export type {
	ListOptions,
	ListPage,
	ObjectInfo,
	PutOptions,
	SignedUrlOptions,
	StorageBody,
	StoredObject
} from './storage';

export { LocalDisk, LocalDiskUnavailableError } from './local';
export { MemoryDisk } from './memory';
export { PithosModule } from './pithos.module';
export { StorageController } from './storage.controller';
export {
	DEFAULT_LIST_LIMIT,
	DiskCannotSignError,
	DiskNotPublicError,
	InvalidObjectKeyError,
	ObjectNotFoundError,
	PITHOS_DISKS,
	Storage,
	StorageDriver,
	UnknownDiskError
} from './storage';
