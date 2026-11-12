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

export interface HttpTransportOptions {
	url: string;
	headers?: Record<string, string>;
	batchSize?: number;
	flushInterval?: number;
	maxBufferSize?: number;
}

/**
 * HTTP transport for batching and sending logs to a remote endpoint.
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class HttpTransport {
	private buffer: string[] = [];
	private flushTimer?: ReturnType<typeof setInterval>;
	private maxBufferSize: number;

	constructor(private options: HttpTransportOptions) {
		this.options.batchSize ??= 100;
		this.options.flushInterval ??= 5000;
		this.maxBufferSize = this.options.maxBufferSize ?? 10_000;

		this.flushTimer = setInterval(() => this.flush(), this.options.flushInterval);
	}

	public write(formatted: string): void {
		if (this.buffer.length >= this.maxBufferSize) {
			this.buffer.shift();
		}

		this.buffer.push(formatted);

		if (this.buffer.length >= this.options.batchSize!) {
			this.flush();
		}
	}

	public async flush(): Promise<void> {
		if (this.buffer.length === 0) return;

		const batch = this.buffer.splice(0);

		try {
			await fetch(this.options.url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...this.options.headers
				},
				body: JSON.stringify({ logs: batch })
			});
		} catch {
			const space = this.maxBufferSize - this.buffer.length;
			if (space > 0) {
				this.buffer.unshift(...batch.slice(0, space));
			}
		}
	}

	public async close(): Promise<void> {
		if (this.flushTimer) clearInterval(this.flushTimer);
		await this.flush();
	}
}
