---
'@elysiumjs/mnemosyne-drizzle': minor
---

Add table markers: `DrizzleTable.define(DrizzleTable.partitioned({ range }), DrizzleTable.afterCreate(build))(table)` makes `migration:generate` create the table with `PARTITION BY RANGE` and add SQL right after it, in the migration that creates the table.
