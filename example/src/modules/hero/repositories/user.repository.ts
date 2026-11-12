import { Service, ServiceScope } from '@elysiumjs/olympus';
import { Repository } from '@elysiumjs/olympus/mnemosyne';

import { UserModel } from '#hero/models/user.model';

@Service.register({ name: 'UserRepository', scope: ServiceScope.SINGLETON })
export class UserRepository extends Repository(UserModel) {}
