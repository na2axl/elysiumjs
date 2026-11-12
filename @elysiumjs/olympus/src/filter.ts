// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { Class } from 'type-fest';
import type { ModuleNode } from './module-graph';

import { Container } from './container';
import { getLogger } from './logger';
import { Metadata } from './metadata';
import { ModuleContext } from './module-context';
import { isProblemDetails, problemResponse } from './problem';
import { Service } from './service';

const CATCH = Symbol('elysium:Catch');

/**
 * The context an exception filter receives: the request, the response being built (`set`), the
 * route and its parameters, as Elysia's error hook gives them.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FilterContext = {
	request: Request;
	set: { status?: number | string; headers: Record<string, string | number> };
	path: string;
	route?: string;
	params?: Record<string, string>;
	query?: Record<string, unknown>;
	[key: string]: unknown;
};

/**
 * Turns some errors into responses. Return a value to send it (a body, a `Response`, or problem
 * details, sent as `application/problem+json`), or `undefined` to pass the error to the next
 * level. Filters are services: they can inject other services of their module.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TError The errors the filter handles.
 */
export interface ExceptionFilter<TError = any> {
	catch(error: TError, ctx: FilterContext): unknown | Promise<unknown>;
}

/**
 * A class of exception filter.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FilterClass = Class<ExceptionFilter>;

/**
 * Declares which errors an exception filter handles, by class (`instanceof`). Without arguments,
 * the filter handles every error. Only records metadata.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param errors The error classes handled by the filter.
 * @example
 * ```ts
 * @Catch(PaymentDeclinedError)
 * class PaymentFilter implements ExceptionFilter<PaymentDeclinedError> {
 *   catch(error: PaymentDeclinedError) {
 *     return { type: 'payment-declined', title: 'Payment declined', status: 402, reason: error.reason };
 *   }
 * }
 * ```
 */
export const Catch =
	(...errors: Class<unknown>[]): ClassDecorator =>
	(target) => {
		Metadata.define(CATCH, errors, target);
	};

/**
 * One level of filters (route, controller, module or app) and the module they run in.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FilterLevel = { filters: FilterClass[]; node: ModuleNode | null };

/** The filter levels below the app (route, controller, module) of each route handler. */
export const routeFilterLevels = new WeakMap<Function, FilterLevel[]>();

/**
 * The key under which a route stores its filter levels on the request context, once routed, so
 * that the error hook finds them. Errors raised before routing (parsing) find them by route.
 */
export const FILTER_LEVELS = Symbol('elysium:FilterLevels');

/** Whether a filter class handles an error. */
const catches = (filter: FilterClass, error: unknown): boolean => {
	const errors: Class<unknown>[] = Metadata.get(CATCH, filter) ?? [];
	return errors.length === 0 || errors.some((cls) => error instanceof cls);
};

/** The built filter instances, per level object, so that each filter is built once per mount. */
const instances = new WeakMap<FilterLevel, Map<FilterClass, ExceptionFilter>>();

const instanceOf = (level: FilterLevel, cls: FilterClass): ExceptionFilter => {
	let built = instances.get(level);
	if (!built) instances.set(level, (built = new Map()));
	let filter = built.get(cls);
	if (!filter) {
		filter = level.node
			? ModuleContext.run(level.node, () => Service.make<ExceptionFilter>(cls))
			: Service.make<ExceptionFilter>(cls);
		built.set(cls, filter);
	}
	return filter;
};

/**
 * Runs the filters of each level in order, and returns the response of the first one that
 * returns a value. Each filter runs in its module's context and in the request scope. A filter
 * that throws is logged, and the original error goes on to the next filter.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param levels The levels, most specific first.
 * @param error The error to handle.
 * @param ctx The error context of the request.
 * @returns The response, or `undefined` when no filter handled the error.
 */
export const runFilters = async (
	levels: FilterLevel[],
	error: unknown,
	ctx: FilterContext
): Promise<{ response: unknown } | undefined> => {
	for (const level of levels) {
		for (const cls of level.filters) {
			if (!catches(cls, error)) continue;
			try {
				const run = () => instanceOf(level, cls).catch(error, ctx);
				const result = await Container.runInRequestScope(
					() => (level.node ? ModuleContext.run(level.node, run) : run()),
					ctx.request ?? ctx
				);
				if (result === undefined) continue;
				return { response: isProblemDetails(result) ? problemResponse(result) : result };
			} catch (filterError) {
				getLogger().error('An exception filter failed; the error goes to the next filter', {
					filter: cls.name,
					error: filterError
				});
			}
		}
	}
	return undefined;
};
