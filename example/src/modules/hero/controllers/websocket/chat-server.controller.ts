import type { WS, WSError } from '@elysiumjs/core';
import type { UserInsert } from '#hero/models/user.model';

import { Service, Websocket } from '@elysiumjs/core';
import { HermesLogger } from '@elysiumjs/hermes';

import { UserModel } from '#hero/models/user.model';

@Websocket.controller('/chat', { idleTimeout: 10 })
export class ChatServerController {
	public constructor(@Service.inject() public logger: HermesLogger) {}

	@Websocket.onOpen()
	private onOpen() {
		this.logger.info('websocket opened');
	}

	@Websocket.onClose()
	private onClose() {
		this.logger.info('websocket closed');
	}

	@Websocket.onMessage(UserModel.insertSchema)
	private onMessage(ws: WS, data: UserInsert) {
		this.logger.info(`received message: ${JSON.stringify(data)} from ${ws.data.id}`);
		ws.send(JSON.stringify({ message: `Created user ${data.name}` }));
		throw new Error('Test websocket error');
	}

	@Websocket.onError()
	private onErrorWS(e: WSError) {
		this.logger.error(e.error.message);
	}
}
