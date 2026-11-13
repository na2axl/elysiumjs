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
import type { ExtractSubjectType, MongoAbility, MongoQuery } from '@casl/ability';
import type { PackRule } from '@casl/ability/extra';

import { AbilityBuilder, createMongoAbility, subject as tagSubject } from '@casl/ability';
import { packRules, unpackRules } from '@casl/ability/extra';

import { ElysiumError } from '../errors';
import { Service } from '../service';
import { cerberusConfig } from './config';

/**
 * What the rules know about an actor, such as its id and roles. It is empty until the app
 * declares it, once, for every domain's rules. Keep personal data out of it: rules only need
 * facts.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * declare module '@elysiumjs/olympus/cerberus' {
 * 	interface AbilityFacts {
 * 		userId: string;
 * 		roles: string[];
 * 	}
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by applications.
export interface AbilityFacts {}

/**
 * The names of the subjects rules are about, as keys. Any string is a subject until the app
 * declares them.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * declare module '@elysiumjs/olympus/cerberus' {
 * 	interface AbilitySubjects {
 * 		Post: true;
 * 		Comment: true;
 * 	}
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by applications.
export interface AbilitySubjects {}

/** The facts the rules read: `AbilityFacts` once the app declares it. */
export type Facts = keyof AbilityFacts extends never ? Record<string, unknown> : AbilityFacts;

/** The name of a subject, or `all` for every subject. */
export type SubjectName =
	(keyof AbilitySubjects extends never ? string : Extract<keyof AbilitySubjects, string>) | 'all';

/** An action, such as `read` or `update`; `manage` stands for every action. */
export type AbilityAction = 'manage' | (string & {});

/**
 * What a check is about: a subject name, an instance of a class with a `static subjectName`, or
 * an object tagged with `Abilities.subject()`.
 */
export type SubjectInput = SubjectName | object;

/** An ability: what an actor may do, with conditions written as MongoDB queries. */
export type Ability = MongoAbility<[AbilityAction, SubjectInput]>;

/** Grants (`can`) or refuses (`cannot`) actions on subjects, under optional conditions. */
export type GrantRule = (
	action: AbilityAction | AbilityAction[],
	subject: SubjectName | SubjectName[],
	conditions?: MongoQuery
) => void;

/**
 * The rules of one domain. `F` is the part of the facts they read.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface AbilityRules<F extends Partial<Facts> = Facts> {
	/** Grants and refuses over the facts. Rules are synchronous and read only the facts. */
	define(facts: F, can: GrantRule, cannot: GrantRule): void;
}

/** The compact form of an ability's rules, to carry in a token or a response. */
export type PackedAbility = PackRule<Ability['rules'][number]>[];

/**
 * What the cache holds for an actor: the rules, and the version and fingerprint they were built
 * for.
 */
type CachedAbility = {
	readonly version: string | number;
	readonly fingerprint: string;
	readonly rules: PackedAbility;
};

/**
 * Thrown by `@Abilities.rules()` when a domain name is not kebab-case.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class InvalidAbilityDomainError extends ElysiumError {
	constructor(domain: string) {
		super(`"${domain}" is not a kebab-case domain name.`);
	}
}

/**
 * Thrown when a subject has neither a `static subjectName` nor the tag of `Abilities.subject()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnknownSubjectTypeError extends ElysiumError {
	constructor() {
		super(
			'The subject has no subject name: give its class a `static readonly subjectName`, or tag it with Abilities.subject().'
		);
	}
}

const SUBJECT_TAG = '__caslSubjectType__';
const DOMAIN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * The subject type of a check: a string is itself, an instance gives the `static subjectName` of
 * its class, and a tagged object its tag. Class names are never read, since bundlers rename
 * classes.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param subject The subject of a check.
 * @throws {UnknownSubjectTypeError} When an object has no subject name.
 */
export const detectSubjectType = (subject: SubjectInput): ExtractSubjectType<SubjectName> => {
	if (typeof subject === 'string') return subject;
	const tag = (subject as Record<string, unknown>)[SUBJECT_TAG];
	if (typeof tag === 'string') return tag as SubjectName;
	const type = (subject as { constructor?: { subjectName?: unknown } }).constructor?.subjectName;
	if (typeof type === 'string') return type as SubjectName;
	throw new UnknownSubjectTypeError();
};

const Domains = Service.extension<AbilityRules<Partial<Facts>>>('elysium.cerberus.rules');

const build = (define: (can: GrantRule, cannot: GrantRule) => void): Ability => {
	const builder = new AbilityBuilder<Ability>((rules) =>
		createMongoAbility(rules, { detectSubjectType })
	);
	define(builder.can as unknown as GrantRule, builder.cannot as unknown as GrantRule);
	return builder.build();
};

let digest: { source: string; value: Promise<string> } | undefined;

