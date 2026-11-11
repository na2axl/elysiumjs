---
'@elysiumjs/core': minor
'@elysiumjs/mnemosyne': minor
'@elysiumjs/styx': minor
---

Seeders: `@Seeder.register()` classes listed in a module's `seeders`, run by `styx db:seed` in their module and in a transaction of their own, ordered by `after` (seeder classes), with default names from the module and class, `manual`, `env`, `connection`, `--only`, `--file`, `--arg` and `--list`. `styx make:seeder` generates one. Packages add their own module lists by augmenting `ModuleCollections`.
