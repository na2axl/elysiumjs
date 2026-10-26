---
'@elysiumjs/core': patch
---

WAMP clients use Bun's own `WebSocket` again. The subclass that faked the `protocol` field is gone, since Bun now fills it (oven-sh/bun#18744).
