---
'@elysiumjs/ariadne': minor
---

Breaking: a flow request without its `x-flow-key` or `x-flow-step` header is a 400 `BAD_REQUEST` problem (was 422 `VALIDATION_FAILED`). A body that does not match the step's schema stays a 422.
