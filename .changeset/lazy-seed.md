---
'@elysiumjs/mnemosyne': patch
---

`db:seed` boots the app lazily: only the services the seeders take are built, so a service that needs its host (such as a Worker binding) no longer stops a seed run.
