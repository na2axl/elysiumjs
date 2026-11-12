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
	FlowAmend,
	FlowClaim,
	FlowClaimResult,
	FlowCommit,
	FlowCommitResult,
	FlowRecord,
	FlowStore
} from '@elysiumjs/ariadne';
import type { RedisConnection } from '@elysiumjs/redis';

import { FLOW_TOMBSTONE_SECONDS } from '@elysiumjs/ariadne';

// Each flow is a hash (owner, step, lastStepId, completedAt, and the JSON of state and answer),
// a lease key that expires on its own, and a marker hash that outlives a finished flow. A missing
// step, step id or end time is an empty string, and the scripts never decode JSON.

const INIT = `
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'owner', ARGV[1], 'step', '', 'lastStepId', '', 'completedAt', '', 'state', 'null', 'answer', 'null')
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1`;

const CLAIM = `
if redis.call('EXISTS', KEYS[1]) == 0 then
	if redis.call('EXISTS', KEYS[3]) == 1 then return {'completed'} end
	return {'missing'}
end
local r = redis.call('HMGET', KEYS[1], 'step', 'lastStepId', 'completedAt', 'answer', 'state')
if r[2] == ARGV[1] then
	if r[1] == ARGV[2] then return {'replay', r[4]} end
	return {'unexpected-step'}
end
if r[3] ~= '' then return {'completed'} end
if redis.call('EXISTS', KEYS[2]) == 1 then return {'in-flight'} end
if r[1] ~= ARGV[3] then return {'unexpected-step'} end
redis.call('SET', KEYS[2], ARGV[1] .. '\\n' .. ARGV[2], 'PX', ARGV[4])
return {'ok', r[5]}`;

const RELEASE = `
local lease = redis.call('GET', KEYS[1])
if lease and string.match(lease, '^([^\\n]*)') == ARGV[1] then redis.call('DEL', KEYS[1]) end
return 0`;

const COMMIT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
	if redis.call('EXISTS', KEYS[3]) == 1 then return {'completed'} end
	return {'missing'}
end
local r = redis.call('HMGET', KEYS[1], 'step', 'lastStepId', 'completedAt', 'answer', 'owner')
if r[2] == ARGV[1] then return {'replayed', r[4]} end
if r[3] ~= '' then return {'completed'} end
if redis.call('GET', KEYS[2]) ~= ARGV[1] .. '\\n' .. ARGV[2] or r[1] ~= ARGV[3] then
	return {'unexpected-step'}
end
redis.call('DEL', KEYS[2])
local ttl = tonumber(ARGV[7])
local terminal = ARGV[6] == '1'
redis.call('HSET', KEYS[1], 'step', ARGV[2], 'lastStepId', ARGV[1], 'state', ARGV[4], 'answer', ARGV[5], 'completedAt', terminal and ARGV[8] or '')
if terminal then
	local tombstone = math.min(tonumber(ARGV[9]), ttl)
	redis.call('EXPIRE', KEYS[1], tombstone)
	redis.call('HSET', KEYS[3], 'owner', r[5], 'completedAt', ARGV[8])
	redis.call('EXPIRE', KEYS[3], tombstone + ttl)
else
	redis.call('EXPIRE', KEYS[1], ttl)
end
return {'ok'}`;

const AMEND = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local lease = redis.call('GET', KEYS[2])
if not lease or string.match(lease, '^([^\\n]*)') ~= ARGV[1] then return 0 end
if ARGV[3] == '1' then
	redis.call('DEL', KEYS[1], KEYS[2])
	return 1
end
redis.call('DEL', KEYS[2])
redis.call('HSET', KEYS[1], 'state', ARGV[2])
return 1`;

const orNull = (value: unknown): string | null =>
	typeof value === 'string' && value !== '' ? value : null;

const parse = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : null);

/**
 * Keeps flows in Redis. Claims and commits are atomic Lua scripts run with `EVAL`, which Upstash
 * runs too.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class RedisFlowStore implements FlowStore {
	constructor(
		private readonly options: {
			/** The Redis connection, or a function that returns it (such as `() => Redis.connection()`). */
			connection: RedisConnection | (() => RedisConnection);
			/** The prefix of the keys. Defaults to `flow:`. */
			prefix?: string;
		}
	) {}

	private get redis(): RedisConnection {
		const { connection } = this.options;
		return typeof connection === 'function' ? connection() : connection;
	}

	/** The keys of a flow, with a hash tag so that they live on the same cluster slot. */
	private keys(key: string): [string, string, string] {
		const base = `${this.options.prefix ?? 'flow:'}{${key}}`;
		return [base, `${base}:lease`, `${base}:done`];
	}

	private run(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
		return this.redis.send('EVAL', [script, String(keys.length), ...keys, ...args.map(String)]);
	}

	public async init(key: string, owner: string, ttlSeconds: number): Promise<void> {
		await this.run(INIT, this.keys(key), [owner, ttlSeconds]);
	}

	public async load(key: string): Promise<FlowRecord | null> {
		const [record, , done] = this.keys(key);
		const fields = (await this.redis.send('HMGET', [
			record,
			'owner',
			'step',
			'state',
			'lastStepId',
			'answer',
			'completedAt'
		])) as (string | null)[];
		if (typeof fields[0] === 'string') {
			return {
				owner: fields[0],
				step: orNull(fields[1]),
				state: parse(fields[2]),
				lastStepId: orNull(fields[3]),
				lastAnswer: parse(fields[4]),
				completedAt: orNull(fields[5])
			};
		}
		const marker = (await this.redis.send('HMGET', [done, 'owner', 'completedAt'])) as (
			string | null
		)[];
		if (typeof marker[0] !== 'string') return null;
		return {
			owner: marker[0],
			step: null,
			state: null,
			lastStepId: null,
			lastAnswer: null,
			completedAt: orNull(marker[1])
		};
	}

	public async claim(key: string, input: FlowClaim): Promise<FlowClaimResult> {
		const [reason, payload] = (await this.run(CLAIM, this.keys(key), [
			input.stepId,
			input.step,
			input.expectStep ?? '',
			input.leaseSeconds * 1000
		])) as [string, string?];
		if (reason === 'ok') return { ok: true, state: parse(payload) };
		if (reason === 'replay') return { ok: false, reason, answer: parse(payload) };
		return {
			ok: false,
			reason: reason as 'in-flight' | 'unexpected-step' | 'completed' | 'missing'
		};
	}

	public async release(key: string, stepId: string): Promise<void> {
		await this.run(RELEASE, [this.keys(key)[1]], [stepId]);
	}

	public async commit(key: string, input: FlowCommit): Promise<FlowCommitResult> {
		const [reason, answer] = (await this.run(COMMIT, this.keys(key), [
			input.stepId,
			input.step,
			input.expectStep ?? '',
			JSON.stringify(input.state ?? null),
			JSON.stringify(input.answer ?? null),
			input.terminal ? '1' : '0',
			input.ttlSeconds,
			new Date().toISOString(),
			FLOW_TOMBSTONE_SECONDS
		])) as [string, string?];
		if (reason === 'ok') return { ok: true, replayed: false, answer: input.answer };
		if (reason === 'replayed') return { ok: true, replayed: true, answer: parse(answer) };
		return { ok: false, reason: reason as 'unexpected-step' | 'completed' | 'missing' };
	}

	public async amend(key: string, input: FlowAmend): Promise<void> {
		const [record, lease] = this.keys(key);
		await this.run(
			AMEND,
			[record, lease],
			[input.stepId, JSON.stringify(input.state ?? null), input.end ? '1' : '0']
		);
	}
}
