---
'@elysiumjs/mnemosyne-drizzle': minor
---

`migration:generate` reads the schema of the application: every table, Postgres schema, enum, sequence, view, role and policy that the project files the app loads export, directly or as a value of an exported object (like the tables `moiraiTables()` returns). Models may live anywhere in the project, in any number of modules. Without a terminal, the command asks for `--name` instead of waiting on the prompt.
