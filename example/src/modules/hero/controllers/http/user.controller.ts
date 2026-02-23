import type { Context, EventData } from '@elysiumjs/core';
import type { MainModule } from '#hero/hero.module';
import type { User, UserInsert } from '#hero/models/user.model';
import type { Class } from 'type-fest';

import { Event, Http, HttpControllerScope, Service, t, WorkerPool } from '@elysiumjs/core';
import { HermesLogger } from '@elysiumjs/hermes';
import { Cache } from '@elysiumjs/mnemosyne';
import { isEmpty, uid } from 'radash';

import { EmailJob } from '#hero/jobs/email.job';
import { UserModel } from '#hero/models/user.model';
import { UserService } from '#hero/services/user.service';
import { co, mo } from '#hero/utils/decorators';

@Http.controller({ path: '/users', scope: HttpControllerScope.SERVER, tags: ['users'] })
export class UserController {
	public constructor(
		@Service.inject('user.service') public readonly userService: UserService,
		public id: string = uid(8)
	) {}

	@Http.get({
		response: t.Array(UserModel.selectSchema),
		operationId: 'users.list',
		description: 'Get all users',
		transactional: true
	})
	private async list(
		@mo() module: InstanceType<Class<MainModule>>,
		@Service.inject() logger: HermesLogger,
		@Http.context() c: Context
	): Promise<Array<User>> {
		// logger.log('ctx', App.context.getStore());
		let list = await Cache.memory.get<Array<User>>(`${c.tenant}:users:list`);
		if (!list) {
			list = await this.userService.userRepository.all();
			await Cache.memory.set(`${c.tenant}:users:list`, list);
		}

		return list!;
	}

	@Http.del({ response: t.Array(UserModel.selectSchema) })
	private async deleteAll(@Http.context() c: Context) {
		await Cache.memory.del(`${c.tenant}:users:list`);
		return this.userService.userRepository.deleteAll();
	}

	@Http.get({ path: '/:id', response: UserModel.selectSchema })
	private async getUser(
		@Http.param('id', t.String({ format: 'uuid' })) id: string,
		@Http.context() c: any
	) {
		const user = await this.userService.getUser(id);
		return !!user ? user : c.error(404, { message: 'User not found' });
	}

	@Http.post({ response: UserModel.selectSchema })
	private async post(
		@Http.body(UserModel.insertSchema) b: UserInsert,
		@Http.query() q: any,
		@co() c: UserController
	) {
		// const user = await this.userService.userRepository.insert(b);
		Event.emit('user:add', b);
		return b;
	}

	@Http.patch({ response: UserModel.selectSchema })
	private patch(
		@Http.body(UserModel.updateSchema) b: UserInsert,
		@Http.query() q: any,
		@co() c: UserController
	) {
		// return this.db.insert(usersTable).values(b).returning();
	}

	@Http.sse({ path: '/:id/notifications' })
	private async sse(@Http.query() q: any, @Http.context() c: Context) {
		while (isEmpty(this.userService.data)) {
			await Bun.sleep(10);
		}

		return { data: this.userService.data.shift(), id: uid(12), event: 'notification' };
	}

	@Event.on({ event: 'user:add' })
	private static addFromEvent(e: EventData<User>) {
		const us = Service.get<UserService>('user.service')!;
		us.data.push(e.data);
		WorkerPool.instance.runJob(EmailJob, e.data.email, 'Hello from Elysium!');
	}

	@Http.onRequest()
	private onRequest(c: Context) {
		// this.userService.logger.log(c);
	}
}
