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

import type { ThemisConfig } from './config';

import { Http, Service } from '@elysiumjs/core';

import { THEMIS_CONFIG } from './config';
import { MissingThemisConfigError } from './errors';

/** The request context of the current request, shared by its middlewares and its handler. */
export type HttpContext = {
	request: Request;
	set: { status?: number | string; headers: Record<string, string | number | string[]> };
	body?: unknown;
	[key: string]: unknown;
};

/**
 * The context of the current request.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const currentContext = (): HttpContext | undefined => Http.currentContext<HttpContext>();

/**
 * The configuration of ThemisModule.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const themisConfig = (): ThemisConfig => {
	const config = Service.exists(THEMIS_CONFIG) ? Service.get<ThemisConfig>(THEMIS_CONFIG) : null;
	if (!config) throw new MissingThemisConfigError();
	return config;
};

/** The value of a cookie of a request. */
export const readCookie = (request: Request, name: string): string | undefined => {
	const header = request.headers.get('cookie');
	if (!header) return undefined;
	for (const part of header.split(';')) {
		const index = part.indexOf('=');
		if (index < 0) continue;
		if (part.slice(0, index).trim() === name) {
			try {
				return decodeURIComponent(part.slice(index + 1).trim());
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
};

/**
 * The attributes of a cookie.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type CookieOptions = {
	name?: string;
	path?: string;
	domain?: string;
	/** Defaults to `true`. Set it to `false` for local HTTP development only. */
	secure?: boolean;
	/** Defaults to `true`. */
	httpOnly?: boolean;
	/** Defaults to `Lax`. */
	sameSite?: 'Strict' | 'Lax' | 'None';
};

/** Adds a `Set-Cookie` header to the response of a context. */
export const writeCookie = (
	context: HttpContext,
	name: string,
	value: string,
	options: CookieOptions & { maxAge?: number }
): void => {
	const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`];
	if (options.domain) parts.push(`Domain=${options.domain}`);
	if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
	if (options.httpOnly ?? true) parts.push('HttpOnly');
	if (options.secure ?? true) parts.push('Secure');
	parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
	const cookie = parts.join('; ');

	const headers = context.set.headers;
	const existing = headers['set-cookie'];
	if (existing === undefined) headers['set-cookie'] = cookie;
	else
		headers['set-cookie'] = [...(Array.isArray(existing) ? existing : [String(existing)]), cookie];
};
