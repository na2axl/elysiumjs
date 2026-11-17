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

import type {
	ClaimedInstance,
	InstanceSettlement,
	StoredEvent,
	StoredInstance,
	StoredStep,
	WorkflowLease,
	WorkflowStatus,
	WorkflowStoreDriver
} from '@elysiumjs/olympus/odysseus';
import type { RedisConnection } from '../connection.js';

import { WorkflowStore } from '@elysiumjs/olympus/odysseus';

import { Redis } from '../redis.js';

/**
 * Options of {@link RedisWorkflowStore}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RedisWorkflowStoreOptions = {
	/** The `RedisModule` connection that keeps the instances. Defaults to `default`. */
	connection?: string;
	/**
	 * The prefix of the keys. Defaults to `odysseus:`. On Redis Cluster, give it a hash tag, such
	 * as `{odysseus}:`, so that every key of the store lives on one slot.
	 */
	prefix?: string;
	/** How many finished instances one purge deletes at most. Defaults to 1000. */
	purgeBatch?: number;
};

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'workflow-store:redis': typeof RedisWorkflowStore;
	}
}

// Every script takes the time from the caller, as the engine reads it from its clock. An instance
// is a hash; its steps and its events are hashes of their own; `due:<workflow>` is a sorted set
// of the instances that will need a worker, scored by their wake time, or by the end of their
// lease while one holds them; `finished` is a sorted set of the finished instances by end time.
// Values given by the application (params, outputs, steps, events) are kept as the JSON strings
// the client wrote, never decoded in Lua.

/** KEYS: instance, due, steps, events. ARGV: id, params, status, wake, created, updated. */
const CREATE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('DEL', KEYS[3], KEYS[4])
redis.call('HSET', KEYS[1], 'params', ARGV[2], 'status', ARGV[3], 'wake', ARGV[4], 'owner', '',
	'until', '', 'seq', 0, 'output', '', 'error', '', 'created', ARGV[5], 'updated', ARGV[6])
if ARGV[4] ~= '' then redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1]) end
return 1`;

/** KEYS: instance, due, steps, events. ARGV: id, owner, until, now. */
const CLAIM = `
local h = redis.call('HMGET', KEYS[1], 'status', 'wake', 'owner', 'until')
if not h[1] or (h[1] ~= 'queued' and h[1] ~= 'waiting' and h[1] ~= 'running') then
	redis.call('ZREM', KEYS[2], ARGV[1])
	return false
end
local now = tonumber(ARGV[4])
if h[2] == '' or tonumber(h[2]) > now then return false end
if h[3] ~= '' and tonumber(h[4]) > now then return false end
redis.call('HSET', KEYS[1], 'status', 'running', 'owner', ARGV[2], 'until', ARGV[3], 'updated', ARGV[4])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
return { redis.call('HGETALL', KEYS[1]), redis.call('HGETALL', KEYS[3]), redis.call('HGETALL', KEYS[4]) }`;

/** KEYS: instance, due. ARGV: id, owner, until. */
const EXTEND = `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], 'until', ARGV[3])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
return 1`;

/** KEYS: instance, steps, events. ARGV: owner, key, step, takes. */
const SAVE_STEP = `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
if ARGV[4] ~= '' then redis.call('HDEL', KEYS[3], ARGV[4]) end
return 1`;

/** KEYS: instance, due, finished. ARGV: id, member, owner, status, wake, output, error, seen, now. */
const SETTLE = `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[3] then return 0 end
local wake = ARGV[5]
if ARGV[4] == 'waiting' and tonumber(redis.call('HGET', KEYS[1], 'seq')) > tonumber(ARGV[8]) then
	wake = ARGV[9]
end
redis.call('HSET', KEYS[1], 'status', ARGV[4], 'wake', wake, 'output', ARGV[6], 'error', ARGV[7],
	'owner', '', 'until', '', 'updated', ARGV[9])
