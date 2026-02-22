// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import type { DrizzleConnectionProps } from './database';
import type { MnemosyneConfig } from '@elysiumjs/mnemosyne';

import { Application, Event } from '@elysiumjs/core';

import { Database } from './database';

// Re-exports
export { Database, DrizzleDatabaseCache } from './database';
export type { DrizzleConnectionProps, DrizzleConnection } from './database';
export { DrizzleModel, createSchemaFromDrizzle, drizzleAdapter } from './model';
export { DrizzleRepository } from './repository';
export {
	DrizzleSchemaTenancy,
	DrizzleRLSTenancy,
	wrapTenantSchema,
	registerTenantSchema,
	getTenantSchema,
	withRLS,
	setConnectionTenant,
	getSessionTenant,
	createRLSPolicy,
} from './tenancy';

// Auto-initialize on app launch
Event.once('elysium:app:launched', () => {
	const app = Application.instance;
	const config = app.getConfig<MnemosyneConfig<DrizzleConnectionProps>>('elysium:mnemosyne' as any);

	if (config?.database) {
		for (const [name, props] of Object.entries(config.database.connections)) {
			Database.registerConnection(name, props);
		}
		if (Database.connectionExists(config.database.default)) {
			Database.setDefaultConnection(config.database.default);
		}
	}
});
