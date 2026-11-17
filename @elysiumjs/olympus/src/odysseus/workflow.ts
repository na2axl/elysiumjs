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

import type { Kernel, ModuleNode, ProblemClass, Static, TSchema } from '../index.js';
import type { WorkflowDriver, WorkflowHost, WorkflowStatus } from './driver.js';
import type { WorkflowDuration } from './duration.js';
import type { WorkflowEvent, WorkflowEventPayload } from './event.js';
import type { StoredError } from './serialize.js';
import type { StepRetries, WorkflowStep } from './step.js';

import Value from 'typebox/value';

import {
	ElysiumError,
	KERNEL_SERVICE,
	Metadata,
	ModuleContext,
	Service,
	ValidationFailedError
} from '../index.js';
import {
	DuplicateWorkflowError,
	InvalidWorkflowError,
	OdysseusNotConfiguredError,
	UnregisteredWorkflowError,
	WorkflowAlreadyStartedError,
	WorkflowFinishedError,
	WorkflowNotFoundError,
	WorkflowTimeoutError
} from './errors.js';
import { WorkflowEvent as Events } from './event.js';
import { decodeValue, jsonCopy } from './serialize.js';

declare module '../index.js' {
	interface ModuleCollections {
		/** The workflows provided by the module, run by `OdysseusModule`. */
		workflows?: WorkflowClass[];
	}
}

/** The name of the global service holding the driver of `OdysseusModule`. */
export const ODYSSEUS_DRIVER = 'odysseus.driver';

const WORKFLOW = Symbol('elysium:odysseus:workflow');

/**
 * The properties of `@Workflow.register()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowProps<P extends TSchema = TSchema> = {
	/**
	 * The name of the workflow, unique in the application: 1 to 64 lowercase letters, digits, `.`,
	 * `_` or `-`, such as `orders.fulfil`.
	 */
	readonly name: string;
	/** The schema of the params, checked when an instance starts. */
	readonly params?: P;
	/**
	 * The DomainError classes its steps and `run()` return, so that a kept error comes back with
	 * its class on replay and in `Odysseus.status()`. Other errors come back as a plain DomainError
	 * with the same code. {@link WorkflowTimeoutError} is always known.
	 */
	readonly errors?: readonly ProblemClass[];
	/** The retries of its steps, unless a step sets its own. */
	readonly retries?: StepRetries;
	/** How long one attempt of its steps may run, unless a step sets its own. */
	readonly timeout?: WorkflowDuration;
	/**
	 * Driver options of the workflow, read by the driver that runs it, such as the binding of its
	 * own Cloudflare workflow for `cloudflare`.
	 */
	readonly driver?: Readonly<Record<string, unknown>>;
};

/**
 * A workflow as it is registered: its props and class.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowDefinition = WorkflowProps & {
	readonly cls: WorkflowClass;
	/** The DomainError classes its kept errors come back as. */
	readonly known: readonly ProblemClass[];
};

/**
 * A workflow class.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowClass<P = any, O = any> = abstract new (...args: any[]) => Workflow<P, O>;

/** The params of a workflow class. */
export type WorkflowParams<C> = C extends WorkflowClass<infer P, any> ? P : never;

/** The value `run()` of a workflow class returns. */
export type WorkflowOutput<C> = C extends WorkflowClass<any, infer O> ? O : never;

/**
 * An instance of a workflow: its workflow and id.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowRef = { readonly workflow: string; readonly id: string };

/**
 * What `Odysseus.status()` answers.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template O The value `run()` returns.
 */
export type WorkflowInstance<O = unknown> = WorkflowRef & {
	readonly status: WorkflowStatus;
	/** The value `run()` returned, once `completed`. A DomainError comes back with its class. */
	readonly output?: O;
	/** What `run()` threw, once `errored`. */
	readonly error?: StoredError;
	readonly createdAt?: Date;
	readonly updatedAt?: Date;
};

/**
 * The options of `Odysseus.start()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowStartOptions = {
	/**
	 * The id of the instance, unique in its workflow: 1 to 90 letters, digits, `_` or `-`, not
	 * starting with `-`. Starting twice with the same id starts one instance, so take it from what
	 * the instance is about, such as `order-42`.
	 */
	readonly id: string;
};