const sha256 = async (value: string): Promise<string> => {
	const bytes = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
	);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const cacheKey = (actorId: string): string => `cerberus:ability:${actorId}`;

/**
 * The abilities of the application: each domain declares its rules, and they are composed over
 * the facts of one actor.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export namespace Abilities {
	/** The tag every domain's rules are registered with. */
	export const tag = Domains.tag;

	/**
	 * Declares a class as the rules of a domain: a singleton service to list in the services of
	 * the domain's module.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param domain The name of the domain, in kebab-case, unique in the application.
	 * @throws {InvalidAbilityDomainError} When the name is not kebab-case.
	 * @example
	 * ```ts
	 * @Abilities.rules('posts')
	 * export class PostRules implements AbilityRules {
	 * 	public define(facts: AbilityFacts, can: GrantRule) {
	 * 		can('read', 'Post', { status: 'published' });
	 * 		can('update', 'Post', { authorId: facts.userId });
	 * 	}
	 * }
	 * ```
	 */
	export const rules = (domain: string) => {
		if (!DOMAIN.test(domain)) throw new InvalidAbilityDomainError(domain);
		return Domains.register({ name: domain });
	};

	/** The rules of every domain, by domain, in module order. */
	const registered = (): Array<[string, AbilityRules<Partial<Facts>>]> =>
		Domains.all().map(({ service, options }) => [options.name, service]);

	/** The domains whose rules are registered, in module order. */
	export const domains = (): string[] => registered().map(([domain]) => domain);

	/**
	 * One ability from the rules of every domain over the facts of an actor.
	 * @param facts The facts of the actor.
	 */
	export const compose = (facts: Facts): Ability =>
		build((can, cannot) => {
			for (const [, domainRules] of registered()) domainRules.define(facts, can, cannot);
		});

	/**
	 * The ability of rules alone, such as one domain's rules in its tests.
	 * @param domainRules The rules, or a function that grants and refuses over the facts.
	 */
	export const from =
		<F extends Partial<Facts>>(
			domainRules: AbilityRules<F> | AbilityRules<F>['define']
		): ((facts: F) => Ability) =>
		(facts) =>
			build((can, cannot) =>
				typeof domainRules === 'function'
					? domainRules(facts, can, cannot)
					: domainRules.define(facts, can, cannot)
			);

	/**
	 * A digest of the source of every domain's rules: an ability cached by other code, such as
	 * before a deploy that changed a rule, is never served.
	 */
	export const fingerprint = (): Promise<string> => {
		const source = registered()
			.map(([domain, domainRules]) => `${domain}\n${domainRules.define.toString()}`)
			.join('\n\n');
		if (digest?.source !== source) {
			digest = { source, value: sha256(source).then((hex) => hex.slice(0, 16)) };
		}
		return digest.value;
	};

	/** The compact form of an ability's rules. */
	export const pack = (ability: Ability): PackedAbility => packRules(ability.rules);

	/** The ability of rules in compact form. */
	export const unpack = (packed: PackedAbility): Ability =>
		createMongoAbility<[AbilityAction, SubjectInput]>(unpackRules(packed), {
			detectSubjectType
		});

	/**
	 * Tags a plain object with its subject name, so that checks know what it is.
	 * @param type The subject name.
	 * @param object The object.
	 */
	export const subject = <T extends object>(type: SubjectName, object: T): T =>
		tagSubject(type, object as Record<PropertyKey, unknown>) as T;

	/**
	 * The ability of an actor, from the `facts` of `CerberusModule`. The cache serves it only
	 * for the version of the facts and the fingerprint of the rules it was built for, so a fact
	 * that changed or a rule that changed builds it again. Undefined when the actor has no facts,
	 * such as one who is not active.
	 * @param actorId The actor.
	 */
	export const of = async (actorId: string): Promise<Ability | undefined> => {
		const config = cerberusConfig();
		const found = await config.facts(actorId);
		if (!found) return undefined;
		const cache = config.cache();
		const fingerprint = await Abilities.fingerprint();
		const key = cacheKey(actorId);
		const cached = await cache?.get<CachedAbility>(key);
		if (
			cached?.version === found.version &&
			cached.fingerprint === fingerprint &&
			Array.isArray(cached.rules)
		) {
			return unpack(cached.rules);
		}
		const ability = compose(found.facts);
		await cache?.set<CachedAbility>(
			key,
			{ version: found.version, fingerprint, rules: pack(ability) },
			config.ttl * 1000
		);
		return ability;
	};

	/**
	 * Drops the cached ability of an actor, such as once a change of its facts has committed.
	 * The version of the facts keeps a stale entry from being served anyway: this only frees it
	 * early.
	 * @param actorId The actor.
	 */
	export const forget = async (actorId: string): Promise<void> => {
		await cerberusConfig().cache()?.del(cacheKey(actorId));
	};
}
