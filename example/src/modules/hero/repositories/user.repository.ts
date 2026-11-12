import { DrizzleRepository } from '@elysiumjs/drizzle';
import { Service, ServiceScope } from '@elysiumjs/olympus';

import { UserModel } from '#hero/models/user.model';

@Service.register({ name: 'UserRepository', scope: ServiceScope.SINGLETON })
export class UserRepository extends DrizzleRepository(UserModel) {}
