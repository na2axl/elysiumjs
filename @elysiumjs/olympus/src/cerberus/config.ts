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
import type { CacheInterface } from '../mnemosyne/cache';
import type { Facts } from './abilities';

import { ElysiumError } from '../errors';
import { MEMORY_CACHE_SERVICE } from '../mnemosyne/cache';
import { Service } from '../service';
import { Auth } from '../themis/auth';

/** The injection token of the resolved configuration of `CerberusModule`. */
export const CERBERUS_CONFIG = 'elysium.cerberus.config';

/** The facts of an actor, and the version they are at. */
export type VersionedFacts = {
	/**
	 * Changes whenever a fact the rules read changes, such as a counter the app bumps in the same
	 * transaction as the change: a cached ability built for another version is built again.
	 */
	readonly version: string | number;
	/** The facts. */
	readonly facts: Facts;
};

/**
 * The configuration of `CerberusModule`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type CerberusModuleConfig = {
	/** The facts of an actor and their version, or `null` for an actor without abilities. */
	facts(actorId: string): Promise<VersionedFacts | null> | VersionedFacts | null;
	/**
	 * The actor of the current request or call. Defaults to the `id` of the user of themis
	 * (`Auth.currentUser()`).
	 */
	actor?: () => string | undefined;
	/**
	 * Where built abilities are cached, such as `() => Cache.store('kv')`, or `false` to build
	 * them on each call. Defaults to the memory cache of `MnemosyneModule` when it provides one.
	 */
	cache?: false | (() => CacheInterface);
	/** The seconds a cached ability is kept. Defaults to 7 days. */
	ttl?: number;
};

/** The configuration as cerberus reads it. */
export type CerberusSettings = {
	readonly facts: CerberusModuleConfig['facts'];
	readonly actor: () => string | undefined;
	readonly cache: () => CacheInterface | undefined;
	readonly ttl: number;
};

/**
 * Thrown when cerberus needs the configuration of `CerberusModule` and the application does not
 * import it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class CerberusUnavailableError extends ElysiumError {
	constructor() {
		super('Abilities of actors need CerberusModule.with({ facts }) in the application.');
	}
}

/** The seconds a cached ability is kept by default. */
export const DEFAULT_ABILITY_TTL = 7 * 24 * 60 * 60;

const themisActor = (): string | undefined => {
	const id = (Auth.currentUser() as { id?: unknown } | undefined)?.id;
	return typeof id === 'string' ? id : undefined;
};

/** Builds the settings from the configuration. */
export const settingsOf = (config: CerberusModuleConfig): CerberusSettings => {
	const { cache } = config;
	return {
		facts: config.facts,
		actor: config.actor ?? themisActor,
		cache:
			cache === false
				? () => undefined
				: (cache ?? (() => Service.get<CacheInterface>(MEMORY_CACHE_SERVICE) ?? undefined)),
		ttl: config.ttl ?? DEFAULT_ABILITY_TTL
	};
};

/**
 * The settings of `CerberusModule`.
 * @throws {CerberusUnavailableError} When the application does not import it.
 */
export const cerberusConfig = (): CerberusSettings => {
	const settings = Service.get<CerberusSettings>(CERBERUS_CONFIG);
	if (!settings) throw new CerberusUnavailableError();
	return settings;
};
