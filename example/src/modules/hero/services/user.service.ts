import type { LifecycleEvent } from '@elysiumjs/olympus';

import { Lifecycle, Service, ServiceScope } from '@elysiumjs/olympus';
import { HermesLogger } from '@elysiumjs/olympus/hermes';

import { UserRepository } from '#hero/repositories/user.repository';

@Service.register({ name: 'user.service', scope: ServiceScope.SINGLETON })
export class UserService {
	public constructor(
		@Service.inject() public logger: HermesLogger,
		@Service.inject() public userRepository: UserRepository
	) {}

	public data: any[] = [];

	public say(sth: string) {
		this.logger.info(sth);
	}

	getUser(id: string) {
		return this.userRepository.find(id);
	}

	@Lifecycle.on('user:say')
	private static sayFromEvent(e: LifecycleEvent<string>) {
		const logger = Service.get(HermesLogger)!;
		logger.info(`from source: ${e.source} with event: ${e.data}`);
		throw new Error('Custom error');
	}
}
