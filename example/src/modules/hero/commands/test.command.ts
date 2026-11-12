import type { UserService } from '#hero/services/user.service';

import { Command, Service } from '@elysiumjs/olympus';

@Command.register()
export class TestCommand extends Command {
	public static readonly command = 'app:test';
	public static readonly description = 'Test command';

	constructor(@Service.inject('user.service') private userService: UserService) {
		super();
	}

	@Command.arg({ description: 'Name of the user', required: true })
	private name: string = '';

	@Command.arg({ description: 'Age of the user', required: true, default: 28 })
	private age: number = 0;

	public async run() {
		const users = await this.userService.userRepository.all();
		this.write(
			`Hello, ${this.name}! You are ${this.age} years old. You have ${users.length} users.`
		);
	}
}