/** The longest instance id: Cloudflare's 100, less the prefix of a shared binding. */
const MAX_ID_LENGTH = 90;

let registry = new Map<string, WorkflowDefinition & { module: ModuleNode }>();

/**
 * A durable workflow: `run()` is a series of steps whose results are kept, so that it lives
 * through restarts, waits for days, and tries failing steps again, each step running once. List
 * the class in the `workflows` of a module; its constructor takes services like any service.
 *
 * `run()` is replayed from the start each time the instance wakes: finished steps give their kept
 * results without running again. Code outside the steps runs again on each replay, so it must
 * give the same answers every time: read the time, random values and anything that changes inside
 * a step.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template P The params of an instance.
 * @template O The value `run()` returns.
 * @example
 * ```ts
 * export const LabelPaid = WorkflowEvent.define('label-paid', t.Object({ labelId: t.String() }));
 *
 * @Workflow.register({ name: 'orders.ship', params: t.Object({ orderId: t.String() }) })
 * export class ShipOrder extends Workflow<{ orderId: string }, { labelId: string }> {
 * 	constructor(@Service.inject() private readonly carrier: CarrierClient) {
 * 		super();
 * 	}
 *
 * 	public async run({ orderId }: { orderId: string }, step: WorkflowStep) {
 * 		const label = await step.do('create label', () => this.carrier.createLabel(orderId));
 * 		const paid = await step.waitFor('label paid', LabelPaid, { timeout: '2 days' });
 * 		if (paid instanceof WorkflowTimeoutError) await step.do('cancel label', () => this.carrier.cancel(label.id));
 * 		return { labelId: label.id };
 * 	}
 * }
 *
 * @Module.register({ workflows: [ShipOrder], services: [CarrierClient] })
 * export class OrdersModule extends Module {}
 *
 * await Odysseus.start(ShipOrder, { orderId: '42' }, { id: 'order-42' });
 * ```
 */
export abstract class Workflow<P = unknown, O = unknown> {
	/**
	 * The work of the workflow.
	 * @param params The params of the instance.
	 * @param step The steps.
	 */
	public abstract run(params: P, step: WorkflowStep): Promise<O>;

	/**
	 * Declares a workflow.
	 * @param props The name and options of the workflow.
	 * @throws {InvalidWorkflowError} When the name is not valid.
	 */
	public static register<S extends TSchema>(props: WorkflowProps<S>) {
		if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(props.name ?? '')) {
			throw new InvalidWorkflowError(
				String(props.name),
				'needs a name of 1 to 64 lowercase letters, digits, ".", "_" or "-"'
			);
		}
		return <C extends WorkflowClass<Static<S>>>(target: C): C => {
			Metadata.define(WORKFLOW, props, target);
			return target;
		};
	}

	/**
	 * The props a workflow class was declared with, or `undefined`.
	 * @param cls The class.
	 */
	public static propsOf(cls: object): WorkflowProps | undefined {
		return Metadata.getOwn(WORKFLOW, cls);
	}
}

/**
 * Starts workflow instances, sends them events, reads where they stand and stops them, through
 * the driver of `OdysseusModule`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * await Odysseus.start(ShipOrder, { orderId: '42' }, { id: 'order-42' });
 * await Odysseus.signal(ShipOrder, 'order-42', LabelPaid, { labelId: 'l-1' });
 * const instance = await Odysseus.status(ShipOrder, 'order-42');
 * ```
 */
export namespace Odysseus {
	/**
	 * Starts an instance.
	 * @param workflow The workflow class.
	 * @param params The params, checked against the schema of the workflow.
	 * @param options The id of the instance.
	 * @returns The instance, or an error: one with this id exists already, or the params are invalid.
	 */
	export async function start<C extends WorkflowClass>(
		workflow: C,
		params: WorkflowParams<C>,
		options: WorkflowStartOptions
	): Promise<WorkflowRef | WorkflowAlreadyStartedError | ValidationFailedError> {
		const [result] = await startMany(workflow, [{ id: options.id, params }]);
		return result!;
	}

