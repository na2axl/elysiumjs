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

import { presignS3Url } from '../src/sigv4';

describe('presignS3Url', () => {
	it('matches the presigned GET example of the S3 documentation', async () => {
		const url = await presignS3Url({
			method: 'GET',
			url: 'https://examplebucket.s3.amazonaws.com/test.txt',
			accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
			secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
			region: 'us-east-1',
			expiresIn: 86400,
			now: new Date('2013-05-24T00:00:00Z')
		});
		expect(new URL(url).searchParams.get('X-Amz-Signature')).toBe(
			'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'
		);
	});

	it('signs the given headers and escapes the key', async () => {
		const url = new URL(
			await presignS3Url({
				method: 'PUT',
				url: 'https://acct.r2.cloudflarestorage.com/media/a%20b/c(1).png',
				accessKeyId: 'id',
				secretAccessKey: 'secret',
				region: 'auto',
				expiresIn: 60,
				headers: { 'Content-Type': 'image/png', 'Content-Length': '42' }
			})
		);
		expect(url.pathname).toBe('/media/a%20b/c%281%29.png');
		expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
		expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
	});
});
