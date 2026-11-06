# @elysiumjs/ariadne-workers

A Cloudflare Durable Object store for [`@elysiumjs/ariadne`](../ariadne) flows: one object per flow, which deletes itself once the flow expires.

## Installation

```bash
bun add @elysiumjs/ariadne @elysiumjs/ariadne-workers
```

## Usage

Export the object from the Worker's entry:

```ts
export { FlowStoreObject } from '@elysiumjs/ariadne-workers';
```

Declare it in `wrangler.jsonc`:

```jsonc
{
	"durable_objects": { "bindings": [{ "name": "FLOWS", "class_name": "FlowStoreObject" }] },
	"migrations": [{ "tag": "v1", "new_sqlite_classes": ["FlowStoreObject"] }]
}
```

And give its binding to the flows:

```ts
import { AriadneModule } from '@elysiumjs/ariadne';
import { durableFlowStore } from '@elysiumjs/ariadne-workers';
import { Workers } from '@elysiumjs/runtime-workers';

AriadneModule.with({
	flows: [signUp],
	store: durableFlowStore(() => Workers.binding('FLOWS'))
});
```

Each flow lives in the object named `{flow}:{flowKey}`. A commit pushes its alarm to the flow's TTL. A finished flow keeps its last answer for up to 10 minutes, then only its owner and end time for its TTL, and then the object deletes its storage.
