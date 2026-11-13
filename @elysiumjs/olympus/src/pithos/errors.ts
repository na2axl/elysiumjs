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

import { t } from 'elysia';

import { ElysiumError } from '../errors';
import { DomainError } from '../problem';

/**
 * No upload purpose has this name, or it does not take files of this owner: a 422 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UploadPurposeUnknownError extends DomainError.for('UPLOAD_PURPOSE_UNKNOWN', 422) {
	constructor(purpose: string) {
		super(`Files cannot be uploaded for "${purpose}" here.`);
	}
}

/**
 * The purpose does not take files of this content type: a 415 problem that lists the types it
 * takes.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UploadTypeNotAllowedError extends DomainError.for('UPLOAD_TYPE_NOT_ALLOWED', 415, {
	extensions: { types: t.Array(t.String()) }
}) {
	constructor(types: readonly string[]) {
		super(`This file type is not accepted: send one of ${types.join(', ')}.`, {
			extensions: { types: [...types] }
		});
	}
}

/**
 * The file is larger than the purpose takes: a 413 problem with the largest size, in bytes.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UploadTooLargeError extends DomainError.for('UPLOAD_TOO_LARGE', 413, {
	extensions: { maxBytes: t.Integer() }
}) {
	constructor(maxBytes: number) {
		super(`The file is too large: at most ${maxBytes} bytes are accepted.`, {
			extensions: { maxBytes }
		});
	}
}

/**
 * The uploader has too many uploads started and not finished: a 429 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UploadTooManyPendingError extends DomainError.for('UPLOAD_TOO_MANY_PENDING', 429) {
	constructor() {
		super('Too many uploads are in progress: finish one before starting another.');
	}
}

/**
 * The upload is finished, rejected or expired already: a 409 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UploadNotPendingError extends DomainError.for('UPLOAD_NOT_PENDING', 409) {
	constructor() {
		super('This upload is not in progress.');
	}
}

/**
 * The time to upload the file is over: a 410 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UploadExpiredError extends DomainError.for('UPLOAD_EXPIRED', 410) {
	constructor() {
		super('This upload has expired: start it again.');
	}
}

/**
 * Nothing was uploaded yet: a 409 problem. The file can still be uploaded, then finished.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UploadMissingError extends DomainError.for('UPLOAD_MISSING', 409) {
	constructor() {
		super('The file was not uploaded yet: upload it, then try again.');
	}
}

/**
 * The uploaded file is not what was declared, and the upload is over: a 422 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UploadRejectedError extends DomainError.for('UPLOAD_REJECTED', 422) {
	constructor(public readonly reason: string) {
		super(`The file was refused: ${reason}. Start the upload again.`);
	}
}

/**
 * The file is not stored and ready for this use: a 422 problem. Upload it again.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class FileNotReadyError extends DomainError.for('FILE_NOT_READY', 422) {
	constructor() {
		super('This file is not available for this use: upload it again.');
	}
}

/**
 * Thrown when no files are configured: `PithosModule.with({ files })` is missing.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class FilesUnavailableError extends ElysiumError {
	constructor() {
		super('Files need PithosModule in the application.');
	}
}

/**
 * Thrown by `@Upload.purpose()` for a name another class has.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DuplicateUploadPurposeError extends ElysiumError {
	constructor(name: string) {
		super(`Another class is the upload purpose "${name}".`);
	}
}

/**
 * Thrown when an upload purpose is a service that no loaded module lists.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MissingUploadPurposeServiceError extends ElysiumError {
	constructor(name: string) {
		super(`The upload purpose ${name} is a service: list it in the services of a module.`);
	}
}
