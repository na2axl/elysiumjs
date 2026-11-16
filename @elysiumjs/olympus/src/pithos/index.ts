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

export type {
	FileCondition,
	FileEvent,
	FileExpectation,
	FileMetadata,
	FileOwner,
	FilePatch,
	FileRecord,
	FilesOptions,
	FilesSetting,
	FileStatus,
	FileStoreDriver
} from './files.js';
export type { MemoryDiskOptions } from './memory.js';
export type { PithosModuleConfig } from './pithos.module.js';
export type { ServedSigning } from './signing.js';
export { joinUrl, signServedUrl } from './signing.js';
export type {
	ListOptions,
	ListPage,
	LocalDiskDriver,
	LocalDiskOptions,
	ObjectInfo,
	PutOptions,
	SignedUrlOptions,
	StorageBody,
	StoredObject
} from './storage.js';

export {
	DuplicateUploadPurposeError,
	FileNotReadyError,
	FilesUnavailableError,
	MissingUploadPurposeServiceError,
	UploadExpiredError,
	UploadMissingError,
	UploadNotPendingError,
	UploadPurposeUnknownError,
	UploadRejectedError,
	UploadTooLargeError,
	UploadTooManyPendingError,
	UploadTypeNotAllowedError
} from './errors.js';
export {
	Files,
	FileStore,
	meets,
	MemoryFileStore,
	PITHOS_FILE_DELETED,
	PITHOS_FILE_READY,
	PITHOS_FILE_REJECTED,
	STAGING_PREFIX,
	stagingKey
} from './files.js';
export { MemoryDisk } from './memory.js';
export { PithosModule } from './pithos.module.js';
export { StorageController, StoredObjectView } from './storage.controller.js';
export {
	FINISH_UPLOAD_ERRORS,
	type FinishUploadErrors,
	OPEN_UPLOAD_ERRORS,
	type OpenUploadErrors,
	Upload,
	type UploadRequest,
	Uploads,
	type UploadTicket
} from './uploads.js';
export {
	assertKey,
	DEFAULT_LIST_LIMIT,
	DiskCannotSignError,
	DiskNotPublicError,
	InvalidObjectKeyError,
	listLimit,
	ObjectNotFoundError,
	objectOf,
	PITHOS_DISKS,
	Storage,
	StorageDriver,
	streamOf,
	toBytes,
	UnknownDiskError
} from './storage.js';
