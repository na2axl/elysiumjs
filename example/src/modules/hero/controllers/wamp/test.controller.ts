import type { LoggerInterface, WampRegistrationHandlerArgs } from '@elysiumjs/olympus';

import { LOGGER_SERVICE, Service, Wamp } from '@elysiumjs/olympus';

@Wamp.controller({ connection: 'default' })
export class TestController {
	public constructor(@Service.inject(LOGGER_SERVICE) public logger: LoggerInterface) {}

	@Wamp.register('test.topic.ext')
	private onTestTopic(data: WampRegistrationHandlerArgs) {
		console.log('Received data: ', data);
		data.result_handler({ argsList: ['Hello from WampController1'], options: { progress: true } });
		// ...
		data.result_handler({ argsList: ['Hello from WampController2'], options: { progress: true } });
		// ...
		data.result_handler({ argsList: ['Hello from WampController3'], options: { progress: true } });
	}

	@Wamp.subscribe('test.topic.notify')
	private onTestTopicNotify(data: WampRegistrationHandlerArgs) {
		console.log('Received data: ', data);
	}
}
