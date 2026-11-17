---
'@elysiumjs/drizzle': minor
---

Add the `drizzle` workflow store of `@elysiumjs/olympus/odysseus`: `workflowTables()` builds `workflow_instances`, `workflow_steps` and `workflow_events`, and `DrizzleWorkflowStore` keeps the instances of the `engine` driver in PostgreSQL, shared by any number of processes.
