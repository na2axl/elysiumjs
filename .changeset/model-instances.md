---
'@elysiumjs/olympus': minor
'@elysiumjs/drizzle': minor
'@elysiumjs/styx': minor
---

Repositories answer model instances: each holds the columns of a row, typed by the model's select type, with the getters and methods of the model class. Models gain a stable `modelName` (`schema.table` with Drizzle), `hidden` and `appends`, which `toJSON()` and `ModelResource()` follow, and `hydrate()`; `this.hydrate(rows)` turns the rows of a custom query into instances. Instances survive `Json` through the `model` serializer and the `Models` registry, and the caches write their values with `Json` in every store, so a read answers a copy with its dates and instances. A new `bytes` serializer keeps `Uint8Array` and `Buffer` values. A route without a response schema answers the JSON form of an instance, and `styx routes:generate` types handler results with `JsonForm`.
