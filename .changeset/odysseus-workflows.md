---
'@elysiumjs/olympus': minor
---

Add `@elysiumjs/olympus/odysseus`, durable workflows. A workflow is a class registered with `@Workflow.register()` and listed in the `workflows` of a module; its `run()` is a series of steps (`step.do()`, `step.sleep()`, `step.sleepUntil()`, `step.waitFor()`) whose results are kept, so that it survives restarts, waits for events and timers, and retries failing steps. A step that returns a DomainError is not retried, and the error comes back with its class. `Odysseus.start()`, `startMany()`, `signal()`, `status()` and `terminate()` answer errors as values. The `workflow` port takes drivers: `engine` runs workflows in the process over the new `workflow-store` port, with a `memory` store, leases between processes and `drain()` for tests.
