import { Service, ServiceScope } from '@elysiumjs/olympus';
import { DrizzleRepository } from '@elysiumjs/mnemosyne-drizzle';

import { UserModel } from '#hero/models/user.model';

@Service.register({ name: 'UserRepository', scope: ServiceScope.SINGLETON })
export class UserRepository extends DrizzleRepository(UserModel) {}