	/**
	 * Starts several instances in one call to the driver.
	 * @param workflow The workflow class.
	 * @param instances The id and params of each instance.
	 * @returns For each instance, in order, the instance or an error.
	 */
	export async function startMany<C extends WorkflowClass>(
		workflow: C,
		instances: readonly { readonly id: string; readonly params: WorkflowParams<C> }[]
	): Promise<(WorkflowRef | WorkflowAlreadyStartedError | ValidationFailedError)[]> {
		const defined = definition(workflow);
		const results: (WorkflowRef | WorkflowAlreadyStartedError | ValidationFailedError)[] = [];
		const requests: { index: number; id: string; params: unknown }[] = [];
		instances.forEach((instance, index) => {
			const checked = checkStart(defined, instance.id, instance.params);
			if (checked instanceof ValidationFailedError) results[index] = checked;
			else requests.push({ index, id: instance.id, params: checked });
		});
		if (requests.length > 0) {
			const started = await driver().start(
				requests.map(({ id, params }) => ({ workflow: defined.name, id, params }))
			);
			requests.forEach(({ index, id }, position) => {
				results[index] = started[position]
					? { workflow: defined.name, id }
					: new WorkflowAlreadyStartedError(defined.name, id);
			});
		}
		return results;
	}

	/**
	 * Sends an event to an instance. An event sent before the instance waits for it is kept until
	 * it does.
	 * @param workflow The workflow class.
	 * @param id The id of the instance.
	 * @param event The event.
	 * @param payload The payload, checked against the schema of the event.
	 * @returns Nothing, or an error: no such instance, the instance is finished, or the payload is invalid.
	 */
	export async function signal<E extends WorkflowEvent>(
		workflow: WorkflowClass,
		id: string,
		event: E,
		payload: WorkflowEventPayload<E>
	): Promise<void | WorkflowNotFoundError | WorkflowFinishedError | ValidationFailedError> {
		const defined = definition(workflow);
		const checked = Events.check(event, payload);
		if (!checked.ok)
			return new ValidationFailedError(checked.errors, 'The event payload is invalid.');
		const outcome = await driver().signal(defined.name, id, event.type, jsonCopy(checked.payload));
		if (outcome === 'missing') return new WorkflowNotFoundError(defined.name, id);
		if (outcome === 'finished') return new WorkflowFinishedError(defined.name, id);
	}

	/**
	 * Where an instance stands.
	 * @param workflow The workflow class.
	 * @param id The id of the instance.
	 * @returns The instance, or {@link WorkflowNotFoundError}.
	 */
	export async function status<C extends WorkflowClass>(
		workflow: C,
		id: string
	): Promise<WorkflowInstance<WorkflowOutput<C>> | WorkflowNotFoundError> {
		const defined = definition(workflow);
		const state = await driver().status(defined.name, id);
		if (!state) return new WorkflowNotFoundError(defined.name, id);
		return {
			workflow: defined.name,
			id,
			status: state.status,
			...(state.output === undefined
				? {}
				: { output: decodeValue(state.output, defined.known) as WorkflowOutput<C> }),
			...(state.error ? { error: state.error } : {}),
			...(state.createdAt ? { createdAt: state.createdAt } : {}),
			...(state.updatedAt ? { updatedAt: state.updatedAt } : {})
		};
	}

	/**
	 * Stops an instance. A step running now finishes, but nothing runs after it.
	 * @param workflow The workflow class.
	 * @param id The id of the instance.
	 * @returns Nothing, or an error: no such instance, or the instance is finished already.
	 */
	export async function terminate(
		workflow: WorkflowClass,
		id: string
	): Promise<void | WorkflowNotFoundError | WorkflowFinishedError> {
		const defined = definition(workflow);
		const stopped = await driver().terminate(defined.name, id);
		if (stopped) return;
		const state = await driver().status(defined.name, id);
		return state
			? new WorkflowFinishedError(defined.name, id)
			: new WorkflowNotFoundError(defined.name, id);
	}

