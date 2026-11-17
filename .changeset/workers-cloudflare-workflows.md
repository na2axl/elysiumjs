---
'@elysiumjs/workers': minor
---

Add the `cloudflare` workflow driver of `@elysiumjs/olympus/odysseus`: `CloudflareWorkflowDriver` runs workflows on Cloudflare Workflows, through one shared binding (`WORKFLOWS`) or a binding per workflow (`driver: { binding }`), and `WorkflowRunner` (from `@elysiumjs/workers/durable-objects`) is the one Workflow class that runs them. `createWorker()` hands the application to the runner.
