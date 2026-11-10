---
'@elysiumjs/heracles': minor
---

`Scheduler` fan-outs run in the background scopes, with `kind: 'schedule'` and the name of the scheduler. The new `heracles:crons` command prints the cron triggers the scheduled jobs need, reading them from the module graph without booting the application, and `--check <wrangler.jsonc>` checks the cron triggers of the top level and of each environment (`--env <name>` for one); it replaces the `--list` and `--check` options of `heracles:schedule`. `JobRegistry.collect()` reads the jobs of the modules without initialising them.
