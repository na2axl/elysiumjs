---
'@elysiumjs/olympus': minor
'@elysiumjs/drizzle': minor
'@elysiumjs/styx': minor
---

Repositories answer model instances: each holds the columns of a row, typed by the model's select type, with the getters and methods of the model class. Models gain a stable `modelName` (`schema.table` with Drizzle), `hidden` and `appends`, which `toJSON()` and `ModelResource()` follow, and `hydrate()`; `this.hydrate(rows)` turns the rows of a custom query into instances, and `Pruner.pruning()` receives instances. Two model classes over the same table need distinct names: one sets `static modelName`, or creating their repositories throws `DuplicateModelError`. Instances survive `Json` through the `model` serializer and the `Models` registry, and the caches write their values with `Json` in every store, so a read answers a copy with its dates and instances. Instances are written with the digest of their table's columns: one written with other columns, such as before a deploy, is a miss in the caches and throws `StaleModelError` elsewhere. Listing pages keep their pagination through `Json`. A new `bytes` serializer keeps `Uint8Array` and `Buffer` values. A route without a response schema answers the JSON form of an instance, and `styx routes:generate` types handler results with `JsonForm`.