	/**
	 * The definition of a workflow class or name.
	 * @param workflow The class, or the name.
	 * @throws {InvalidWorkflowError} When the class is not declared with `@Workflow.register()`.
	 * @throws {UnregisteredWorkflowError} When no module of the application lists it.
	 */
	export function definition(workflow: WorkflowClass | string): WorkflowDefinition {
		const name = typeof workflow === 'string' ? workflow : Workflow.propsOf(workflow)?.name;
		if (name === undefined) {
			throw new InvalidWorkflowError(
				(workflow as WorkflowClass).name,
				'is not declared with @Workflow.register()'
			);
		}
		const entry = registry.get(name);
		if (!entry || (typeof workflow !== 'string' && entry.cls !== workflow)) {
			throw new UnregisteredWorkflowError(name);
		}
		return entry;
	}
}

/**
 * The workflows of the application, filled by `OdysseusModule` from the `workflows` of the
 * modules.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export namespace WorkflowRegistry {
	/**
	 * Reads the workflows of the modules of the application.
	 * @throws {DuplicateWorkflowError} When two modules declare workflows with the same name.
	 * @throws {InvalidWorkflowError} When a listed class is not declared with `@Workflow.register()`.
	 */
	export const collect = (): Map<string, WorkflowDefinition & { module: ModuleNode }> => {
		const kernel = Service.get<Kernel>(KERNEL_SERVICE);
		if (!kernel) {
			throw new ElysiumError(
				`Odysseus needs the "${KERNEL_SERVICE}" service, which the kernel registers when it boots.`
			);
		}
		const found = new Map<string, WorkflowDefinition & { module: ModuleNode }>();
		for (const { item, module } of kernel.graph.collect('workflows')) {
			const cls = item as WorkflowClass;
			const props = Workflow.propsOf(cls);
			if (!props)
				throw new InvalidWorkflowError(cls.name, 'is not declared with @Workflow.register()');
			const existing = found.get(props.name);
			if (existing && existing.cls !== cls) {
				throw new DuplicateWorkflowError(props.name, [existing.module.id, module.id]);
			}
			found.set(props.name, {
				...props,
				cls,
				known: [WorkflowTimeoutError, ...(props.errors ?? [])],
				module
			});
		}
		return found;
	};

	/** Replaces the registered workflows. */
	export const set = (next: Map<string, WorkflowDefinition & { module: ModuleNode }>): void => {
		registry = new Map(next);
	};

	/** The registered workflows. */
	export const all = (): readonly WorkflowDefinition[] => [...registry.values()];

	/** Forgets the registered workflows. */
	export const clear = (): void => {
		registry = new Map();
	};

	/** The host that runs the registered workflows, for the drivers. */
	export const host: WorkflowHost = {
		definition: (workflow) => registry.get(workflow),
		run: (workflow, params, step) => {
			const entry = registry.get(workflow);
			if (!entry) return Promise.reject(new UnregisteredWorkflowError(workflow));
			return ModuleContext.run(entry.module, () =>
				Service.runInRequestScope(async () => {
					const instance = Service.make(entry.cls as unknown as new () => Workflow) as Workflow;
					return instance.run(params, step);
				})
			);
		}
	};
}

/** The driver of `OdysseusModule`. */
const driver = (): WorkflowDriver => {
	const found = Service.get<WorkflowDriver>(ODYSSEUS_DRIVER);
	if (!found) throw new OdysseusNotConfiguredError();
	return found;
};

/** The params of a start, with their defaults, or the invalid values. */
const checkStart = (
	definition: WorkflowDefinition,
	id: string,
	params: unknown
): unknown | ValidationFailedError => {
	if (
		typeof id !== 'string' ||
		id.length > MAX_ID_LENGTH ||
		!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(id)
	) {
		return new ValidationFailedError(
			[
				{
					pointer: '/id',
					message: `1 to ${MAX_ID_LENGTH} letters, digits, "_" or "-", not starting with "-".`
				}
			],
			'The workflow instance id is invalid.'
		);
	}
	if (!definition.params) return jsonCopy(params);
	const value = Value.Default(definition.params, structuredClone(params));
	const errors = [...Value.Errors(definition.params, value)];
	if (errors.length === 0) return jsonCopy(value);
	return new ValidationFailedError(
		errors.map((error) => ({
			pointer: `/params${(error as { instancePath?: string }).instancePath ?? ''}`,
			message: error.message
		})),
		'The workflow params are invalid.'
	);
};
