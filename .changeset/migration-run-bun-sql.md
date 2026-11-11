---
'@elysiumjs/mnemosyne-drizzle': patch
---

`migration:run` fails with a clear error naming the connection when its client is not a Bun SQL client, and the README says the command needs a connection on the Bun SQL driver.
