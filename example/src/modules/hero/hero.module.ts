import { Module } from '@elysiumjs/core';

import { ProgressDemoCommand } from '#hero/commands/progress-demo.command';
import { SpinnerDemoCommand } from '#hero/commands/spinner-demo.command';
import { TestCommand } from '#hero/commands/test.command';
import { UserController } from '#hero/controllers/http/user.controller';
import { ChatServerController } from '#hero/controllers/websocket/chat-server.controller';
import { EmailJob } from '#hero/jobs/email.job';
import { FailingJob } from '#hero/jobs/failing.job';
import { UserRepository } from '#hero/repositories/user.repository';
import { UserService } from '#hero/services/user.service';

@Module.register({
	services: [UserService, UserRepository],
	controllers: [UserController, ChatServerController],
	commands: [ProgressDemoCommand, SpinnerDemoCommand, TestCommand],
	jobs: [EmailJob, FailingJob]
})
export class MainModule extends Module {}