if ARGV[4] ~= 'waiting' then
	redis.call('ZREM', KEYS[2], ARGV[1])
	redis.call('ZADD', KEYS[3], ARGV[9], ARGV[2])
elseif wake ~= '' then
	redis.call('ZADD', KEYS[2], wake, ARGV[1])
else
	redis.call('ZREM', KEYS[2], ARGV[1])
end
return 1`;

/** KEYS: instance, events, due. ARGV: id, event, now. */
const ADD_EVENT = `
local h = redis.call('HMGET', KEYS[1], 'status', 'wake', 'owner', 'until')
if not h[1] then return 'missing' end
if h[1] == 'completed' or h[1] == 'errored' or h[1] == 'terminated' then return 'finished' end
local now = tonumber(ARGV[3])
local seq = redis.call('HINCRBY', KEYS[1], 'seq', 1)
redis.call('HSET', KEYS[2], seq, ARGV[2])
local wake = h[2]
if wake == '' or tonumber(wake) > now then wake = ARGV[3] end
redis.call('HSET', KEYS[1], 'wake', wake, 'updated', ARGV[3])
if h[3] == '' or tonumber(h[4]) <= now then redis.call('ZADD', KEYS[3], wake, ARGV[1]) end
return 'sent'`;

/** KEYS: instance, due, finished. ARGV: id, member, now. */
const TERMINATE = `
local status = redis.call('HGET', KEYS[1], 'status')
if not status or status == 'completed' or status == 'errored' or status == 'terminated' then return 0 end
redis.call('HSET', KEYS[1], 'status', 'terminated', 'wake', '', 'owner', '', 'until', '', 'updated', ARGV[3])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[2])
return 1`;

/** KEYS: finished. ARGV: prefix, before (exclusive), limit. */
const PURGE = `
local members = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', '(' .. ARGV[2], 'LIMIT', 0, ARGV[3])
for _, member in ipairs(members) do
	redis.call('DEL', ARGV[1] .. 'i:' .. member, ARGV[1] .. 's:' .. member, ARGV[1] .. 'e:' .. member)
	redis.call('ZREM', KEYS[1], member)
end
return #members`;

/** A reply of `HGETALL`, as a record, whether the client answers a flat list, an object or a map. */
const recordOf = (reply: unknown): Record<string, string> => {
	if (reply === null || reply === undefined) return {};
	// `Object.fromEntries` defines every key as its own, `__proto__` included.
	if (Array.isArray(reply)) {
		const entries: [string, string][] = [];
		for (let i = 0; i + 1 < reply.length; i += 2)
			entries.push([String(reply[i]), String(reply[i + 1])]);
		return Object.fromEntries(entries);
	}
	if (reply instanceof Map) {
		return Object.fromEntries([...reply].map(([key, value]) => [String(key), String(value)]));
	}
	return Object.fromEntries(
		Object.entries(reply as Record<string, unknown>).map(([key, value]) => [key, String(value)])
	);
};

/** A kept JSON string, read back; the empty string is no value. */
const parse = (value: string | undefined): unknown =>
	value === undefined || value === '' ? undefined : JSON.parse(value);

/** A value, written as JSON; `undefined` is no value. */
const json = (value: unknown): string => (value === undefined ? '' : JSON.stringify(value));

/** A time of an instance hash, as the store answers it. */
const time = (value: string | undefined): number | null =>
	value === undefined || value === '' ? null : Number(value);

/** An instance hash, as the store answers it. */
const instanceOf = (workflow: string, id: string, hash: Record<string, string>): StoredInstance => {
	const output = parse(hash.output);
	return {
		workflow,
		id,
		params: parse(hash.params),
		status: hash.status as WorkflowStatus,
		...(output === undefined ? {} : { output }),
		error: (parse(hash.error) as StoredInstance['error']) ?? null,
		wakeAt: time(hash.wake),
		createdAt: Number(hash.created),
		updatedAt: Number(hash.updated)
	};
};

/**
 * Keeps workflow instances in Redis, for the `engine` driver: every write is one Lua script, so
 * that any number of processes share the server. Works with every client of `RedisModule` that
 * runs `EVAL`, Upstash included. Make the server persist its data (AOF), as instances last for
 * days.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * OdysseusModule.with({
 * 	driver: () =>
 * 		Workflows.for('engine', {
 * 			store: () => WorkflowStore.for('redis', { connection: 'workflows' })
 * 		})
 * });
 * ```
 */
@WorkflowStore.driver('redis')
export class RedisWorkflowStore implements WorkflowStoreDriver {
	readonly #options: Required<RedisWorkflowStoreOptions>;

	constructor(options: RedisWorkflowStoreOptions = {}) {
		this.#options = {
			connection: options.connection ?? 'default',
			prefix: options.prefix ?? 'odysseus:',
			purgeBatch: options.purgeBatch ?? 1000
		};
	}

	public async create(instance: StoredInstance): Promise<boolean> {
		const { workflow, id } = instance;
		const created = await this.#eval(
			CREATE,
			[
				this.#instance(workflow, id),
				this.#due(workflow),
				this.#steps(workflow, id),
				this.#events(workflow, id)
			],
			[
				id,
				json(instance.params),
				instance.status,
				instance.wakeAt === null ? '' : String(instance.wakeAt),
				String(instance.createdAt),
				String(instance.updatedAt)
			]
		);
		return Number(created) === 1;
	}

	public async get(workflow: string, id: string): Promise<StoredInstance | null> {
		const hash = recordOf(await this.#redis().send('HGETALL', [this.#instance(workflow, id)]));
		return hash.status === undefined ? null : instanceOf(workflow, id, hash);
	}

	public async due(
		now: number,
		limit: number,
		workflows: readonly string[]
	): Promise<{ workflow: string; id: string }[]> {
		const found: { workflow: string; id: string; score: number }[] = [];
		for (const workflow of workflows) {
			const reply = (await this.#redis().send('ZRANGEBYSCORE', [
				this.#due(workflow),
				'-inf',
				String(now),
				'WITHSCORES',
				'LIMIT',
				'0',
				String(limit)
			])) as unknown[];
			for (const [id, score] of pairsOf(reply)) found.push({ workflow, id, score });
		}
		return found
			.sort((a, b) => a.score - b.score)
			.slice(0, limit)
			.map(({ workflow, id }) => ({ workflow, id }));
	}

	public async claim(
		workflow: string,
		id: string,
		lease: WorkflowLease,
		now: number
	): Promise<ClaimedInstance | null> {
		const reply = (await this.#eval(
			CLAIM,
			[
				this.#instance(workflow, id),
				this.#due(workflow),
				this.#steps(workflow, id),
				this.#events(workflow, id)
			],
			[id, lease.owner, String(lease.until), String(now)]
		)) as [unknown, unknown, unknown] | null;
		if (!reply) return null;
		const hash = recordOf(reply[0]);
		const steps = recordOf(reply[1]);
		const events = Object.entries(recordOf(reply[2]))
			.map(([seq, value]): StoredEvent => {
				const event = JSON.parse(value) as Omit<StoredEvent, 'seq'>;
				return {
					seq: Number(seq),
					type: event.type,
					payload: event.payload,
					at: event.at
				};
			})
			.sort((a, b) => a.seq - b.seq);
		return {
			instance: instanceOf(workflow, id, hash),
			steps: Object.fromEntries(
				Object.entries(steps).map(([key, value]) => [key, JSON.parse(value) as StoredStep])
			),
			events,
			lastSeq: Number(hash.seq ?? 0)
		};
	}

	public async extend(workflow: string, id: string, lease: WorkflowLease): Promise<boolean> {
		const extended = await this.#eval(
			EXTEND,
			[this.#instance(workflow, id), this.#due(workflow)],
			[id, lease.owner, String(lease.until)]
		);
		return Number(extended) === 1;
	}

	public async saveStep(
		workflow: string,
		id: string,
		owner: string,
		key: string,
		step: StoredStep,
		takes?: number
	): Promise<boolean> {
		const saved = await this.#eval(
			SAVE_STEP,
			[this.#instance(workflow, id), this.#steps(workflow, id), this.#events(workflow, id)],
			[owner, key, JSON.stringify(step), takes === undefined ? '' : String(takes)]
		);
		return Number(saved) === 1;
	}

	public async settle(
		workflow: string,
		id: string,
		owner: string,
		settlement: InstanceSettlement,
		now: number
	): Promise<boolean> {
		const settled = await this.#eval(
			SETTLE,
			[this.#instance(workflow, id), this.#due(workflow), this.#finished()],
			[
				id,
				`${workflow}:${id}`,
				owner,
				settlement.status,
				settlement.wakeAt === null ? '' : String(settlement.wakeAt),
				json(settlement.output),
				json(settlement.error),
				String(settlement.seenSeq),
				String(now)
			]
		);
		return Number(settled) === 1;
	}

	public async addEvent(
		workflow: string,
		id: string,
		type: string,
		payload: unknown,
		now: number
	): Promise<'sent' | 'missing' | 'finished'> {
		const outcome = await this.#eval(
			ADD_EVENT,
			[this.#instance(workflow, id), this.#events(workflow, id), this.#due(workflow)],
			[id, JSON.stringify({ type, payload, at: now }), String(now)]
		);
		return String(outcome) as 'sent' | 'missing' | 'finished';
	}

	public async terminate(workflow: string, id: string, now: number): Promise<boolean> {
		const stopped = await this.#eval(
			TERMINATE,
			[this.#instance(workflow, id), this.#due(workflow), this.#finished()],
			[id, `${workflow}:${id}`, String(now)]
		);
		return Number(stopped) === 1;
	}

	public async purge(before: number): Promise<number> {
		const batch = this.#options.purgeBatch;
		let total = 0;
		for (;;) {
			const purged = Number(
				await this.#eval(
					PURGE,
					[this.#finished()],
					[this.#options.prefix, String(before), String(batch)]
				)
			);
			total += purged;
			if (purged < batch) return total;
		}
	}

	// Workflow names and instance ids hold no ":", so `<workflow>:<id>` names one instance.
	#instance(workflow: string, id: string): string {
		return `${this.#options.prefix}i:${workflow}:${id}`;
	}

	#steps(workflow: string, id: string): string {
		return `${this.#options.prefix}s:${workflow}:${id}`;
	}

	#events(workflow: string, id: string): string {
		return `${this.#options.prefix}e:${workflow}:${id}`;
	}

	#due(workflow: string): string {
		return `${this.#options.prefix}due:${workflow}`;
	}

	#finished(): string {
		return `${this.#options.prefix}finished`;
	}

	#eval(script: string, keys: string[], args: string[]): Promise<unknown> {
		return this.#redis().send('EVAL', [script, String(keys.length), ...keys, ...args]);
	}

	#redis(): RedisConnection {
		return Redis.getConnection(this.#options.connection);
	}
}

/** The members and scores of a `WITHSCORES` reply, flat or in pairs. */
const pairsOf = (reply: unknown[] | null): [string, number][] => {
	if (!reply) return [];
	if (reply.length > 0 && Array.isArray(reply[0])) {
		return (reply as [unknown, unknown][]).map(([member, score]) => [
			String(member),
			Number(score)
		]);
	}
	const pairs: [string, number][] = [];
	for (let i = 0; i + 1 < reply.length; i += 2)
		pairs.push([String(reply[i]), Number(reply[i + 1])]);
	return pairs;
};
