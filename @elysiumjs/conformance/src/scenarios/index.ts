// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import { diDisposal, diScopes } from './di-scopes';
import { errors } from './errors';
import { lifecycle } from './lifecycle';
import { middleware } from './middleware';
import { routing } from './routing';
import { sse } from './sse';
import { validation } from './validation';

export { runScenario } from './run';
export type { AssertAdapter, Scenario } from './types';

/**
 * Every conformance scenario, run identically on each runtime lane.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const scenarios = [
	routing,
	validation,
	diScopes,
	diDisposal,
	middleware,
	errors,
	lifecycle,
	sse
];
